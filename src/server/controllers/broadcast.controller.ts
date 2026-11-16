/**
 * Broadcast (Campaigns) endpoints and scheduled execution.
 */

import { z } from 'zod';

import {
  createHandler,
  getLogger,
  result,
  systemDb,
  tenantDb,
  type AuthContext,
} from '../kernel';
import {
  audiencePreviewDtoSchema,
  broadcastDtoSchema,
  broadcastRecipientDtoSchema,
  broadcastSendResultDtoSchema,
} from '../dtos/broadcast.dto';
import { BroadcastService } from '../services/broadcast.service';
import { TemplateService } from '../services/template.service';
import { WhatsappTransport } from '../services/whatsapp-transport';
import {
  broadcastParamsSchema,
  createBroadcastBodySchema,
  dispatchBroadcastBodySchema,
  listBroadcastsQuerySchema,
  listRecipientsQuerySchema,
  previewAudienceBodySchema,
  updateBroadcastBodySchema,
} from '../validators/broadcast.validator';
import { deleted, paged } from './controller-kit';

const log = getLogger('broadcasts.controller');

function assertTenant(ctx: AuthContext | null): asserts ctx is AuthContext {
  if (!ctx?.tenantId) throw new Error('Tenant context required.');
}

export const broadcastController = {
  list: createHandler({
    operation: 'broadcasts.list',
    auth: 'tenant',
    query: listBroadcastsQuerySchema,
    response: z.array(broadcastDtoSchema),
    async handle({ query, ctx, db }) {
      assertTenant(ctx);
      const service = BroadcastService.create(db, ctx.userId, TemplateService.create(db, ctx.userId));
      const page = await service.list(query);
      return paged(page, 'Broadcasts retrieved.');
    },
  }),

  create: createHandler({
    operation: 'broadcasts.create',
    auth: 'tenant',
    body: createBroadcastBodySchema,
    response: broadcastDtoSchema,
    status: 201,
    async handle({ body, ctx, db }) {
      assertTenant(ctx);
      const service = BroadcastService.create(db, ctx.userId, TemplateService.create(db, ctx.userId));
      return service.create(body);
    },
  }),

  get: createHandler({
    operation: 'broadcasts.get',
    auth: 'tenant',
    params: broadcastParamsSchema,
    response: broadcastDtoSchema,
    async handle({ params, ctx, db }) {
      assertTenant(ctx);
      const service = BroadcastService.create(db, ctx.userId, TemplateService.create(db, ctx.userId));
      return service.getById(params.id);
    },
  }),

  update: createHandler({
    operation: 'broadcasts.update',
    auth: 'tenant',
    params: broadcastParamsSchema,
    body: updateBroadcastBodySchema,
    response: broadcastDtoSchema,
    async handle({ params, body, ctx, db }) {
      assertTenant(ctx);
      const service = BroadcastService.create(db, ctx.userId, TemplateService.create(db, ctx.userId));
      return service.update(params.id, body);
    },
  }),

  delete: createHandler({
    operation: 'broadcasts.delete',
    auth: 'tenant',
    params: broadcastParamsSchema,
    response: z.object({ deleted: z.literal(true) }),
    async handle({ params, ctx, db }) {
      assertTenant(ctx);
      const service = BroadcastService.create(db, ctx.userId, TemplateService.create(db, ctx.userId));
      await service.delete(params.id);
      return deleted('Broadcast deleted.');
    },
  }),

  previewAudience: createHandler({
    operation: 'broadcasts.previewAudience',
    auth: 'tenant',
    body: previewAudienceBodySchema,
    response: audiencePreviewDtoSchema,
    async handle({ body, ctx, db }) {
      assertTenant(ctx);
      const service = BroadcastService.create(db, ctx.userId, TemplateService.create(db, ctx.userId));
      return service.previewAudience(body.audience);
    },
  }),

  listRecipients: createHandler({
    operation: 'broadcasts.listRecipients',
    auth: 'tenant',
    params: broadcastParamsSchema,
    query: listRecipientsQuerySchema,
    response: z.array(broadcastRecipientDtoSchema),
    async handle({ params, query, ctx, db }) {
      assertTenant(ctx);
      const service = BroadcastService.create(db, ctx.userId, TemplateService.create(db, ctx.userId));
      const page = await service.listRecipients(params.id, query);
      return paged(page, 'Recipients retrieved.');
    },
  }),

  start: createHandler({
    operation: 'broadcasts.start',
    auth: 'tenant',
    params: broadcastParamsSchema,
    response: broadcastDtoSchema,
    async handle({ params, ctx, db }) {
      assertTenant(ctx);
      const service = BroadcastService.create(db, ctx.userId, TemplateService.create(db, ctx.userId));
      return service.start(params.id);
    },
  }),

  dispatch: createHandler({
    operation: 'broadcasts.dispatch',
    auth: 'tenant',
    params: broadcastParamsSchema,
    body: dispatchBroadcastBodySchema,
    response: broadcastSendResultDtoSchema,
    async handle({ params, body, ctx, db }) {
      assertTenant(ctx);
      const transport = await WhatsappTransport.forTenant(db);
      const service = BroadcastService.create(
        db,
        ctx.userId,
        TemplateService.create(db, ctx.userId, transport ?? undefined),
        transport ?? undefined,
      );
      return service.dispatch(params.id, body.batchSize);
    },
  }),

  /**
   * Cron runner for scheduled campaigns and background batch sending.
   * Cross-tenant pass: finds scheduled broadcasts whose scheduledAt is past,
   * transitions them to 'sending', and dispatches pending recipient batches.
   */
  cron: createHandler({
    operation: 'broadcasts.cron',
    auth: 'cron',
    response: z.object({
      scheduledFound: z.number().int().nonnegative(),
      started: z.number().int().nonnegative(),
      dispatched: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    async handle() {
      const now = new Date();

      // 1. Find all scheduled broadcasts that are now due across all tenants
      const dueBroadcasts = await systemDb.broadcast.findMany({
        where: {
          status: 'scheduled',
          scheduledAt: { lte: now },
        },
        select: {
          id: true,
          tenantId: true,
          userId: true,
        },
        take: 20,
      });

      let started = 0;
      let dispatched = 0;
      let failed = 0;

      // Start due scheduled broadcasts
      for (const row of dueBroadcasts) {
        try {
          const db = tenantDb(row.tenantId);
          const transport = await WhatsappTransport.forTenant(db);
          const service = BroadcastService.create(
            db,
            row.userId,
            TemplateService.create(db, row.userId, transport ?? undefined),
            transport ?? undefined,
          );
          await service.start(row.id);
          started += 1;
        } catch (error) {
          failed += 1;
          log.error('failed to start scheduled campaign', { broadcastId: row.id, tenantId: row.tenantId, err: error });
        }
      }

      // 2. Dispatch next pending batches for any campaigns currently in 'sending' status
      const activeSending = await systemDb.broadcast.findMany({
        where: { status: 'sending' },
        select: {
          id: true,
          tenantId: true,
          userId: true,
        },
        take: 10,
      });

      for (const row of activeSending) {
        try {
          const db = tenantDb(row.tenantId);
          const transport = await WhatsappTransport.forTenant(db);
          if (!transport) {
            log.warn('cannot dispatch broadcast: WhatsApp disconnected', { broadcastId: row.id, tenantId: row.tenantId });
            continue;
          }
          const service = BroadcastService.create(
            db,
            row.userId,
            TemplateService.create(db, row.userId, transport),
            transport,
          );
          const dispatchRes = await service.dispatch(row.id, 50);
          dispatched += dispatchRes.sent;
          failed += dispatchRes.failed;
        } catch (error) {
          log.error('failed to dispatch campaign batch', { broadcastId: row.id, tenantId: row.tenantId, err: error });
        }
      }

      return result(
        {
          scheduledFound: dueBroadcasts.length,
          started,
          dispatched,
          failed,
        },
        { message: 'Broadcast schedule processed.' },
      );
    },
  }),
};
