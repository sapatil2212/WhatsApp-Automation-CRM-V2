/**
 * Flow runner — walks a customer through a stored node graph.
 *
 * Replaces `src/lib/flows/engine.ts`. The runner's shape (advance loop,
 * suspending vs auto-advancing nodes, fallback policy) is preserved; what
 * changes is everything underneath it, because the previous version could
 * not work on this database:
 *
 *  1. **It died on the first customer reply.** `isDuplicateInbound` called
 *     `.filter('payload->>meta_message_id', 'eq', …)`, a PostgREST JSON
 *     operator the compat shim never implemented. The call threw, the outer
 *     `try` swallowed it, and every reply came back as `no_match` — so
 *     flows appeared to start and then never respond. Idempotency now lives
 *     in the webhook, keyed on `Message.messageId`, and covers AI and
 *     automations too rather than only flows.
 *
 *  2. **One-active-run-per-contact was never enforced.** It relied on a
 *     PostgreSQL *partial* unique index and caught SQLSTATE 23505. MySQL has
 *     neither, so the index did not exist and the catch block was dead code.
 *     `FlowRunRepository.startRun` enforces it with a serialisable
 *     transaction.
 *
 *  3. **`executionCount` never incremented.** It called an RPC
 *     (`increment_flow_execution_count`) whose shim read `args.flow_id`
 *     while the caller passed `p_flow_id`, so every call ran with
 *     `id: undefined` and threw. Flow cards always read "0 runs".
 *
 *  4. **No tenant scoping at all.** `supabaseAdmin()` reached every tenant's
 *     flows, runs and contacts.
 *
 * Division of labour is unchanged and deliberate:
 *   - pure decision logic → `matchReplyId`, `matchesKeywordTrigger`,
 *     `evaluateConditionPredicate` (below, exported for tests),
 *   - fallback policy → `src/lib/flows/fallback.ts` (already pure and tested),
 *   - Meta calls → `OutboundMessageService`,
 *   - persistence → `FlowRepository` / `FlowRunRepository`.
 */

import type { Prisma } from '@prisma/client';

import { getLogger, type TenantDb } from '../kernel';
import { toFallbackPolicy, type FlowFallbackPolicyDto } from '../dtos/flow.dto';
import { toInputJson } from '../dtos/common.dto';
import { ContactRepository } from '../repositories/contact.repository';
import { ConversationRepository } from '../repositories/conversation.repository';
import {
  FlowRepository,
  FlowRunRepository,
  type FlowNodeRow,
  type FlowRow,
  type FlowRunRow,
} from '../repositories/flow.repository';
import { OutboundMessageService, type SendTarget, type SystemTransport } from './outbound.service';

const log = getLogger('flows.engine');

/** Cycle guard. A flow the validator accepted cannot loop, but a hand-edited row can. */
const MAX_ADVANCE_STEPS = 64;

/** Inbound shapes a flow can react to. */
export type ParsedInbound =
  | { kind: 'text'; text: string; metaMessageId: string }
  | { kind: 'interactive_reply'; replyId: string; replyTitle: string; metaMessageId: string };

export interface FlowDispatchInput {
  contactId: string;
  conversationId: string | null;
  message: ParsedInbound;
  /** Drives the `first_inbound_message` trigger. */
  isFirstInboundMessage: boolean;
}

export type FlowOutcome =
  | 'no_match'
  | 'started'
  | 'advanced'
  | 'completed'
  | 'handed_off'
  | 'fallback_fired'
  | 'failed';

export interface FlowDispatchResult {
  /** True when the flow answered the customer, so nothing else should. */
  consumed: boolean;
  flowRunId?: string;
  outcome: FlowOutcome;
}

// ── pure decision logic ─────────────────────────────────────────────

interface ButtonsConfig {
  text: string;
  header_text?: string;
  footer_text?: string;
  buttons: Array<{ reply_id: string; title: string; next_node_key: string }>;
}

interface ListConfig {
  text: string;
  button_label: string;
  header_text?: string;
  footer_text?: string;
  sections: Array<{
    title?: string;
    rows: Array<{ reply_id: string; title: string; description?: string; next_node_key: string }>;
  }>;
}

interface CollectInputConfig {
  prompt_text: string;
  var_key: string;
  next_node_key: string;
}

interface ConditionConfig {
  subject: 'var' | 'tag' | 'contact_field';
  subject_key: string;
  operator: 'equals' | 'contains' | 'present' | 'absent';
  value?: string;
  true_next: string;
  false_next: string;
}

export interface KeywordTrigger {
  keywords?: string[];
  match_type?: 'exact' | 'contains';
  case_sensitive?: boolean;
}

/** Which node a tapped button or list row leads to, or null if none matches. */
export function matchReplyId(node: { nodeType: string; config: unknown }, replyId: string): string | null {
  if (node.nodeType === 'send_buttons') {
    const config = node.config as ButtonsConfig;
    return config.buttons?.find((button) => button.reply_id === replyId)?.next_node_key ?? null;
  }
  if (node.nodeType === 'send_list') {
    const config = node.config as ListConfig;
    for (const section of config.sections ?? []) {
      const hit = section.rows?.find((row) => row.reply_id === replyId);
      if (hit) return hit.next_node_key;
    }
  }
  return null;
}

/** Case-insensitive contains/exact match. Kept so the builder can preview matches. */
export function matchesKeywordTrigger(text: string, config: KeywordTrigger): boolean {
  if (!text || !config.keywords?.length) return false;
  const exact = (config.match_type ?? 'contains') === 'exact';
  const haystack = config.case_sensitive ? text : text.toLowerCase();
  return config.keywords.some((raw) => {
    if (!raw) return false;
    const needle = config.case_sensitive ? raw : raw.toLowerCase();
    return exact ? haystack === needle : haystack.includes(needle);
  });
}

/** `undefined` means the subject is absent — the caller does the lookup. */
export function evaluateConditionPredicate(input: {
  operator: ConditionConfig['operator'];
  subjectValue: string | undefined;
  configValue: string | undefined;
}): boolean {
  switch (input.operator) {
    case 'present':
      return input.subjectValue !== undefined && input.subjectValue !== '';
    case 'absent':
      return input.subjectValue === undefined || input.subjectValue === '';
    case 'equals':
      return input.subjectValue !== undefined && input.subjectValue === (input.configValue ?? '');
    case 'contains':
      return input.subjectValue !== undefined && input.subjectValue.includes(input.configValue ?? '');
    default: {
      const exhaustive: never = input.operator;
      throw new Error(`Unknown condition operator: ${String(exhaustive)}`);
    }
  }
}

/** `{{vars.x}}` substitution. Missing keys render empty, matching automations. */
export function interpolateVars(template: string, vars: Record<string, unknown>): string {
  if (!template) return '';
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function isSuspending(nodeType: string): boolean {
  return nodeType === 'send_buttons' || nodeType === 'send_list' || nodeType === 'collect_input';
}

// ── the engine ──────────────────────────────────────────────────────

export interface FlowEngineDeps {
  flows: FlowRepository;
  runs: FlowRunRepository;
  contacts: ContactRepository;
  conversations: ConversationRepository;
  outbound: OutboundMessageService;
}

/** Mutable per-dispatch run state, so the loop never re-reads the row. */
interface RunState {
  row: FlowRunRow;
  vars: Record<string, unknown>;
  repromptCount: number;
  target: SendTarget;
}

export class FlowEngineService {
  constructor(
    private readonly deps: FlowEngineDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string, transport: SystemTransport): FlowEngineService {
    return new FlowEngineService(
      {
        flows: new FlowRepository(db),
        runs: new FlowRunRepository(db),
        contacts: new ContactRepository(db),
        conversations: new ConversationRepository(db),
        outbound: OutboundMessageService.create(db, userId, transport),
      },
      userId,
    );
  }

  /**
   * Entry point, called once per inbound message.
   *
   * Never throws: the webhook must acknowledge Meta even when a flow is
   * broken, or Meta redelivers the message and everything that *did* work
   * runs twice.
   */
  async dispatchInbound(input: FlowDispatchInput): Promise<FlowDispatchResult> {
    try {
      const active = await this.deps.runs.findActiveForContact(input.contactId);
      if (active) return await this.handleReply(active, input);

      const flow = await this.findEntryFlow(input);
      if (!flow || !flow.entryNodeId) return { consumed: false, outcome: 'no_match' };

      return await this.startRun(flow, input);
    } catch (error) {
      log.error('flow dispatch failed', { contactId: input.contactId, err: error });
      // Not consumed: let automations have their turn rather than dropping
      // the customer's message on the floor.
      return { consumed: false, outcome: 'failed' };
    }
  }

  /**
   * Times out runs a customer abandoned. Each flow's own `on_timeout_hours`
   * decides the cutoff — the previous cron discarded the joined policy and
   * swept every tenant at the 24-hour default.
   */
  async sweepStale(limit = 200): Promise<{ scanned: number; timedOut: number }> {
    const runs = await this.deps.runs.findStaleActive(limit);
    const now = Date.now();
    let timedOut = 0;

    for (const run of runs) {
      const policy = toFallbackPolicy(run.flow.fallbackPolicy);
      const ageHours = (now - run.lastAdvancedAt.getTime()) / 3_600_000;
      if (ageHours < policy.on_timeout_hours) continue;

      if (await this.deps.runs.timeOut(run.id)) {
        await this.logEvent(run.id, 'timeout', null, { ageHours: Math.round(ageHours) });
        timedOut += 1;
      }
    }

    return { scanned: runs.length, timedOut };
  }

  // ── trigger resolution ────────────────────────────────────────────

  /**
   * Only text can start a flow. An interactive reply is an answer to a
   * prompt; treating one as a trigger would restart the flow the customer
   * is already in.
   */
  private async findEntryFlow(input: FlowDispatchInput): Promise<(FlowRow & { nodes: FlowNodeRow[] }) | null> {
    if (input.message.kind !== 'text') return null;

    const flows = await this.deps.flows.listActiveForTrigger(['keyword', 'first_inbound_message']);
    for (const flow of flows) {
      if (flow.triggerType === 'keyword') {
        if (matchesKeywordTrigger(input.message.text, (flow.triggerConfig ?? {}) as KeywordTrigger)) {
          return flow;
        }
      } else if (flow.triggerType === 'first_inbound_message' && input.isFirstInboundMessage) {
        return flow;
      }
      // `manual` never auto-starts.
    }
    return null;
  }

  private async startRun(
    flow: FlowRow & { nodes: FlowNodeRow[] },
    input: FlowDispatchInput,
  ): Promise<FlowDispatchResult> {
    const entryNodeKey = flow.entryNodeId;
    if (!entryNodeKey) return { consumed: false, outcome: 'no_match' };

    const target = await this.deps.outbound.resolveTarget({
      contactId: input.contactId,
      conversationId: input.conversationId,
    });

    const run = await this.deps.runs.startRun({
      flowId: flow.id,
      userId: this.userId,
      contactId: input.contactId,
      conversationId: target.conversationId,
      entryNodeKey,
    });

    if (!run) {
      // A concurrent webhook won the race. Consumed, so we do not also fire
      // automations for a message the other run is answering.
      return { consumed: true, outcome: 'no_match' };
    }

    await this.logEvent(run.id, 'started', entryNodeKey, {
      flowId: flow.id,
      triggerType: flow.triggerType,
      metaMessageId: input.message.metaMessageId,
    });
    await this.deps.flows.incrementExecutionCount(flow.id);

    const state: RunState = { row: run, vars: {}, repromptCount: 0, target };
    const outcome = await this.advance(state, entryNodeKey, indexNodes(flow.nodes));
    return {
      consumed: true,
      flowRunId: run.id,
      outcome: outcome === 'advanced' ? 'started' : outcome,
    };
  }

  // ── replies into a live run ───────────────────────────────────────

  private async handleReply(run: FlowRunRow, input: FlowDispatchInput): Promise<FlowDispatchResult> {
    // Never persist the customer's raw text. A `collect_input` prompt asking
    // for a card number would otherwise leave the PAN in `flow_run_events`
    // for anyone with access to the runs viewer. Length is enough to debug.
    await this.logEvent(run.id, 'reply_received', run.currentNodeKey, {
      metaMessageId: input.message.metaMessageId,
      replyKind: input.message.kind,
      replyId: input.message.kind === 'interactive_reply' ? input.message.replyId : null,
      textLength: input.message.kind === 'text' ? input.message.text.length : null,
    });

    if (!run.currentNodeKey) {
      await this.deps.runs.endRun(run.id, 'failed', 'active_run_missing_current_node');
      return { consumed: true, flowRunId: run.id, outcome: 'failed' };
    }

    const nodes = indexNodes(await this.deps.flows.listNodes(run.flowId));
    const currentNode = nodes.get(run.currentNodeKey);
    if (!currentNode) {
      // The flow was edited and this node no longer exists. Ending the run is
      // kinder than looping: the customer can trigger the new graph again.
      await this.deps.runs.endRun(run.id, 'failed', 'current_node_not_found');
      return { consumed: true, flowRunId: run.id, outcome: 'failed' };
    }

    const target = await this.deps.outbound.resolveTarget({
      contactId: input.contactId,
      conversationId: run.conversationId ?? input.conversationId,
    });
    const state: RunState = {
      row: run,
      vars: toVars(run.vars),
      repromptCount: run.repromptCount,
      target,
    };

    const matched = await this.matchReply(state, currentNode, input.message);
    if (matched) {
      if (state.repromptCount !== 0) {
        await this.deps.runs.setRepromptCount(run.id, 0);
        state.repromptCount = 0;
      }
      const outcome = await this.advance(state, matched, nodes);
      return { consumed: true, flowRunId: run.id, outcome };
    }

    return this.applyFallback(state, currentNode);
  }

  /**
   * Two ways a reply advances: a tap that matches an option, or free text on
   * a `collect_input` node. Anything else is a no-match and falls through to
   * the fallback policy.
   */
  private async matchReply(
    state: RunState,
    node: FlowNodeRow,
    message: ParsedInbound,
  ): Promise<string | null> {
    if (
      message.kind === 'interactive_reply' &&
      (node.nodeType === 'send_buttons' || node.nodeType === 'send_list')
    ) {
      return matchReplyId(node, message.replyId);
    }

    if (message.kind === 'text' && node.nodeType === 'collect_input') {
      const config = node.config as unknown as CollectInputConfig;
      const captured = message.text.trim();
      if (captured.length === 0 || !config.var_key) return null;

      const vars = { ...state.vars, [config.var_key]: captured };
      await this.deps.runs.setVars(state.row.id, toInputJson(vars) ?? {});
      // Mirrored in memory so the advance loop interpolates the new value
      // without re-reading the row.
      state.vars = vars;
      state.repromptCount = 0;
      await this.logEvent(state.row.id, 'node_entered', node.nodeKey, {
        capturedKey: config.var_key,
        capturedLength: captured.length,
      });
      return config.next_node_key;
    }

    return null;
  }

  private async applyFallback(state: RunState, node: FlowNodeRow): Promise<FlowDispatchResult> {
    const flow = await this.deps.flows.findById(state.row.flowId);
    const policy = toFallbackPolicy(flow.fallbackPolicy);

    const reprompts = state.repromptCount + 1;
    await this.deps.runs.setRepromptCount(state.row.id, reprompts);
    state.repromptCount = reprompts;

    const action = decideFallbackAction(policy, reprompts);
    await this.logEvent(state.row.id, 'fallback_fired', node.nodeKey, { action, reprompts });

    if (action === 'ignore') {
      // Deliberately not consumed — the message was not for us, so let
      // automations react to it.
      return { consumed: false, flowRunId: state.row.id, outcome: 'no_match' };
    }

    if (action === 'reprompt') {
      // Re-send the same prompt; the pointer does not move.
      try {
        await this.sendPrompt(state, node);
      } catch (error) {
        await this.logEvent(state.row.id, 'error', node.nodeKey, {
          reason: 'reprompt_send_failed',
          detail: errorText(error),
        });
      }
      return { consumed: true, flowRunId: state.row.id, outcome: 'fallback_fired' };
    }

    if (action === 'handoff') {
      await this.handOff(state, node.nodeKey, 'fallback_exhausted', null);
      return { consumed: true, flowRunId: state.row.id, outcome: 'handed_off' };
    }

    await this.deps.runs.endRun(state.row.id, 'completed', 'fallback_exhausted_end');
    return { consumed: true, flowRunId: state.row.id, outcome: 'completed' };
  }

  // ── the advance loop ──────────────────────────────────────────────

  /**
   * Walks auto-advancing nodes in memory until one suspends or terminates.
   * A five-node chain costs one node read, not five.
   */
  private async advance(
    state: RunState,
    startNodeKey: string,
    nodes: Map<string, FlowNodeRow>,
  ): Promise<FlowOutcome> {
    let currentKey: string | null = startNodeKey;

    for (let guard = 0; guard < MAX_ADVANCE_STEPS; guard += 1) {
      if (!currentKey) return this.failRun(state, null, 'missing_next_node');

      const node: FlowNodeRow | undefined = nodes.get(currentKey);
      if (!node) return this.failRun(state, currentKey, 'node_not_found');

      await this.logEvent(state.row.id, 'node_entered', node.nodeKey, { nodeType: node.nodeType });

      switch (node.nodeType) {
        case 'start': {
          currentKey = (node.config as { next_node_key?: string }).next_node_key ?? null;
          continue;
        }

        case 'send_message': {
          const config = node.config as { text: string; next_node_key: string };
          try {
            const sent = await this.deps.outbound.sendText(
              state.target,
              interpolateVars(config.text, state.vars),
            );
            await this.logEvent(state.row.id, 'message_sent', node.nodeKey, {
              nodeType: 'send_message',
              whatsappMessageId: sent.whatsappMessageId,
            });
          } catch (error) {
            return this.failRun(state, node.nodeKey, 'send_text_failed', error);
          }
          currentKey = config.next_node_key;
          continue;
        }

        case 'condition': {
          const config = node.config as unknown as ConditionConfig;
          let passes: boolean;
          try {
            passes = await this.evaluateCondition(state, config);
          } catch (error) {
            return this.failRun(state, node.nodeKey, 'condition_evaluation_failed', error);
          }
          currentKey = passes ? config.true_next : config.false_next;
          await this.logEvent(state.row.id, 'node_entered', node.nodeKey, {
            conditionResult: passes,
            advancingTo: currentKey,
          });
          continue;
        }

        case 'set_tag': {
          const config = node.config as { mode: 'add' | 'remove'; tag_id: string; next_node_key: string };
          const contactId = state.row.contactId;
          if (contactId) {
            try {
              if (config.mode === 'add') await this.deps.contacts.addTags(contactId, [config.tag_id]);
              else await this.deps.contacts.removeTag(contactId, config.tag_id);
            } catch (error) {
              // Non-fatal: a tag write must not strand the customer mid-flow.
              await this.logEvent(state.row.id, 'error', node.nodeKey, {
                reason: 'set_tag_failed',
                detail: errorText(error),
              });
            }
          }
          currentKey = config.next_node_key;
          continue;
        }

        case 'send_buttons':
        case 'send_list':
        case 'collect_input': {
          try {
            await this.sendPrompt(state, node);
          } catch (error) {
            return this.failRun(state, node.nodeKey, `${node.nodeType}_send_failed`, error);
          }
          // Only now move the pointer, and only if nobody else moved it.
          const advanced = await this.deps.runs.advanceCurrentNode({
            runId: state.row.id,
            expectedNodeKey: state.row.currentNodeKey,
            nextNodeKey: node.nodeKey,
          });
          if (!advanced) {
            await this.logEvent(state.row.id, 'error', node.nodeKey, {
              reason: 'lost_race_during_advance',
            });
          }
          return 'advanced';
        }

        case 'handoff': {
          const config = node.config as { note?: string; assign_to?: string };
          await this.handOff(state, node.nodeKey, 'handoff_node', config);
          return 'handed_off';
        }

        case 'end': {
          await this.logEvent(state.row.id, 'completed', node.nodeKey, {});
          await this.deps.runs.endRun(state.row.id, 'completed', 'end_node');
          return 'completed';
        }

        default:
          // `http_fetch` lands here: it is a valid node type in the schema
          // with no executor. Failing the run names it, instead of silently
          // treating it as a dead end.
          return this.failRun(state, node.nodeKey, `unsupported_node_type:${node.nodeType}`);
      }
    }

    return this.failRun(state, currentKey, 'advance_loop_overflow');
  }

  /**
   * Sends whatever prompt a suspending node owns, and records the resulting
   * message on the run so the inbox can show what the customer is answering.
   */
  private async sendPrompt(state: RunState, node: FlowNodeRow): Promise<void> {
    let sent: { messageId: string };

    if (node.nodeType === 'send_buttons') {
      const config = node.config as unknown as ButtonsConfig;
      sent = await this.deps.outbound.sendButtons(state.target, {
        bodyText: interpolateVars(config.text, state.vars),
        headerText: config.header_text,
        footerText: config.footer_text,
        buttons: config.buttons.map((button) => ({ id: button.reply_id, title: button.title })),
      });
    } else if (node.nodeType === 'send_list') {
      const config = node.config as unknown as ListConfig;
      sent = await this.deps.outbound.sendList(state.target, {
        bodyText: interpolateVars(config.text, state.vars),
        buttonLabel: config.button_label,
        headerText: config.header_text,
        footerText: config.footer_text,
        sections: config.sections.map((section) => ({
          title: section.title,
          rows: section.rows.map((row) => ({
            id: row.reply_id,
            title: row.title,
            description: row.description,
          })),
        })),
      });
    } else {
      const config = node.config as unknown as CollectInputConfig;
      sent = await this.deps.outbound.sendText(
        state.target,
        interpolateVars(config.prompt_text, state.vars),
      );
    }

    await this.logEvent(state.row.id, 'message_sent', node.nodeKey, { nodeType: node.nodeType });
    // Our own message id, resolved by the send itself. The old engine did a
    // separate `messages` lookup by Meta id to find this.
    await this.deps.runs.setLastPromptMessage(state.row.id, sent.messageId);
  }

  /**
   * Resolves a condition's subject, then delegates to the pure predicate.
   * `var` reads run state; `tag` and `contact_field` hit the database.
   */
  private async evaluateCondition(state: RunState, config: ConditionConfig): Promise<boolean> {
    let subjectValue: string | undefined;

    if (config.subject === 'var') {
      const value = state.vars[config.subject_key];
      subjectValue = value === undefined || value === null ? undefined : String(value);
    } else if (config.subject === 'tag') {
      const contactId = state.row.contactId;
      const present = contactId ? await this.deps.contacts.hasTag(contactId, config.subject_key) : false;
      subjectValue = present ? config.subject_key : undefined;
    } else {
      const allowed = ['name', 'email', 'phone', 'company'];
      if (!allowed.includes(config.subject_key)) {
        throw new Error(`Unsupported contact field in condition: ${config.subject_key}`);
      }
      const contactId = state.row.contactId;
      const contact = contactId ? await this.deps.contacts.findDetail(contactId).catch(() => null) : null;
      const raw = contact ? (contact as unknown as Record<string, unknown>)[config.subject_key] : null;
      subjectValue = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    }

    return evaluateConditionPredicate({
      operator: config.operator,
      subjectValue,
      configValue: config.value,
    });
  }

  private async handOff(
    state: RunState,
    nodeKey: string | null,
    reason: string,
    config: { note?: string; assign_to?: string } | null,
  ): Promise<void> {
    await this.deps.conversations
      .update(state.target.conversationId, {
        status: 'pending',
        ...(config?.assign_to ? { assignedAgentId: config.assign_to } : {}),
      })
      .catch((error: unknown) => {
        // The handoff still ends the run; a failed status flip would
        // otherwise leave the customer talking to a stopped flow.
        log.warn('handoff could not update the conversation', { err: error });
      });

    await this.logEvent(state.row.id, 'handoff', nodeKey, {
      reason,
      note: config?.note ?? null,
      assignedTo: config?.assign_to ?? null,
    });
    await this.deps.runs.endRun(state.row.id, 'handed_off', reason);
  }

  private async failRun(
    state: RunState,
    nodeKey: string | null,
    reason: string,
    error?: unknown,
  ): Promise<FlowOutcome> {
    await this.logEvent(state.row.id, 'error', nodeKey, {
      reason,
      ...(error ? { detail: errorText(error) } : {}),
    });
    await this.deps.runs.endRun(state.row.id, 'failed', reason);
    log.warn('flow run failed', { flowRunId: state.row.id, reason });
    return 'failed';
  }

  private async logEvent(
    flowRunId: string,
    eventType: string,
    nodeKey: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Event logging is observability, never correctness: a failure here must
    // not abort the customer's run.
    await this.deps.runs
      .logEvent({ flowRunId, eventType, nodeKey, payload: toInputJson(payload) ?? {} })
      .catch((error: unknown) => log.warn('flow event not recorded', { eventType, err: error }));
  }
}

// ── helpers ─────────────────────────────────────────────────────────

function indexNodes(nodes: FlowNodeRow[]): Map<string, FlowNodeRow> {
  return new Map(nodes.map((node) => [node.nodeKey, node]));
}

function toVars(raw: Prisma.JsonValue): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The fallback decision, over the canonical `on_no_match` policy shape.
 *
 * Equivalent to `decideFallback` in `src/lib/flows/fallback.ts`, which takes
 * the legacy `on_unknown_reply` shape and cannot express `on_no_match: 'end'`.
 * That module is deleted with the rest of the shim layer in step 1.5; this is
 * its replacement, not a second copy.
 */
export function decideFallbackAction(
  policy: FlowFallbackPolicyDto,
  repromptCount: number,
): 'ignore' | 'reprompt' | 'handoff' | 'end' {
  if (policy.on_no_match === 'ignore') return 'ignore';
  if (policy.on_no_match === 'handoff') return 'handoff';
  if (policy.on_no_match === 'end') return 'end';
  return repromptCount <= policy.max_reprompts ? 'reprompt' : policy.on_exhaust;
}
