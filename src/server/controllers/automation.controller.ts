/**
 * Automation endpoints.
 *
 * Replaces `api/automations/route.ts`, `api/automations/[id]/route.ts`,
 * `api/automations/[id]/duplicate/route.ts`, `api/automations/engine/route.ts`
 * and `api/automations/cron/route.ts` — five files that between them used two
 * different database clients (`@/lib/supabase/server` for reads,
 * `@/lib/automations/admin-client` for writes), hand-rolled auth six times,
 * and returned four different response shapes.
 *
 * Template expansion (`?template=`) is preserved: it is the only thing the old
 * POST did that was not authentication or validation.
 */

import { z } from 'zod';

import {
  UnauthenticatedError,
  ValidationError,
  createHandler,
  getLogger,
  result,
  systemDb,
  tenantDb,
} from '../kernel';
import { automationDetailDtoSchema, automationDtoSchema, automationLogDtoSchema } from '../dtos/automation.dto';
import { AutomationService } from '../services/automation.service';
import { AutomationEngineService } from '../services/automation-engine.service';
import { AutomationQueueRepository } from '../repositories/automation.repository';
import { WhatsappTransport } from '../services/whatsapp-transport';
import {
  automationParamsSchema,
  createAutomationBodySchema,
  listAutomationLogsQuerySchema,
  listAutomationsQuerySchema,
  stepInputSchema,
  updateAutomationBodySchema,
  type StepInput,
} from '../validators/automation.validator';
import { getTemplate } from '@/lib/automations/templates';
import { deleted, paged } from './controller-kit';

const log = getLogger('automations.controller');

const issuesDtoSchema = z.object({
  valid: z.boolean(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});

/**
 * A starter template supplies name, trigger and steps. Its steps still go
 * through `stepInputSchema`, so a template that drifts from the step contract
 * fails at author time rather than producing an automation the engine cannot
 * run.
 */
function applyTemplate(
  templateId: string,
  body: z.infer<typeof createAutomationBodySchema>,
): z.infer<typeof createAutomationBodySchema> {
  const template = getTemplate(templateId);
  if (!template) {
    throw new ValidationError(`Unknown automation template "${templateId}".`);
  }

  const steps = z.array(stepInputSchema).safeParse(template.steps);
  if (!steps.success) {
    throw new ValidationError(`Template "${templateId}" is out of date and cannot be used.`, {
      details: { issues: steps.error.issues.map((issue) => issue.message) },
    });
  }

  return {
    ...body,
    name: body.name || template.name,
    description: body.description ?? template.description ?? null,
    triggerType: template.trigger_type as typeof body.triggerType,
    triggerConfig: (template.trigger_config ?? {}) as Record<string, unknown>,
    steps: body.steps.length > 0 ? body.steps : (steps.data as StepInput[]),
  };
}

export const automationController = {
  list: createHandler({
    operation: 'automations.list',
    auth: 'tenant',
    query: listAutomationsQuerySchema,
    response: z.array(automationDtoSchema),
    handle: async ({ ctx, db, query }) =>
      paged(await AutomationService.create(db, ctx.userId).list(query), 'Automations retrieved.'),
  }),

  create: createHandler({
    operation: 'automations.create',
    auth: 'tenant',
    query: z.object({ template: z.string().max(120).optional() }),
    body: createAutomationBodySchema,
    response: automationDetailDtoSchema,
    status: 201,
    message: 'Automation created.',
    handle: async ({ ctx, db, body, query }) => {
      const payload = query.template ? applyTemplate(query.template, body) : body;
      return AutomationService.create(db, ctx.userId).create(payload);
    },
  }),

  get: createHandler({
    operation: 'automations.get',
    auth: 'tenant',
    params: automationParamsSchema,
    response: automationDetailDtoSchema,
    handle: async ({ ctx, db, params }) =>
      AutomationService.create(db, ctx.userId).getDetail(params.id),
  }),

  update: createHandler({
    operation: 'automations.update',
    auth: 'tenant',
    params: automationParamsSchema,
    body: updateAutomationBodySchema,
    response: automationDetailDtoSchema,
    message: 'Automation saved.',
    handle: async ({ ctx, db, params, body }) =>
      AutomationService.create(db, ctx.userId).update(params.id, body),
  }),

  remove: createHandler({
    operation: 'automations.delete',
    auth: 'tenant',
    params: automationParamsSchema,
    response: z.object({ deleted: z.literal(true) }),
    handle: async ({ ctx, db, params }) => {
      await AutomationService.create(db, ctx.userId).delete(params.id);
      return deleted('Automation deleted.');
    },
  }),

  duplicate: createHandler({
    operation: 'automations.duplicate',
    auth: 'tenant',
    params: automationParamsSchema,
    response: automationDetailDtoSchema,
    status: 201,
    message: 'Automation duplicated.',
    handle: async ({ ctx, db, params }) =>
      AutomationService.create(db, ctx.userId).duplicate(params.id),
  }),

  /** Dry-run validation, so the builder can show issues without saving. */
  validate: createHandler({
    operation: 'automations.validate',
    auth: 'tenant',
    params: automationParamsSchema,
    response: issuesDtoSchema,
    handle: async ({ ctx, db, params }) => {
      const issues = await AutomationService.create(db, ctx.userId).validate(params.id);
      return { valid: issues.length === 0, issues };
    },
  }),

  listLogs: createHandler({
    operation: 'automations.logs',
    auth: 'tenant',
    params: automationParamsSchema,
    query: listAutomationLogsQuerySchema,
    response: z.array(automationLogDtoSchema),
    handle: async ({ ctx, db, params, query }) =>
      paged(
        await AutomationService.create(db, ctx.userId).listLogs(params.id, query),
        'Execution history retrieved.',
      ),
  }),

  /**
   * Manual trigger, used by the builder's "Test run" button.
   *
   * The old `api/automations/engine/route.ts` accepted a `user_id` in the body
   * and ran automations as that user, with no check that the caller was them.
   * Here the principal comes from the session and nothing else.
   */
  testRun: createHandler({
    operation: 'automations.testRun',
    auth: 'tenant',
    body: z.object({
      triggerType: z.enum(['new_message_received', 'first_inbound_message', 'keyword_match', 'new_contact_created']),
      contactId: z.string().uuid(),
      messageText: z.string().max(4096).optional(),
    }),
    response: z.object({ executed: z.number().int(), failed: z.number().int() }),
    message: 'Automations dispatched.',
    handle: async ({ ctx, db, body }) => {
      const transport = await WhatsappTransport.forTenant(db);
      if (!transport) {
        throw new ValidationError('Connect WhatsApp in Settings before running an automation.');
      }
      return AutomationEngineService.create(db, ctx.userId, transport).dispatch({
        triggerType: body.triggerType,
        contactId: body.contactId,
        context: { messageText: body.messageText },
      });
    },
  }),

  /**
   * Wait-queue worker.
   *
   * Runs across tenants, so it resolves each due row's tenant itself and
   * builds a scoped client per row — the guard still applies to every query
   * the resume performs. The previous cron used the admin shim and called
   * `.lte('run_at', …)`, a method that shim never implemented, so it threw a
   * `TypeError` on every invocation and no parked `wait` step ever resumed.
   */
  cron: createHandler({
    operation: 'automations.cron',
    auth: 'cron',
    response: z.object({
      due: z.number().int(),
      resumed: z.number().int(),
      failed: z.number().int(),
      released: z.number().int(),
    }),
    handle: async () => {
      const now = new Date();

      // Cross-tenant sweep: `AutomationPendingExecution` is tenant-scoped, so
      // the due set has to be read unguarded and then dispatched per tenant.
      // Justified use of systemDb — it selects ids and tenant ids only.
      const due = await systemDb.automationPendingExecution.findMany({
        where: { status: 'pending', runAt: { lte: now } },
        select: { id: true, tenantId: true, userId: true },
        orderBy: { runAt: 'asc' },
        take: 200,
      });

      // Anything a crashed worker left `running` for longer than an hour is
      // returned to the queue. Without this a killed process stranded the
      // customer's wait step permanently.
      const staleCutoff = new Date(now.getTime() - 3_600_000);
      const released = await systemDb.automationPendingExecution.updateMany({
        where: { status: 'running', runAt: { lte: staleCutoff } },
        data: { status: 'pending' },
      });

      let resumed = 0;
      let failed = 0;

      for (const row of due) {
        const db = tenantDb(row.tenantId);
        const queue = new AutomationQueueRepository(db);

        // Real claim: `updateMany` reports rows affected, so two overlapping
        // invocations cannot both process the same row. The shim returned a
        // synthetic one-element array for every update, which made the old
        // guard dead code.
        if (!(await queue.claim(row.id))) continue;

        try {
          const pending = await systemDb.automationPendingExecution.findFirst({
            where: { id: row.id },
            select: {
              id: true,
              automationId: true,
              contactId: true,
              logId: true,
              parentStepId: true,
              branch: true,
              nextStepPosition: true,
              context: true,
            },
          });
          if (!pending) continue;

          const transport = await WhatsappTransport.forTenant(db);
          if (!transport) {
            // The tenant disconnected WhatsApp while the step was parked.
            // Failing the row is honest; retrying forever is not.
            await queue.fail(row.id);
            failed += 1;
            continue;
          }

          await AutomationEngineService.create(db, row.userId, transport).resume(pending);
          await queue.complete(row.id);
          resumed += 1;
        } catch (error) {
          await queue.fail(row.id);
          failed += 1;
          log.error('resume failed', { pendingId: row.id, tenantId: row.tenantId, err: error });
        }
      }

      return result(
        { due: due.length, resumed, failed, released: released.count },
        { message: 'Automation queue processed.' },
      );
    },
  }),
};

/** Guard so a missing tenant cannot reach a controller that assumes one. */
export function assertTenant(ctx: { tenantId?: string | null } | null): asserts ctx is { tenantId: string } {
  if (!ctx?.tenantId) throw new UnauthenticatedError();
}
