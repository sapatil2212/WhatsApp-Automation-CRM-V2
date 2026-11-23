import { describe, expect, it } from 'vitest';

import type { AiOutcome } from '@/lib/ai/outcome';
import type { InboundRoutingMode } from '@/lib/inbound/routing';
import type { AutomationScope, KeywordFilter } from './automation-engine.service';
import type { AutomationTriggerType } from '../validators/automation.validator';
import { routeInbound, type FlowPass } from './inbound-router';

interface Setup {
  mode: InboundRoutingMode;
  triggers?: AutomationTriggerType[];
  /** Successive AI results; the last one repeats. */
  ai?: AiOutcome[];
  flows?: Partial<Record<FlowPass, boolean>>;
  /** Automations that "ran" for a given scope/keyword filter. */
  automations?: Partial<Record<`${AutomationScope}:${KeywordFilter}`, number>>;
}

function harness(setup: Setup) {
  const calls: string[] = [];
  let aiCalls = 0;
  const deps = {
    mode: setup.mode,
    triggers: setup.triggers ?? (['new_message_received', 'keyword_match'] as AutomationTriggerType[]),
    runAi: async (): Promise<AiOutcome> => {
      const seq = setup.ai ?? ['declined'];
      const r = seq[Math.min(aiCalls, seq.length - 1)];
      aiCalls += 1;
      calls.push(`ai:${r}`);
      return r;
    },
    runFlows: async (pass: FlowPass) => {
      calls.push(`flows:${pass}`);
      return setup.flows?.[pass] ?? false;
    },
    runAutomations: async (trigger: AutomationTriggerType, scope: AutomationScope, keyword: KeywordFilter) => {
      calls.push(`auto:${trigger}:${scope}:${keyword}`);
      return setup.automations?.[`${scope}:${keyword}`] ?? 0;
    },
    sendAiFallback: async () => {
      calls.push('fallback');
    },
  };
  return { deps, calls, aiCallCount: () => aiCalls };
}

/** Reply automations that run after the primary handler (the pre-AI exact pass excluded). */
const replyCalls = (calls: string[]) => calls.filter((c) => c.includes(':replies:') && !c.endsWith(':exact_only'));
const sideEffectCalls = (calls: string[]) => calls.filter((c) => c.includes(':side_effects:'));

describe('routeInbound — exact keyword pass', () => {
  it.each<InboundRoutingMode>(['ai_first', 'flows_first', 'flows_only'])('an exact-keyword flow beats the AI (%s)', async (mode) => {
    const h = harness({ mode, ai: ['handled'], flows: { exact_keyword: true } });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('flow_exact');
    expect(h.aiCallCount()).toBe(0);
  });

  it('in ai_only, only a flow already in progress is offered the message', async () => {
    const h = harness({ mode: 'ai_only', ai: ['handled'], flows: { live_only: true } });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('flow_exact');
    expect(h.calls).toContain('flows:live_only');
    expect(h.calls).not.toContain('flows:exact_keyword');
    expect(h.calls).not.toContain('flows:non_exact');
  });

  it('an exact-keyword reply automation beats the AI', async () => {
    const h = harness({ mode: 'ai_first', ai: ['handled'], automations: { 'replies:exact_only': 1 } });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('automation_exact');
    expect(h.aiCallCount()).toBe(0);
  });

  it('skips the exact automation pass when the message cannot be a keyword trigger', async () => {
    const h = harness({ mode: 'ai_first', triggers: ['new_message_received'], ai: ['handled'] });
    await routeInbound(h.deps);
    expect(h.calls.some((c) => c.includes('exact_only'))).toBe(false);
  });
});

describe('routeInbound — primary handler per mode', () => {
  it('ai_first: AI replies, other flows never run', async () => {
    const h = harness({ mode: 'ai_first', ai: ['handled'], flows: { non_exact: true } });
    const r = await routeInbound(h.deps);
    expect(r).toEqual({ repliedBy: 'ai', aiOutcome: 'handled' });
    expect(h.calls).not.toContain('flows:non_exact');
  });

  it('ai_first: AI declines, then a flow answers', async () => {
    const h = harness({ mode: 'ai_first', ai: ['declined'], flows: { non_exact: true } });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('flow');
    expect(h.calls.indexOf('ai:declined')).toBeLessThan(h.calls.indexOf('flows:non_exact'));
  });

  it('flows_first: a flow answers, the AI never runs', async () => {
    const h = harness({ mode: 'flows_first', ai: ['handled'], flows: { non_exact: true } });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('flow');
    expect(h.aiCallCount()).toBe(0);
  });

  it('flows_first: no flow matches, then the AI answers', async () => {
    const h = harness({ mode: 'flows_first', ai: ['handled'] });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('ai');
    expect(h.calls.indexOf('flows:non_exact')).toBeLessThan(h.calls.indexOf('ai:handled'));
  });

  it('flows_only: the AI never runs, even when no flow matches', async () => {
    const h = harness({ mode: 'flows_only', ai: ['handled'] });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('none');
    expect(h.aiCallCount()).toBe(0);
  });

  it('ai_only: no new flow starts when the AI declines', async () => {
    const h = harness({ mode: 'ai_only', ai: ['declined'], flows: { non_exact: true } });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('none');
    expect(h.calls).not.toContain('flows:non_exact');
  });
});

describe('routeInbound — AI failure', () => {
  it.each<InboundRoutingMode>(['ai_first', 'flows_first', 'ai_only'])('retries once, then sends the fallback (%s)', async (mode) => {
    const h = harness({ mode, ai: ['failed', 'failed'], flows: {}, automations: { 'replies:any': 1, 'replies:skip_exact': 1 } });
    const r = await routeInbound(h.deps);
    expect(r).toEqual({ repliedBy: 'fallback', aiOutcome: 'failed' });
    expect(h.aiCallCount()).toBe(2);
    expect(h.calls).toContain('fallback');
  });

  it('never falls through to flows or reply automations', async () => {
    const h = harness({ mode: 'ai_first', ai: ['failed'], flows: { non_exact: true }, automations: { 'replies:any': 1 } });
    await routeInbound(h.deps);
    expect(h.calls).not.toContain('flows:non_exact');
    expect(replyCalls(h.calls)).toEqual([]);
    expect(h.calls.some((c) => c.includes('replies_opted_in'))).toBe(false);
  });

  it('a successful retry is a normal AI reply, with no fallback', async () => {
    const h = harness({ mode: 'ai_first', ai: ['failed', 'handled'] });
    const r = await routeInbound(h.deps);
    expect(r).toEqual({ repliedBy: 'ai', aiOutcome: 'handled' });
    expect(h.calls).not.toContain('fallback');
  });

  it('a retry that declines is treated as a decline', async () => {
    const h = harness({ mode: 'ai_first', ai: ['failed', 'declined'], flows: { non_exact: true } });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('flow');
    expect(h.calls).not.toContain('fallback');
  });

  it('still runs side-effect automations after a failure', async () => {
    const h = harness({ mode: 'ai_first', ai: ['failed'] });
    await routeInbound(h.deps);
    expect(sideEffectCalls(h.calls)).toHaveLength(2);
  });
});

describe('routeInbound — automations', () => {
  it('reply automations run only when nothing replied, for every trigger', async () => {
    const h = harness({
      mode: 'ai_first',
      triggers: ['first_inbound_message', 'new_message_received', 'keyword_match'],
      ai: ['declined'],
      automations: { 'replies:any': 1 },
    });
    const r = await routeInbound(h.deps);
    expect(r.repliedBy).toBe('automation');
    expect(replyCalls(h.calls)).toEqual([
      'auto:first_inbound_message:replies:any',
      'auto:new_message_received:replies:any',
      'auto:keyword_match:replies:skip_exact',
    ]);
  });

  it('reply automations do not run after an AI reply', async () => {
    const h = harness({ mode: 'ai_first', ai: ['handled'] });
    await routeInbound(h.deps);
    expect(replyCalls(h.calls)).toEqual([]);
  });

  it('reply automations do not run after a flow reply', async () => {
    const h = harness({ mode: 'flows_first', flows: { non_exact: true } });
    await routeInbound(h.deps);
    expect(replyCalls(h.calls)).toEqual([]);
    expect(h.calls.some((c) => c.includes('replies_opted_in'))).toBe(false);
  });

  it('"send even if AI replied" automations run only after an AI reply', async () => {
    const h = harness({ mode: 'ai_first', ai: ['handled'] });
    await routeInbound(h.deps);
    expect(h.calls.filter((c) => c.includes('replies_opted_in'))).toHaveLength(2);
  });

  it.each<[InboundRoutingMode, Setup['ai'], Setup['flows']]>([
    ['ai_first', ['handled'], {}],
    ['ai_first', ['declined'], {}],
    ['flows_first', ['declined'], { non_exact: true }],
    ['flows_only', ['declined'], {}],
    ['ai_only', ['declined'], {}],
    ['ai_first', ['declined'], { exact_keyword: true }],
  ])('side-effect automations always run, last (%s)', async (mode, ai, flows) => {
    const h = harness({ mode, ai, flows });
    await routeInbound(h.deps);
    const sides = sideEffectCalls(h.calls);
    expect(sides).toEqual(['auto:new_message_received:side_effects:any', 'auto:keyword_match:side_effects:any']);
    expect(h.calls.slice(-2)).toEqual(sides);
  });

  it('reports nobody when nothing answered', async () => {
    const h = harness({ mode: 'ai_first', ai: ['declined'] });
    const r = await routeInbound(h.deps);
    expect(r).toEqual({ repliedBy: 'none', aiOutcome: 'declined' });
  });
});
