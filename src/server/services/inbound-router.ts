/**
 * Decides who answers an inbound WhatsApp message: flows, the AI, or reply
 * automations. Side-effect automations (tag, CRM, webhook, assign) always run.
 *
 * Order, per routing mode (see `src/lib/inbound/routing.ts`):
 *
 *   1. Exact-keyword pass. A live flow run waiting for this contact's answer
 *      an exact-keyword flow, or an exact-keyword reply automation answers
 *      before the AI ever sees the message. A customer typing "MENU" gets the
 *      menu, not an AI paraphrase of it.
 *   2. The primary handler for the mode:
 *        ai_first     AI, then other flows if the AI declined
 *        flows_first  other flows, then AI
 *        flows_only   other flows only
 *        ai_only      AI only (no new flows; a run already in progress continues)
 *   3. Reply automations, only if nothing replied yet.
 *   4. Reply automations marked "send even if AI replied", only after an AI reply.
 *   5. Side-effect automations, always.
 *
 * AI failure is never a fall-through: the AI is retried once, and if it still
 * fails the customer gets "our team will reply shortly", the conversation is
 * opened for a human, and staff are notified. Flows and reply automations do
 * not answer in the AI's place.
 *
 * Pure: every effect is injected, so the whole decision table is unit-tested.
 */
import type { AiOutcome } from '@/lib/ai/outcome';
import type { InboundRoutingMode } from '@/lib/inbound/routing';
import type { AutomationScope, KeywordFilter } from './automation-engine.service';
import type { AutomationTriggerType } from '../validators/automation.validator';

/** `live_only` lets a run already in progress continue without starting new flows (ai_only). */
export type FlowPass = 'exact_keyword' | 'non_exact' | 'live_only';

export interface InboundRouterDeps {
  mode: InboundRoutingMode;
  /** Triggers this message satisfies, most specific first. */
  triggers: AutomationTriggerType[];
  /** One AI attempt. `failed` means the model could not produce a reply and nothing was sent. */
  runAi(): Promise<AiOutcome>;
  /** Returns true when a flow replied (consumed the message). */
  runFlows(pass: FlowPass): Promise<boolean>;
  /** Returns how many automations ran. */
  runAutomations(trigger: AutomationTriggerType, scope: AutomationScope, keyword: KeywordFilter): Promise<number>;
  /** Sends the "team will reply" notice, opens the conversation, notifies staff. */
  sendAiFallback(): Promise<unknown>;
}

export type RouteResult =
  | { repliedBy: 'flow_exact' | 'automation_exact' | 'ai' | 'flow' | 'automation'; aiOutcome?: AiOutcome }
  | { repliedBy: 'fallback'; aiOutcome: 'failed' }
  | { repliedBy: 'none'; aiOutcome?: AiOutcome };

const usesAi = (mode: InboundRoutingMode) => mode !== 'flows_only';
const usesFlows = (mode: InboundRoutingMode) => mode !== 'ai_only';

export async function routeInbound(deps: InboundRouterDeps): Promise<RouteResult> {
  const result = await chooseResponder(deps);

  // 4. Opted-in reply automations ride along with an AI reply (never a fallback).
  if (result.repliedBy === 'ai') {
    for (const trigger of deps.triggers) {
      await deps.runAutomations(trigger, 'replies_opted_in', 'any');
    }
  }

  // 5. Side effects always run, whoever answered.
  for (const trigger of deps.triggers) {
    await deps.runAutomations(trigger, 'side_effects', 'any');
  }

  return result;
}

async function chooseResponder(deps: InboundRouterDeps): Promise<RouteResult> {
  const { mode } = deps;

  // 1. Exact keyword pass.
  // A flow already in progress always gets its answer, in every mode.
  if (await deps.runFlows(usesFlows(mode) ? 'exact_keyword' : 'live_only')) return { repliedBy: 'flow_exact' };
  if (deps.triggers.includes('keyword_match')) {
    const ran = await deps.runAutomations('keyword_match', 'replies', 'exact_only');
    if (ran > 0) return { repliedBy: 'automation_exact' };
  }

  // 2. Primary handler.
  let aiOutcome: AiOutcome | undefined;
  const tryAi = async (): Promise<RouteResult | null> => {
    aiOutcome = await attemptAi(deps);
    if (aiOutcome === 'handled') return { repliedBy: 'ai', aiOutcome };
    if (aiOutcome === 'failed') {
      await deps.sendAiFallback();
      return { repliedBy: 'fallback', aiOutcome: 'failed' };
    }
    return null;
  };

  if (mode === 'ai_first' || mode === 'ai_only') {
    const r = await tryAi();
    if (r) return r;
    if (mode === 'ai_first' && (await deps.runFlows('non_exact'))) return { repliedBy: 'flow', aiOutcome };
  } else {
    if (await deps.runFlows('non_exact')) return { repliedBy: 'flow' };
    if (usesAi(mode)) {
      const r = await tryAi();
      if (r) return r;
    }
  }

  // 3. Reply automations, only when nothing has replied. Every matching
  // trigger runs (most specific first), as before this router existed.
  let ran = 0;
  for (const trigger of deps.triggers) {
    ran += await deps.runAutomations(trigger, 'replies', trigger === 'keyword_match' ? 'skip_exact' : 'any');
  }
  return ran > 0 ? { repliedBy: 'automation', aiOutcome } : { repliedBy: 'none', aiOutcome };
}

/** One retry: a transient model error should not hand the chat to a human. */
async function attemptAi(deps: InboundRouterDeps): Promise<AiOutcome> {
  const first = await deps.runAi();
  if (first !== 'failed') return first;
  return deps.runAi();
}
