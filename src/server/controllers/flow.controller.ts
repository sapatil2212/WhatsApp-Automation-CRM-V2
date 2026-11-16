/**
 * Flow endpoints.
 *
 * Replaces `api/flows/route.ts`, `api/flows/[id]/route.ts`,
 * `api/flows/[id]/activate/route.ts`, `api/flows/[id]/runs/route.ts`,
 * `api/flows/templates/route.ts` and `api/flows/cron/route.ts`.
 *
 * Two behavioural corrections worth naming, because they were silent:
 *
 *  - `POST /api/flows` accepted `template` and `clone_from` in the body and
 *    branched three ways inside one handler. Cloning is now its own endpoint
 *    (`POST /api/flows/[id]/duplicate`), so "create from template" and
 *    "duplicate this flow" no longer share a validation path in which each
 *    silently skipped the other's checks.
 *
 *  - `GET /api/flows/[id]/runs` returned every run's *entire* event timeline
 *    in one response, unpaginated, capped at 50 runs. A busy flow returned
 *    megabytes. Runs are paginated and events are fetched per run.
 */

import { z } from 'zod';

import { NotFoundError, ValidationError, createHandler, getLogger, result, systemDb, tenantDb } from '../kernel';
import {
  flowActivationResultDtoSchema,
  flowDetailDtoSchema,
  flowDtoSchema,
  flowRunDtoSchema,
  flowRunEventDtoSchema,
  flowValidationIssueDtoSchema,
} from '../dtos/flow.dto';
import { FlowService } from '../services/flow.service';
import { FlowEngineService } from '../services/flow-engine.service';
import { ProfileRepository } from '../repositories/profile.repository';
import { WhatsappTransport } from '../services/whatsapp-transport';
import {
  createFlowBodySchema,
  flowParamsSchema,
  flowRunParamsSchema,
  listFlowRunsQuerySchema,
  listFlowsQuerySchema,
  setFlowStatusBodySchema,
  updateFlowBodySchema,
  type FlowNodeInput,
} from '../validators/flow.validator';
import { getFlowTemplate, listFlowTemplates } from '@/lib/flows/templates';
import { getBusinessSegment } from '@/lib/business/terminology';
import { paged, deleted } from './controller-kit';

const log = getLogger('flows.controller');

const templateSummaryDtoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  triggerType: z.string(),
  nodeCount: z.number().int().nonnegative(),
  /** Tailored to the caller's business segment. */
  recommended: z.boolean(),
  /** Suits every business (no segment restriction). */
  generic: z.boolean(),
});

const templateGalleryDtoSchema = z.object({
  segment: z.string(),
  templates: z.array(templateSummaryDtoSchema),
});

/**
 * Expands a starter template into a create payload.
 *
 * The template's nodes are parsed against `flowNodeInputSchema` via the
 * create schema, so a template that drifts from the node contract is rejected
 * at author time rather than producing a flow the runner cannot walk.
 */
function templateToCreateBody(slug: string): z.infer<typeof createFlowBodySchema> {
  const template = getFlowTemplate(slug);
  if (!template) throw new ValidationError(`Unknown flow template "${slug}".`);

  const parsed = createFlowBodySchema.safeParse({
    name: template.name,
    description: template.description ?? null,
    triggerType: template.trigger_type,
    triggerConfig: template.trigger_config ?? {},
    entryNodeKey: template.entry_node_id,
    nodes: template.nodes.map((node) => ({
      nodeKey: node.node_key,
      nodeType: node.node_type,
      config: node.config,
    })),
  });

  if (!parsed.success) {
    throw new ValidationError(`Template "${slug}" is out of date and cannot be used.`, {
      details: { issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) },
    });
  }
  return parsed.data;
}

export const flowController = {
  list: createHandler({
    operation: 'flows.list',
    auth: 'tenant',
    query: listFlowsQuerySchema,
    response: z.array(flowDtoSchema),
    handle: async ({ ctx, db, query }) =>
      paged(await FlowService.create(db, ctx.userId).list(query), 'Flows retrieved.'),
  }),

  create: createHandler({
    operation: 'flows.create',
    auth: 'tenant',
    query: z.object({ template: z.string().max(120).optional() }),
    body: createFlowBodySchema.partial({ name: true }),
    response: flowDetailDtoSchema,
    status: 201,
    message: 'Flow created.',
    handle: async ({ ctx, db, body, query }) => {
      if (query.template) {
        const fromTemplate = templateToCreateBody(query.template);
        // A caller-supplied name wins, so "New flow from template" can be
        // renamed in the same request.
        return FlowService.create(db, ctx.userId).create({
          ...fromTemplate,
          name: body.name ?? fromTemplate.name,
        });
      }

      if (!body.name) throw new ValidationError('Flow name is required.');
      return FlowService.create(db, ctx.userId).create({
        ...body,
        name: body.name,
        nodes: (body.nodes ?? []) as FlowNodeInput[],
      });
    },
  }),

  get: createHandler({
    operation: 'flows.get',
    auth: 'tenant',
    params: flowParamsSchema,
    response: flowDetailDtoSchema,
    handle: async ({ ctx, db, params }) => FlowService.create(db, ctx.userId).getDetail(params.id),
  }),

  update: createHandler({
    operation: 'flows.update',
    auth: 'tenant',
    params: flowParamsSchema,
    body: updateFlowBodySchema,
    response: flowDetailDtoSchema,
    message: 'Flow saved.',
    handle: async ({ ctx, db, params, body }) =>
      FlowService.create(db, ctx.userId).update(params.id, body),
  }),

  remove: createHandler({
    operation: 'flows.delete',
    auth: 'tenant',
    params: flowParamsSchema,
    response: z.object({ deleted: z.literal(true) }),
    handle: async ({ ctx, db, params }) => {
      await FlowService.create(db, ctx.userId).delete(params.id);
      return deleted('Flow deleted.');
    },
  }),

  duplicate: createHandler({
    operation: 'flows.duplicate',
    auth: 'tenant',
    params: flowParamsSchema,
    response: flowDetailDtoSchema,
    status: 201,
    message: 'Flow duplicated.',
    handle: async ({ ctx, db, params }) => FlowService.create(db, ctx.userId).duplicate(params.id),
  }),

  /**
   * Activation returns 422 with the issue list when the graph is not
   * runnable, rather than 400 — the request was well-formed, the stored flow
   * is not. The builder highlights the offending nodes from `issues`.
   */
  activate: createHandler({
    operation: 'flows.activate',
    auth: 'tenant',
    params: flowParamsSchema,
    response: flowActivationResultDtoSchema,
    handle: async ({ ctx, db, params }) => {
      const activation = await FlowService.create(db, ctx.userId).activate(params.id);
      if (!activation.flow) {
        return result(activation, {
          status: 422,
          message: 'This flow has errors and cannot be activated yet.',
        });
      }
      return result(activation, { message: 'Flow activated.' });
    },
  }),

  setStatus: createHandler({
    operation: 'flows.setStatus',
    auth: 'tenant',
    params: flowParamsSchema,
    body: setFlowStatusBodySchema,
    response: flowDtoSchema,
    message: 'Flow status updated.',
    handle: async ({ ctx, db, params, body }) =>
      FlowService.create(db, ctx.userId).setStatus(params.id, body.status),
  }),

  validate: createHandler({
    operation: 'flows.validate',
    auth: 'tenant',
    params: flowParamsSchema,
    response: z.object({ valid: z.boolean(), issues: z.array(flowValidationIssueDtoSchema) }),
    handle: async ({ ctx, db, params }) => {
      const issues = await FlowService.create(db, ctx.userId).validate(params.id);
      return {
        valid: !issues.some((issue) => issue.severity === 'error'),
        issues: issues.map((issue) => ({
          severity: issue.severity,
          scope: issue.scope,
          nodeKey: issue.node_key ?? null,
          field: issue.field ?? null,
          message: issue.message,
        })),
      };
    },
  }),

  listRuns: createHandler({
    operation: 'flows.runs',
    auth: 'tenant',
    params: flowParamsSchema,
    query: listFlowRunsQuerySchema,
    response: z.array(flowRunDtoSchema),
    handle: async ({ ctx, db, params, query }) =>
      paged(await FlowService.create(db, ctx.userId).listRuns(params.id, query), 'Runs retrieved.'),
  }),

  listRunEvents: createHandler({
    operation: 'flows.runEvents',
    auth: 'tenant',
    params: flowRunParamsSchema,
    response: z.array(flowRunEventDtoSchema),
    handle: async ({ ctx, db, params }) =>
      FlowService.create(db, ctx.userId).listRunEvents(params.id, params.runId),
  }),

  /**
   * Template gallery. Segment-aware so the most relevant starters sort first;
   * the segment lookup is best-effort because a missing profile must not hide
   * the generic templates.
   */
  templates: createHandler({
    operation: 'flows.templates',
    auth: 'tenant',
    response: templateGalleryDtoSchema,
    handle: async ({ ctx, db }) => {
      let segment = 'business';
      try {
        const profile = await new ProfileRepository(db).findByUserId(ctx.userId);
        segment = getBusinessSegment(profile.businessType);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }

      const templates = listFlowTemplates()
        .map((template) => ({
          slug: template.slug,
          name: template.name,
          description: template.description,
          icon: template.icon ?? null,
          triggerType: template.trigger_type,
          nodeCount: template.nodes.length,
          recommended: Array.isArray(template.segments) ? template.segments.includes(segment) : false,
          generic: !template.segments || template.segments.length === 0,
        }))
        .sort((a, b) => rank(a) - rank(b));

      return { segment, templates };
    },
  }),

  /**
   * Stale-run sweep.
   *
   * Cross-tenant, so it resolves the distinct tenants with active runs and
   * sweeps each through a scoped client. Each flow's own `on_timeout_hours`
   * decides its cutoff; the previous cron discarded the joined policy and
   * swept everything at 24 hours.
   */
  cron: createHandler({
    operation: 'flows.cron',
    auth: 'cron',
    response: z.object({
      tenants: z.number().int(),
      scanned: z.number().int(),
      timedOut: z.number().int(),
    }),
    handle: async () => {
      // Justified use of systemDb: a cron sweep legitimately spans tenants,
      // and this selects only tenant/user ids.
      const owners = await systemDb.flowRun.findMany({
        where: { status: 'active' },
        select: { tenantId: true, userId: true },
        distinct: ['tenantId', 'userId'],
        take: 500,
      });

      let scanned = 0;
      let timedOut = 0;

      for (const owner of owners) {
        const db = tenantDb(owner.tenantId);
        const transport = await WhatsappTransport.forTenant(db);
        // The sweep only ends runs; it never sends. A tenant with no
        // WhatsApp connection still needs its abandoned runs closed.
        const engine = FlowEngineService.create(db, owner.userId, transport ?? noopTransport);
        try {
          const swept = await engine.sweepStale();
          scanned += swept.scanned;
          timedOut += swept.timedOut;
        } catch (error) {
          log.error('flow sweep failed for tenant', { tenantId: owner.tenantId, err: error });
        }
      }

      return result({ tenants: owners.length, scanned, timedOut }, { message: 'Flow runs swept.' });
    },
  }),
};

function rank(template: { recommended: boolean; generic: boolean }): number {
  return template.recommended ? 0 : template.generic ? 1 : 2;
}

/**
 * Stand-in transport for code paths that provably never send — currently only
 * the timeout sweep. Throwing rather than no-op'ing means a future sweep that
 * *does* try to send fails loudly instead of silently dropping the message.
 */
const noopTransport = {
  sendText: () => Promise.reject(new Error('This context cannot send messages.')),
  sendTemplate: () => Promise.reject(new Error('This context cannot send messages.')),
  sendMedia: () => Promise.reject(new Error('This context cannot send messages.')),
  sendInteractiveButtons: () => Promise.reject(new Error('This context cannot send messages.')),
  sendInteractiveList: () => Promise.reject(new Error('This context cannot send messages.')),
};
