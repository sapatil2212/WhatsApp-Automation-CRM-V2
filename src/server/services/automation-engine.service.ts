/**
 * Automation engine — executes a step tree for one trigger.
 *
 * Replaces `src/lib/automations/engine.ts`. That file imported the raw
 * `prisma` client (no tenant scoping: an automation id from any tenant
 * reached any tenant's steps), and read a different set of config keys than
 * the builder wrote. See the header of `automation.validator.ts` for the
 * full drift table. The observable consequences, all fixed here:
 *
 * | step | old behaviour | now |
 * | --- | --- | --- |
 * | `wait` | `cfg.duration` was undefined → `NaN` ms → parked at an invalid date | reads `amount`/`unit` via `waitDurationMs` |
 * | `condition` | `cfg.condition_type` never matched → always took the `no` branch | reads `subject`/`operand`/`value` |
 * | `update_contact_field` | `cfg.field_name` undefined → Prisma threw on `{ undefined: … }` | reads `field`/`value`, restricted to a writable allowlist |
 * | `create_deal` | every deal was "New Deal" worth 0 USD | reads `title`/`value`/`currency` |
 * | `assign_conversation` | `cfg.agent_id` only; unvalidated | honours `mode`, implements round-robin, verifies tenant membership |
 * | `close_conversation` | no branch existed; logged as success, did nothing | implemented |
 *
 * Design notes:
 *  - Every config is **parsed** with the same Zod schema the editor uses. A
 *    row that predates the contract fails its own step with a readable
 *    message instead of throwing deep inside Prisma.
 *  - Sending is delegated to `OutboundMessageService`, so the 24-hour
 *    service window is enforced and messages are attributed.
 *  - `executionCount` is bumped once per *trigger*, not once per resume. The
 *    old code incremented on every `wait` resume, so a 3-step automation
 *    with two waits reported three executions for one customer.
 *  - Step failure ends that automation's run and is recorded on the log. It
 *    never propagates to the webhook: one broken automation must not stop
 *    the others, and must not make Meta retry the inbound message.
 */

import type { Prisma } from '@prisma/client';

import { ValidationError, getLogger, type TenantDb } from '../kernel';
import { toInputJson } from '../dtos/common.dto';
import { ContactRepository } from '../repositories/contact.repository';
import { ConversationRepository } from '../repositories/conversation.repository';
import { DealRepository, PipelineRepository } from '../repositories/pipeline.repository';
import { ProfileRepository } from '../repositories/profile.repository';
import {
  AutomationQueueRepository,
  AutomationRepository,
  type AutomationStepRow,
} from '../repositories/automation.repository';
import {
  stepConfigSchemaFor,
  waitDurationMs,
  type AssignConversationStepConfig,
  type AutomationStepType,
  type AutomationTriggerType,
  type ConditionStepConfig,
  type CreateDealStepConfig,
  type SendMessageStepConfig,
  type SendTemplateStepConfig,
  type SendWebhookStepConfig,
  type TagStepConfig,
  type UpdateContactFieldStepConfig,
  type WaitStepConfig,
  keywordTriggerConfigSchema,
} from '../validators/automation.validator';
import { OutboundMessageService, type SystemTransport } from './outbound.service';

const log = getLogger('automations.engine');

/** How long a webhook may spend on outbound sends before parking is safer. */
const MAX_WEBHOOK_STEPS = 50;

/** Facts about the event that fired the trigger. */
export interface AutomationContext {
  messageText?: string;
  conversationId?: string | null;
  /** Captured values, available to future templating. */
  vars?: Record<string, unknown>;
}

export interface AutomationDispatchInput {
  triggerType: AutomationTriggerType;
  contactId: string | null;
  context?: AutomationContext;
}

/** One row of `AutomationLog.stepsExecuted`. */
interface StepOutcome {
  stepId: string;
  stepType: string;
  status: 'success' | 'skipped' | 'parked' | 'failed';
  branchChosen?: 'yes' | 'no';
  error?: string;
}

export interface ResumeInput {
  id: string;
  automationId: string;
  contactId: string | null;
  logId: string | null;
  parentStepId: string | null;
  branch: string | null;
  nextStepPosition: number;
  context: Prisma.JsonValue;
}

interface Cursor {
  parentStepId: string | null;
  branch: 'yes' | 'no' | null;
  index: number;
}

export interface AutomationEngineDeps {
  automations: AutomationRepository;
  queue: AutomationQueueRepository;
  contacts: ContactRepository;
  conversations: ConversationRepository;
  pipelines: PipelineRepository;
  deals: DealRepository;
  profiles: ProfileRepository;
  outbound: OutboundMessageService;
}

export class AutomationEngineService {
  constructor(
    private readonly deps: AutomationEngineDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string, transport: SystemTransport): AutomationEngineService {
    return new AutomationEngineService(
      {
        automations: new AutomationRepository(db),
        queue: new AutomationQueueRepository(db),
        contacts: new ContactRepository(db),
        conversations: new ConversationRepository(db),
        pipelines: new PipelineRepository(db),
        deals: new DealRepository(db),
        profiles: new ProfileRepository(db),
        outbound: OutboundMessageService.create(db, userId, transport),
      },
      userId,
    );
  }

  /**
   * Runs every active automation for a trigger.
   *
   * Never throws. The webhook must acknowledge Meta regardless of whether a
   * customer's automation is misconfigured; a non-2xx there makes Meta retry
   * the same inbound message and re-fire everything that did work.
   */
  async dispatch(input: AutomationDispatchInput): Promise<{ executed: number; failed: number }> {
    let executed = 0;
    let failed = 0;

    const automations = await this.deps.automations.listActiveForTrigger(input.triggerType);
    for (const automation of automations) {
      if (!this.triggerMatches(automation, input.context ?? {})) continue;
      try {
        await this.run({
          automationId: automation.id,
          steps: automation.steps,
          triggerEvent: input.triggerType,
          contactId: input.contactId,
          context: input.context ?? {},
          cursor: { parentStepId: null, branch: null, index: 0 },
          logId: null,
          countExecution: true,
        });
        executed += 1;
      } catch (error) {
        // Already recorded on the automation's log by `run`; this is the
        // "we could not even start" case (e.g. the automation was deleted
        // between the list and the read).
        failed += 1;
        log.error('automation run failed', { automationId: automation.id, err: error });
      }
    }

    return { executed, failed };
  }

  /**
   * Resumes a parked `wait`.
   *
   * Steps are re-read rather than snapshotted, so an automation edited while
   * a customer was waiting resumes against the current graph. `replaceSteps`
   * nulls `parentStepId` on affected queue rows, which lands the resume at
   * the top of the tree instead of a step that no longer exists.
   */
  async resume(pending: ResumeInput): Promise<void> {
    const automation = await this.deps.automations.findById(pending.automationId).catch(() => null);
    if (!automation) {
      log.warn('resume skipped: automation no longer exists', { automationId: pending.automationId });
      return;
    }

    await this.run({
      automationId: automation.id,
      steps: await this.deps.automations.listSteps(automation.id),
      triggerEvent: automation.triggerType,
      contactId: pending.contactId,
      context: toContext(pending.context),
      cursor: {
        parentStepId: pending.parentStepId,
        branch: pending.branch === 'yes' || pending.branch === 'no' ? pending.branch : null,
        index: pending.nextStepPosition,
      },
      logId: pending.logId,
      // A resume is the continuation of one execution, not a new one.
      countExecution: false,
    });
  }

  // ── trigger matching ──────────────────────────────────────────────

  /**
   * `keyword_match` is the only trigger with a predicate. The word-boundary
   * regex is preserved from the previous engine so existing automations keep
   * matching identically, but the config is parsed first: a malformed
   * `triggerConfig` used to throw on `cfg.keywords.some` and abort the whole
   * dispatch loop, silencing every *later* automation too.
   */
  private triggerMatches(
    automation: { triggerType: string; triggerConfig: Prisma.JsonValue },
    context: AutomationContext,
  ): boolean {
    if (automation.triggerType !== 'keyword_match') return true;

    const parsed = keywordTriggerConfigSchema.safeParse(automation.triggerConfig ?? {});
    if (!parsed.success) {
      log.warn('keyword trigger has an invalid config; not matching', {
        issues: parsed.error.issues.length,
      });
      return false;
    }

    const message = (context.messageText ?? '').trim();
    if (!message) return false;

    const haystack = parsed.data.case_sensitive ? message : message.toLowerCase();
    return parsed.data.keywords.some((keyword) => {
      const needle = parsed.data.case_sensitive ? keyword.trim() : keyword.toLowerCase().trim();
      if (!needle) return false;
      if (parsed.data.match_type === 'exact') return haystack === needle;
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'iu').test(haystack);
    });
  }

  // ── execution ─────────────────────────────────────────────────────

  private async run(input: {
    automationId: string;
    steps: AutomationStepRow[];
    triggerEvent: string;
    contactId: string | null;
    context: AutomationContext;
    cursor: Cursor;
    logId: string | null;
    countExecution: boolean;
  }): Promise<void> {
    const outcomes: StepOutcome[] = [];
    let logId = input.logId;

    if (logId) {
      const existing = await this.deps.automations.findLogSteps(logId);
      if (Array.isArray(existing)) outcomes.push(...(existing as StepOutcome[]));
    } else {
      const created = await this.deps.automations.createLog({
        automationId: input.automationId,
        userId: this.userId,
        contactId: input.contactId,
        triggerEvent: input.triggerEvent,
        stepsExecuted: [],
        status: 'success',
      });
      logId = created.id;
    }

    if (input.countExecution) {
      await this.deps.automations.recordExecution(input.automationId);
    }

    // Sibling lookup keyed by `parentStepId|branch`. The old code filtered
    // the whole step array on every iteration and indexed the *filtered*
    // array by `position`, which silently skipped steps whenever a branch's
    // positions were not 0..n-1 — exactly what happens after an edit.
    const siblings = groupSiblings(input.steps);
    const byId = new Map(input.steps.map((step) => [step.id, step]));

    let cursor = input.cursor;

    for (let guard = 0; guard < MAX_WEBHOOK_STEPS; guard += 1) {
      const branchSteps = siblings.get(branchKey(cursor.parentStepId, cursor.branch)) ?? [];

      if (cursor.index >= branchSteps.length) {
        // Branch exhausted: climb to the parent and continue after it.
        if (!cursor.parentStepId) break;
        const parent = byId.get(cursor.parentStepId);
        if (!parent) break;
        cursor = {
          parentStepId: parent.parentStepId,
          branch: parent.branch === 'yes' || parent.branch === 'no' ? parent.branch : null,
          index: indexOfStep(siblings, parent) + 1,
        };
        continue;
      }

      const step = branchSteps[cursor.index];
      const outcome: StepOutcome = { stepId: step.id, stepType: step.stepType, status: 'success' };

      try {
        const action = await this.execute({
          step,
          contactId: input.contactId,
          context: input.context,
        });

        if (action.kind === 'branch') {
          outcome.branchChosen = action.branch;
          outcomes.push(outcome);
          cursor = { parentStepId: step.id, branch: action.branch, index: 0 };
          continue;
        }

        if (action.kind === 'park') {
          await this.deps.queue.park({
            automationId: input.automationId,
            userId: this.userId,
            contactId: input.contactId,
            logId,
            parentStepId: cursor.parentStepId,
            branch: cursor.branch,
            nextStepPosition: cursor.index + 1,
            context: toInputJson(input.context) ?? {},
            runAt: action.runAt,
          });
          outcome.status = 'parked';
          outcomes.push(outcome);
          await this.saveLog(logId, outcomes);
          return;
        }

        if (action.kind === 'skipped') outcome.status = 'skipped';
      } catch (error) {
        outcome.status = 'failed';
        outcome.error = error instanceof Error ? error.message : String(error);
        outcomes.push(outcome);
        await this.saveLog(logId, outcomes);
        log.warn('automation step failed', {
          automationId: input.automationId,
          stepType: step.stepType,
          reason: outcome.error,
        });
        // Stop this automation. Continuing past a failed send would, for
        // example, tag a contact as "replied" when nothing was delivered.
        return;
      }

      outcomes.push(outcome);
      cursor = { ...cursor, index: cursor.index + 1 };
    }

    await this.saveLog(logId, outcomes);
  }

  private async saveLog(logId: string, outcomes: StepOutcome[]): Promise<void> {
    const failure = outcomes.find((outcome) => outcome.status === 'failed');
    await this.deps.automations.updateLog(logId, {
      stepsExecuted: toInputJson(outcomes) ?? [],
      status: failure ? 'failed' : 'success',
      errorMessage: failure?.error ?? null,
    });
  }

  // ── step executors ────────────────────────────────────────────────

  /**
   * Parses the config, then performs the step. The return value tells the
   * loop what to do next; nothing here knows about cursors.
   */
  private async execute(input: {
    step: AutomationStepRow;
    contactId: string | null;
    context: AutomationContext;
  }): Promise<
    | { kind: 'continue' }
    | { kind: 'skipped' }
    | { kind: 'branch'; branch: 'yes' | 'no' }
    | { kind: 'park'; runAt: Date }
  > {
    const stepType = input.step.stepType as AutomationStepType;
    const config = this.parseConfig(stepType, input.step.stepConfig);

    switch (stepType) {
      case 'send_message': {
        const target = await this.requireTarget(input);
        await this.deps.outbound.sendText(
          target,
          interpolate((config as SendMessageStepConfig).text, input.context),
        );
        return { kind: 'continue' };
      }

      case 'send_template': {
        const typed = config as SendTemplateStepConfig;
        const target = await this.requireTarget(input);
        await this.deps.outbound.sendTemplate(target, {
          templateName: typed.template_name,
          language: typed.language,
          params: typed.variables.map((variable) => interpolate(variable, input.context)),
        });
        return { kind: 'continue' };
      }

      case 'add_tag': {
        const contactId = requireContact(input.contactId);
        await this.deps.contacts.addTags(contactId, [(config as TagStepConfig).tag_id]);
        return { kind: 'continue' };
      }

      case 'remove_tag': {
        const contactId = requireContact(input.contactId);
        await this.deps.contacts.removeTag(contactId, (config as TagStepConfig).tag_id);
        return { kind: 'continue' };
      }

      case 'update_contact_field': {
        const typed = config as UpdateContactFieldStepConfig;
        const contactId = requireContact(input.contactId);
        // `field` is a Zod enum over an allowlist, so this cannot become a
        // write to `tenantId` or `phone` via a crafted config row.
        await this.deps.contacts.update(contactId, {
          [typed.field]: interpolate(typed.value, input.context) || null,
        });
        return { kind: 'continue' };
      }

      case 'create_deal': {
        const typed = config as CreateDealStepConfig;
        const contactId = requireContact(input.contactId);
        // Ownership check: a stale pipeline/stage pair would otherwise raise
        // a foreign-key error that reads as an internal failure.
        const stage = await this.deps.pipelines.findStage(typed.pipeline_id, typed.stage_id);
        if (!stage) {
          throw new ValidationError('The pipeline stage this step creates deals in no longer exists.');
        }
        const conversationId =
          input.context.conversationId ??
          (await this.deps.conversations.findByContact(contactId))?.id ??
          null;
        await this.deps.deals.create({
          pipelineId: typed.pipeline_id,
          stageId: typed.stage_id,
          contactId,
          conversationId,
          title: interpolate(typed.title, input.context),
          value: typed.value,
          currency: typed.currency,
          notes: null,
          expectedCloseDate: null,
          userId: this.userId,
        });
        return { kind: 'continue' };
      }

      case 'assign_conversation': {
        const typed = config as AssignConversationStepConfig;
        const target = await this.requireTarget(input);
        const agentId = await this.resolveAssignee(typed);
        if (!agentId) return { kind: 'skipped' };
        await this.deps.conversations.update(target.conversationId, { assignedAgentId: agentId });
        return { kind: 'continue' };
      }

      case 'close_conversation': {
        // Previously absent from the engine's if/else chain, so it fell
        // through and was logged as a success having done nothing.
        const target = await this.requireTarget(input);
        await this.deps.conversations.update(target.conversationId, { status: 'closed' });
        return { kind: 'continue' };
      }

      case 'send_webhook': {
        const typed = config as SendWebhookStepConfig;
        await this.postWebhook(typed, input);
        return { kind: 'continue' };
      }

      case 'wait': {
        return { kind: 'park', runAt: new Date(Date.now() + waitDurationMs(config as WaitStepConfig)) };
      }

      case 'condition': {
        const passes = await this.evaluate(config as ConditionStepConfig, input);
        return { kind: 'branch', branch: passes ? 'yes' : 'no' };
      }

      default: {
        const exhaustive: never = stepType;
        throw new ValidationError(`Step type "${String(exhaustive)}" cannot be executed.`);
      }
    }
  }

  private parseConfig(stepType: AutomationStepType, raw: Prisma.JsonValue): unknown {
    const schema = stepConfigSchemaFor(stepType);
    const parsed = schema.safeParse(raw ?? {});
    if (!parsed.success) {
      // Names the offending field. The old engine read `undefined` keys and
      // failed later with a Prisma or NaN error that named nothing.
      const first = parsed.error.issues[0];
      throw new ValidationError(
        `This ${stepType} step is misconfigured: ${first.path.join('.') || 'config'} — ${first.message}`,
      );
    }
    return parsed.data;
  }

  private async requireTarget(input: { contactId: string | null; context: AutomationContext }) {
    return this.deps.outbound.resolveTarget({
      contactId: requireContact(input.contactId),
      conversationId: input.context.conversationId ?? null,
    });
  }

  /**
   * `specific` uses the configured agent, after confirming they are still a
   * member of this tenant. `round_robin` picks the least-loaded member.
   * Returns null when there is nobody to assign to, which is a skip rather
   * than a failure — an unassigned conversation is still workable.
   */
  private async resolveAssignee(config: AssignConversationStepConfig): Promise<string | null> {
    if (config.mode === 'specific') {
      const agentId = config.agent_id;
      if (!agentId) return null;
      return (await this.deps.profiles.existsInTenant(agentId)) ? agentId : null;
    }

    const [members, load] = await Promise.all([
      this.deps.profiles.listMembers(),
      this.deps.conversations.openLoadByAgent(),
    ]);
    if (members.length === 0) return null;

    return members.reduce((best, member) => {
      const bestLoad = load.get(best.userId) ?? 0;
      const memberLoad = load.get(member.userId) ?? 0;
      // Deterministic tie-break so two workers pick the same agent.
      if (memberLoad < bestLoad) return member;
      if (memberLoad === bestLoad && member.userId < best.userId) return member;
      return best;
    }, members[0]).userId;
  }

  /**
   * Fires an outbound webhook. Timeout-bounded: the old call had none, so a
   * customer's unresponsive endpoint held a webhook request open until the
   * platform killed it, and Meta retried the inbound message.
   */
  private async postWebhook(
    config: SendWebhookStepConfig,
    input: { step: AutomationStepRow; contactId: string | null; context: AutomationContext },
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...config.headers },
        body:
          config.body_template ??
          JSON.stringify({
            stepId: input.step.id,
            contactId: input.contactId,
            conversationId: input.context.conversationId ?? null,
          }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Webhook responded ${response.status}.`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Evaluates a `condition` against the canonical `subject`/`operand`/`value`
   * shape. Every subject is handled; the old `evaluateCondition` ended in a
   * bare `return false`, so any unrecognised shape silently took the `no`
   * branch and looked like a working automation that just never matched.
   */
  private async evaluate(
    config: ConditionStepConfig,
    input: { contactId: string | null; context: AutomationContext },
  ): Promise<boolean> {
    switch (config.subject) {
      case 'tag_presence': {
        if (!input.contactId || !config.operand) return false;
        return this.deps.contacts.hasTag(input.contactId, config.operand);
      }

      case 'message_content': {
        const message = (input.context.messageText ?? '').toLowerCase();
        return message.includes((config.operand ?? '').toLowerCase());
      }

      case 'contact_field': {
        if (!input.contactId || !config.operand) return false;
        const contact = await this.deps.contacts.findDetail(input.contactId).catch(() => null);
        if (!contact) return false;
        const actual = readContactField(contact, config.operand);
        return actual.toLowerCase() === (config.value ?? '').toLowerCase();
      }

      case 'time_of_day': {
        // `HH:mm-HH:mm`, validated by the schema. Compared in UTC for the
        // same reason appointments are: the server's locale is incidental.
        const [from, to] = (config.operand ?? '').split('-');
        const now = new Date();
        const current = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
        // A window that wraps midnight (22:00-02:00) is inclusive of both ends.
        return from <= to ? current >= from && current <= to : current >= from || current <= to;
      }

      default: {
        const exhaustive: never = config.subject;
        throw new ValidationError(`Unknown condition subject "${String(exhaustive)}".`);
      }
    }
  }
}

// ── pure helpers ────────────────────────────────────────────────────

function branchKey(parentStepId: string | null, branch: 'yes' | 'no' | null): string {
  return `${parentStepId ?? 'root'}|${branch ?? 'main'}`;
}

/**
 * Groups steps by parent and branch, ordered by `position`. Exported for
 * tests: the cursor walk is the part that strands a customer mid-automation
 * if it regresses.
 */
export function groupSiblings(steps: AutomationStepRow[]): Map<string, AutomationStepRow[]> {
  const groups = new Map<string, AutomationStepRow[]>();
  for (const step of steps) {
    const branch = step.branch === 'yes' || step.branch === 'no' ? step.branch : null;
    const key = branchKey(step.parentStepId, branch);
    const bucket = groups.get(key);
    if (bucket) bucket.push(step);
    else groups.set(key, [step]);
  }
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => a.position - b.position);
  }
  return groups;
}

/** Where a step sits in its own branch, by array index rather than `position`. */
function indexOfStep(groups: Map<string, AutomationStepRow[]>, step: AutomationStepRow): number {
  const branch = step.branch === 'yes' || step.branch === 'no' ? step.branch : null;
  const bucket = groups.get(branchKey(step.parentStepId, branch)) ?? [];
  return bucket.findIndex((candidate) => candidate.id === step.id);
}

function requireContact(contactId: string | null): string {
  if (!contactId) {
    throw new ValidationError('This step needs a contact, and the trigger did not provide one.');
  }
  return contactId;
}

/**
 * `{{vars.x}}` substitution, matching the flow engine's syntax so the two
 * builders behave the same. Missing keys render empty.
 */
export function interpolate(template: string, context: AutomationContext): string {
  if (!template) return '';
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = context.vars?.[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

const CONTACT_READABLE_FIELDS = ['name', 'email', 'phone', 'company'] as const;

function readContactField(contact: Record<string, unknown>, field: string): string {
  if (!(CONTACT_READABLE_FIELDS as readonly string[]).includes(field)) {
    throw new ValidationError(`Contact field "${field}" cannot be used in a condition.`);
  }
  const value = contact[field];
  return typeof value === 'string' ? value : '';
}

/** Narrows the JSON column a parked execution stored its context in. */
function toContext(raw: Prisma.JsonValue): AutomationContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  return {
    messageText: typeof record.messageText === 'string' ? record.messageText : undefined,
    conversationId: typeof record.conversationId === 'string' ? record.conversationId : null,
    vars: record.vars && typeof record.vars === 'object' ? (record.vars as Record<string, unknown>) : undefined,
  };
}
