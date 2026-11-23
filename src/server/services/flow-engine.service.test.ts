import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FALLBACK_POLICY, type FlowFallbackPolicyDto } from '../dtos/flow.dto';
import {
  FlowEngineService,
  decideFallbackAction,
  evaluateConditionPredicate,
  interpolateVars,
  interpolateUrl,
  delayToMs,
  extractHttpValue,
  MIN_DELAY_MS,
  MAX_DELAY_MS,
  matchReplyId,
  matchesKeywordTrigger,
  type FlowEngineDeps,
  type FlowDispatchInput,
} from './flow-engine.service';
import type { FlowNodeRow, FlowRunRow } from '../repositories/flow.repository';

const now = new Date('2026-06-01T12:00:00.000Z');
const TAG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const TARGET = {
  conversationId: 'conv-1',
  contactId: 'contact-1',
  phone: '+15551230000',
  status: 'open',
  lastInboundAt: new Date(now.getTime() - 60_000),
};

function node(nodeKey: string, nodeType: string, config: Record<string, unknown>): FlowNodeRow {
  return { nodeKey, nodeType, config } as FlowNodeRow;
}

function run(overrides: Partial<FlowRunRow> = {}): FlowRunRow {
  return {
    id: 'run-1',
    flowId: 'flow-1',
    status: 'active',
    currentNodeKey: 'ask',
    vars: {},
    repromptCount: 0,
    startedAt: now,
    lastAdvancedAt: now,
    endedAt: null,
    endReason: null,
    contactId: 'contact-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    ...overrides,
  } as FlowRunRow;
}

function flowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flow-1',
    name: 'Menu',
    description: null,
    status: 'active',
    triggerType: 'keyword',
    triggerConfig: { keywords: ['menu'], match_type: 'contains', case_sensitive: false },
    entryNodeId: 'start',
    fallbackPolicy: DEFAULT_FALLBACK_POLICY,
    executionCount: 0,
    lastExecutedAt: null,
    createdAt: now,
    updatedAt: now,
    _count: { nodes: 2 },
    ...overrides,
  };
}

function makeDeps(nodes: FlowNodeRow[]) {
  const flows = {
    listActiveForTrigger: vi.fn(async () => [{ ...flowRow(), nodes }]),
    findById: vi.fn(async () => flowRow()),
    listNodes: vi.fn(async () => nodes),
    incrementExecutionCount: vi.fn(async () => undefined),
  };
  const runs = {
    findActiveForContact: vi.fn(async (): Promise<FlowRunRow | null> => null),
    startRun: vi.fn(async (): Promise<FlowRunRow | null> => run({ currentNodeKey: 'start' })),
    advanceCurrentNode: vi.fn(async () => true),
    setVars: vi.fn(async () => undefined),
    setRepromptCount: vi.fn(async () => undefined),
    setLastPromptMessage: vi.fn(async () => undefined),
    endRun: vi.fn(async () => undefined),
    // Annotated so `mock.calls` is a tuple the assertions can index.
    logEvent: vi.fn(
      async (_input: {
        flowRunId: string;
        eventType: string;
        nodeKey: string | null;
        payload: unknown;
      }): Promise<void> => undefined,
    ),
    findStaleActive: vi.fn(async (): Promise<unknown[]> => []),
    timeOut: vi.fn(async () => true),
    park: vi.fn(async () => true),
    findDueParked: vi.fn(async (): Promise<FlowRunRow[]> => []),
    claimResume: vi.fn(async () => true),
  };
  const contacts = {
    addTags: vi.fn(async () => undefined),
    removeTag: vi.fn(async () => undefined),
    hasTag: vi.fn(async () => false),
    findDetail: vi.fn(async () => ({ id: 'contact-1', name: 'Ada', email: null, phone: '+1', company: null })),
  };
  const conversations = { update: vi.fn(async () => undefined) };
  const outbound = {
    resolveTarget: vi.fn(async () => TARGET),
    sendText: vi.fn(async () => ({ messageId: 'm1', whatsappMessageId: 'wamid.1', conversationId: 'conv-1' })),
    sendButtons: vi.fn(async () => ({ messageId: 'm2', whatsappMessageId: 'wamid.2', conversationId: 'conv-1' })),
    sendList: vi.fn(async () => ({ messageId: 'm3', whatsappMessageId: 'wamid.3', conversationId: 'conv-1' })),
    sendMedia: vi.fn(async () => ({ messageId: 'm4', whatsappMessageId: 'wamid.4', conversationId: 'conv-1' })),
    sendTemplate: vi.fn(async () => ({ messageId: 'm5', whatsappMessageId: 'wamid.5', conversationId: 'conv-1' })),
  };

  return { flows, runs, contacts, conversations, outbound } as unknown as FlowEngineDeps & {
    flows: typeof flows;
    runs: typeof runs;
    contacts: typeof contacts;
    conversations: typeof conversations;
    outbound: typeof outbound;
  };
}

function engine(nodes: FlowNodeRow[]) {
  const deps = makeDeps(nodes);
  return { deps, service: new FlowEngineService(deps, 'user-1') };
}

function inbound(overrides: Partial<FlowDispatchInput> = {}): FlowDispatchInput {
  return {
    contactId: 'contact-1',
    conversationId: 'conv-1',
    message: { kind: 'text', text: 'menu', metaMessageId: 'wamid.in' },
    isFirstInboundMessage: false,
    ...overrides,
  };
}

type LogEventMock = ReturnType<typeof makeDeps>['runs']['logEvent'];

/** Event types recorded, in order. */
function events(logEvent: LogEventMock): string[] {
  return logEvent.mock.calls.map((call) => call[0].eventType);
}

/** Every recorded event serialised, for asserting what is *not* stored. */
function eventPayloads(logEvent: LogEventMock): string[] {
  return logEvent.mock.calls.map((call) => JSON.stringify(call[0]));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

describe('matchReplyId', () => {
  it('resolves a tapped button to its target node', () => {
    const buttons = node('ask', 'send_buttons', {
      text: 'Pick',
      buttons: [
        { reply_id: 'yes', title: 'Yes', next_node_key: 'thanks' },
        { reply_id: 'no', title: 'No', next_node_key: 'bye' },
      ],
    });

    expect(matchReplyId(buttons, 'no')).toBe('bye');
    expect(matchReplyId(buttons, 'maybe')).toBeNull();
  });

  it('searches every list section', () => {
    const list = node('ask', 'send_list', {
      text: 'Pick',
      button_label: 'Open',
      sections: [
        { title: 'A', rows: [{ reply_id: 'a1', title: 'A1', next_node_key: 'na' }] },
        { title: 'B', rows: [{ reply_id: 'b1', title: 'B1', next_node_key: 'nb' }] },
      ],
    });

    expect(matchReplyId(list, 'b1')).toBe('nb');
  });
});

describe('matchesKeywordTrigger', () => {
  it('matches contains by default and honours exact', () => {
    expect(matchesKeywordTrigger('show me the MENU', { keywords: ['menu'] })).toBe(true);
    expect(matchesKeywordTrigger('show me the menu', { keywords: ['menu'], match_type: 'exact' })).toBe(false);
    expect(matchesKeywordTrigger('menu', { keywords: ['menu'], match_type: 'exact' })).toBe(true);
  });

  it('respects case sensitivity when asked', () => {
    expect(matchesKeywordTrigger('MENU', { keywords: ['menu'], case_sensitive: true })).toBe(false);
  });

  it('never matches an empty keyword list', () => {
    expect(matchesKeywordTrigger('anything', { keywords: [] })).toBe(false);
  });
});

describe('evaluateConditionPredicate', () => {
  const cases: Array<[string, boolean]> = [
    ['present', true],
    ['absent', false],
  ];

  it.each(cases)('handles %s against a set value', (operator, expected) => {
    expect(
      evaluateConditionPredicate({
        operator: operator as 'present' | 'absent',
        subjectValue: 'x',
        configValue: undefined,
      }),
    ).toBe(expected);
  });

  it('treats an absent subject as not equal and not containing', () => {
    expect(
      evaluateConditionPredicate({ operator: 'equals', subjectValue: undefined, configValue: '' }),
    ).toBe(false);
    expect(
      evaluateConditionPredicate({ operator: 'contains', subjectValue: undefined, configValue: '' }),
    ).toBe(false);
  });
});

describe('decideFallbackAction', () => {
  const policy = (overrides: Partial<FlowFallbackPolicyDto> = {}): FlowFallbackPolicyDto => ({
    ...DEFAULT_FALLBACK_POLICY,
    ...overrides,
  });

  it('reprompts up to the limit, then applies on_exhaust', () => {
    expect(decideFallbackAction(policy({ max_reprompts: 2 }), 1)).toBe('reprompt');
    expect(decideFallbackAction(policy({ max_reprompts: 2 }), 2)).toBe('reprompt');
    expect(decideFallbackAction(policy({ max_reprompts: 2, on_exhaust: 'end' }), 3)).toBe('end');
  });

  it('short-circuits for the non-reprompt policies', () => {
    expect(decideFallbackAction(policy({ on_no_match: 'ignore' }), 9)).toBe('ignore');
    expect(decideFallbackAction(policy({ on_no_match: 'handoff' }), 0)).toBe('handoff');
    expect(decideFallbackAction(policy({ on_no_match: 'end' }), 0)).toBe('end');
  });
});

describe('interpolateVars', () => {
  it('substitutes captured values', () => {
    expect(interpolateVars('Thanks {{vars.name}}', { name: 'Ada' })).toBe('Thanks Ada');
    expect(interpolateVars('Thanks {{vars.name}}', {})).toBe('Thanks ');
    // AI-generated flows write bare keys; customers used to see the raw placeholder.
    expect(interpolateVars('Patient: {{patient_name}}, Age: {{ patient_age }}', { patient_name: 'Swapnil', patient_age: '26' })).toBe('Patient: Swapnil, Age: 26');
    expect(interpolateVars('Hi {{missing}}', {})).toBe('Hi ');
    // Meta template parameters are not flow variables.
    expect(interpolateVars('Code {{1}}', { '1': 'x' })).toBe('Code {{1}}');
  });
});

describe('starting a run', () => {
  const nodes = [
    node('start', 'start', { next_node_key: 'greet' }),
    node('greet', 'send_message', { text: 'Hello {{vars.x}}', next_node_key: 'ask' }),
    node('ask', 'send_buttons', {
      text: 'Pick',
      buttons: [{ reply_id: 'a', title: 'A', next_node_key: 'done' }],
    }),
    node('done', 'end', {}),
  ];

  it('walks auto-advancing nodes and suspends at the prompt', async () => {
    const { deps, service } = engine(nodes);

    const result = await service.dispatchInbound(inbound());

    expect(result).toEqual({ consumed: true, flowRunId: 'run-1', outcome: 'started' });
    expect(deps.outbound.sendText).toHaveBeenCalledWith(TARGET, 'Hello ');
    expect(deps.outbound.sendButtons).toHaveBeenCalled();
    expect(deps.runs.advanceCurrentNode).toHaveBeenCalledWith({
      runId: 'run-1',
      expectedNodeKey: 'start',
      nextNodeKey: 'ask',
    });
  });

  it('increments the flow execution counter', async () => {
    const { deps, service } = engine(nodes);

    await service.dispatchInbound(inbound());

    expect(deps.flows.incrementExecutionCount).toHaveBeenCalledWith('flow-1');
  });

  it('records the prompt message so the inbox can quote it', async () => {
    const { deps, service } = engine(nodes);

    await service.dispatchInbound(inbound());

    expect(deps.runs.setLastPromptMessage).toHaveBeenCalledWith('run-1', 'm2');
  });

  it('treats losing the start race as consumed so automations do not double-answer', async () => {
    const { deps, service } = engine(nodes);
    deps.runs.startRun.mockResolvedValueOnce(null);

    expect(await service.dispatchInbound(inbound())).toEqual({ consumed: true, outcome: 'no_match' });
    expect(deps.outbound.sendText).not.toHaveBeenCalled();
  });

  it('ignores an interactive reply as a trigger', async () => {
    const { deps, service } = engine(nodes);

    const result = await service.dispatchInbound(
      inbound({
        message: { kind: 'interactive_reply', replyId: 'a', replyTitle: 'A', metaMessageId: 'wamid.in' },
      }),
    );

    expect(result.consumed).toBe(false);
    expect(deps.runs.startRun).not.toHaveBeenCalled();
  });

  it('starts a first_inbound_message flow only on the first message', async () => {
    const { deps, service } = engine(nodes);
    deps.flows.listActiveForTrigger.mockResolvedValue([
      { ...flowRow({ triggerType: 'first_inbound_message', triggerConfig: {} }), nodes },
    ]);

    expect((await service.dispatchInbound(inbound({ isFirstInboundMessage: false }))).consumed).toBe(false);
    expect((await service.dispatchInbound(inbound({ isFirstInboundMessage: true }))).consumed).toBe(true);
  });
});

describe('advancing a live run', () => {
  const nodes = [
    node('ask', 'send_buttons', {
      text: 'Pick',
      buttons: [{ reply_id: 'a', title: 'A', next_node_key: 'done' }],
    }),
    node('done', 'end', {}),
  ];

  it('advances on a matching tap', async () => {
    const { deps, service } = engine(nodes);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run());

    const result = await service.dispatchInbound(
      inbound({
        message: { kind: 'interactive_reply', replyId: 'a', replyTitle: 'A', metaMessageId: 'wamid.in' },
      }),
    );

    expect(result.outcome).toBe('completed');
    expect(deps.runs.endRun).toHaveBeenCalledWith('run-1', 'completed', 'end_node');
  });

  it('captures free text into vars on a collect_input node', async () => {
    const { deps, service } = engine([
      node('ask', 'collect_input', { prompt_text: 'Your name?', var_key: 'name', next_node_key: 'done' }),
      node('done', 'end', {}),
    ]);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run());

    await service.dispatchInbound(inbound({ message: { kind: 'text', text: '  Ada  ', metaMessageId: 'w' } }));

    expect(deps.runs.setVars).toHaveBeenCalledWith('run-1', { name: 'Ada' });
  });

  it('never records the customer text, only its length', async () => {
    const { deps, service } = engine(nodes);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run());

    await service.dispatchInbound(inbound({ message: { kind: 'text', text: '4111111111111111', metaMessageId: 'w' } }));

    const payloads = eventPayloads(deps.runs.logEvent);
    expect(payloads.some((payload) => payload.includes('4111111111111111'))).toBe(false);
    expect(payloads.some((payload) => payload.includes('"textLength":16'))).toBe(true);
  });

  it('reprompts on an unmatched reply', async () => {
    const { deps, service } = engine(nodes);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run());

    const result = await service.dispatchInbound(
      inbound({
        message: { kind: 'interactive_reply', replyId: 'nope', replyTitle: '?', metaMessageId: 'w' },
      }),
    );

    expect(result.outcome).toBe('fallback_fired');
    expect(deps.runs.setRepromptCount).toHaveBeenCalledWith('run-1', 1);
    expect(deps.outbound.sendButtons).toHaveBeenCalled();
  });

  it('hands off once reprompts are exhausted', async () => {
    const { deps, service } = engine(nodes);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run({ repromptCount: 2 }));

    const result = await service.dispatchInbound(
      inbound({ message: { kind: 'interactive_reply', replyId: 'nope', replyTitle: '?', metaMessageId: 'w' } }),
    );

    expect(result.outcome).toBe('handed_off');
    expect(deps.conversations.update).toHaveBeenCalledWith('conv-1', { status: 'pending' });
    expect(deps.runs.endRun).toHaveBeenCalledWith('run-1', 'handed_off', 'fallback_exhausted');
  });

  it('leaves an ignore-policy message unconsumed so automations still fire', async () => {
    const { deps, service } = engine(nodes);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run());
    deps.flows.findById.mockResolvedValueOnce(
      flowRow({ fallbackPolicy: { ...DEFAULT_FALLBACK_POLICY, on_no_match: 'ignore' } }),
    );

    const result = await service.dispatchInbound(
      inbound({ message: { kind: 'text', text: 'off script', metaMessageId: 'w' } }),
    );

    expect(result.consumed).toBe(false);
  });

  it('honours a legacy on_unknown_reply policy instead of reverting to defaults', async () => {
    const { deps, service } = engine(nodes);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run());
    deps.flows.findById.mockResolvedValueOnce(
      flowRow({
        fallbackPolicy: {
          on_unknown_reply: 'handoff',
          max_reprompts: 2,
          on_exhaust: 'handoff',
          on_timeout_hours: 24,
        },
      }),
    );

    const result = await service.dispatchInbound(
      inbound({ message: { kind: 'text', text: 'off script', metaMessageId: 'w' } }),
    );

    expect(result.outcome).toBe('handed_off');
  });

  it('fails the run when the current node was deleted by an edit', async () => {
    const { deps, service } = engine([node('other', 'end', {})]);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run());

    const result = await service.dispatchInbound(inbound());

    expect(result.outcome).toBe('failed');
    expect(deps.runs.endRun).toHaveBeenCalledWith('run-1', 'failed', 'current_node_not_found');
  });
});

describe('condition and set_tag nodes', () => {
  it('branches on a tag and keeps walking', async () => {
    const { deps, service } = engine([
      node('start', 'start', { next_node_key: 'check' }),
      node('check', 'condition', {
        subject: 'tag',
        subject_key: TAG,
        operator: 'present',
        true_next: 'vip',
        false_next: 'normal',
      }),
      node('vip', 'send_message', { text: 'VIP', next_node_key: 'done' }),
      node('normal', 'send_message', { text: 'Hi', next_node_key: 'done' }),
      node('done', 'end', {}),
    ]);
    deps.contacts.hasTag.mockResolvedValue(true);

    await service.dispatchInbound(inbound());

    expect(deps.outbound.sendText).toHaveBeenCalledWith(TARGET, 'VIP');
  });

  it('does not strand the run when a tag write fails', async () => {
    const { deps, service } = engine([
      node('start', 'start', { next_node_key: 'tag' }),
      node('tag', 'set_tag', { mode: 'add', tag_id: TAG, next_node_key: 'done' }),
      node('done', 'end', {}),
    ]);
    deps.contacts.addTags.mockRejectedValueOnce(new Error('deadlock'));

    const result = await service.dispatchInbound(inbound());

    expect(result.outcome).toBe('completed');
    expect(events(deps.runs.logEvent)).toContain('error');
  });

  it('fails cleanly on a node type with no executor', async () => {
    const { deps, service } = engine([
      node('start', 'start', { next_node_key: 'fetch' }),
      node('fetch', 'http_fetch', { url: 'https://example.com' }),
    ]);

    const result = await service.dispatchInbound(inbound());

    expect(result.outcome).toBe('failed');
    expect(deps.runs.endRun).toHaveBeenCalledWith('run-1', 'failed', 'unsupported_node_type:http_fetch');
  });
});

describe('send_media and send_template nodes', () => {
  it('sends media with an interpolated caption, then keeps walking', async () => {
    const { deps, service } = engine([
      node('start', 'start', { next_node_key: 'pic' }),
      node('pic', 'send_media', { media_type: 'document', url: 'https://x.test/a.pdf', caption: 'Hi {{vars.name}}', filename: 'a.pdf', next_node_key: 'done' }),
      node('done', 'end', {}),
    ]);
    deps.runs.startRun.mockResolvedValueOnce(run({ currentNodeKey: 'start', vars: { name: 'Asha' } }));

    const result = await service.dispatchInbound(inbound());

    expect(deps.outbound.sendMedia).toHaveBeenCalledWith(TARGET, { type: 'document', url: 'https://x.test/a.pdf', caption: expect.stringContaining('Hi'), filename: 'a.pdf' });
    expect(result.outcome).toBe('completed');
  });

  it('sends a template (usable outside the 24h window) with interpolated variables', async () => {
    const { deps, service } = engine([
      node('start', 'start', { next_node_key: 'tpl' }),
      node('tpl', 'send_template', { template_name: 'offer', language: 'en_US', params: ['{{vars.name}}', '20%'], next_node_key: 'done' }),
      node('done', 'end', {}),
    ]);

    const result = await service.dispatchInbound(inbound());

    expect(deps.outbound.sendTemplate).toHaveBeenCalledWith(TARGET, { templateName: 'offer', language: 'en_US', params: expect.any(Array) });
    expect(result.outcome).toBe('completed');
  });

  it('fails the run with a named reason when the media send is rejected', async () => {
    const { deps, service } = engine([
      node('start', 'start', { next_node_key: 'pic' }),
      node('pic', 'send_media', { media_type: 'image', url: 'https://x.test/a.png', next_node_key: 'done' }),
      node('done', 'end', {}),
    ]);
    deps.outbound.sendMedia.mockRejectedValueOnce(new Error('Meta rejected the media'));

    const result = await service.dispatchInbound(inbound());

    expect(result.outcome).toBe('failed');
    expect(deps.runs.endRun).toHaveBeenCalledWith('run-1', 'failed', 'send_media_failed');
  });
});

describe('sweepStale', () => {
  it('uses each flow own timeout rather than a global default', async () => {
    const { deps, service } = engine([]);
    deps.runs.findStaleActive.mockResolvedValueOnce([
      {
        id: 'run-young',
        flowId: 'flow-1',
        lastAdvancedAt: new Date(now.getTime() - 2 * 3_600_000),
        flow: { fallbackPolicy: { ...DEFAULT_FALLBACK_POLICY, on_timeout_hours: 24 } },
      },
      {
        id: 'run-old',
        flowId: 'flow-2',
        lastAdvancedAt: new Date(now.getTime() - 2 * 3_600_000),
        flow: { fallbackPolicy: { ...DEFAULT_FALLBACK_POLICY, on_timeout_hours: 1 } },
      },
    ]);

    const result = await service.sweepStale();

    expect(result).toEqual({ scanned: 2, timedOut: 1 });
    expect(deps.runs.timeOut).toHaveBeenCalledTimes(1);
    expect(deps.runs.timeOut).toHaveBeenCalledWith('run-old');
  });
});

describe('resilience', () => {
  it('reports no_match rather than throwing when the database fails', async () => {
    const { deps, service } = engine([]);
    deps.runs.findActiveForContact.mockRejectedValueOnce(new Error('connection lost'));

    expect(await service.dispatchInbound(inbound())).toEqual({ consumed: false, outcome: 'failed' });
  });
});


describe('delay node', () => {
  it('parks the run at the delay node instead of advancing', async () => {
    const { deps, service } = engine([
      node('start', 'start', { next_node_key: 'wait' }),
      node('wait', 'delay', { amount: 2, unit: 'hours', next_node_key: 'after' }),
      node('after', 'send_message', { text: 'Still there?', next_node_key: 'done' }),
      node('done', 'end', {}),
    ]);

    const result = await service.dispatchInbound(inbound());

    expect(deps.runs.park).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', nodeKey: 'wait' }));
    const resumeAt = (deps.runs.park.mock.calls[0] as unknown as [{ resumeAt: Date }])[0].resumeAt;
    expect(resumeAt.getTime() - Date.now()).toBeGreaterThan(2 * 3_600_000 - 5_000);
    expect(deps.outbound.sendText).not.toHaveBeenCalled();
    expect(result.outcome).toBe('started');
  });

  it('clamps the wait between one minute and thirty days', () => {
    expect(delayToMs({ amount: 0, unit: 'minutes' })).toBe(MIN_DELAY_MS);
    expect(delayToMs({ amount: 5, unit: 'minutes' })).toBe(300_000);
    expect(delayToMs({ amount: 1, unit: 'days' })).toBe(86_400_000);
    expect(delayToMs({ amount: 999, unit: 'days' })).toBe(MAX_DELAY_MS);
    expect(delayToMs({ amount: 'x', unit: 'hours' })).toBe(MIN_DELAY_MS);
  });

  it('does not consume a customer message while waiting', async () => {
    const { deps, service } = engine([node('wait', 'delay', { amount: 1, unit: 'hours', next_node_key: 'x' })]);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run({ currentNodeKey: 'wait', resumeAt: new Date(Date.now() + 60_000) } as Partial<FlowRunRow>));

    const result = await service.dispatchInbound(inbound());

    expect(result).toMatchObject({ consumed: false, outcome: 'no_match' });
    expect(deps.runs.endRun).not.toHaveBeenCalled();
  });

  it('ends the run when stop_on_reply is set, still leaving the message to others', async () => {
    const { deps, service } = engine([node('wait', 'delay', { amount: 1, unit: 'hours', stop_on_reply: true, next_node_key: 'x' })]);
    deps.runs.findActiveForContact.mockResolvedValueOnce(run({ currentNodeKey: 'wait', resumeAt: new Date(Date.now() + 60_000) } as Partial<FlowRunRow>));

    const result = await service.dispatchInbound(inbound());

    expect(result.consumed).toBe(false);
    expect(deps.runs.endRun).toHaveBeenCalledWith('run-1', 'completed', 'replied_during_delay');
  });

  it('resumes due runs once, continuing after the delay node', async () => {
    const { deps, service } = engine([
      node('wait', 'delay', { amount: 1, unit: 'hours', next_node_key: 'after' }),
      node('after', 'send_message', { text: 'Back again', next_node_key: 'done' }),
      node('done', 'end', {}),
    ]);
    deps.runs.findDueParked.mockResolvedValueOnce([run({ currentNodeKey: 'wait', resumeAt: new Date(now.getTime() - 1000) } as Partial<FlowRunRow>)]);

    const result = await service.resumeDue(now);

    expect(result).toEqual({ due: 1, resumed: 1 });
    expect(deps.runs.claimResume).toHaveBeenCalledWith('run-1', now);
    expect(deps.outbound.sendText).toHaveBeenCalledWith(TARGET, 'Back again');
    expect(deps.runs.endRun).toHaveBeenCalledWith('run-1', 'completed', 'end_node');
  });

  it('skips a run another worker already claimed', async () => {
    const { deps, service } = engine([node('wait', 'delay', { amount: 1, unit: 'hours', next_node_key: 'after' })]);
    deps.runs.findDueParked.mockResolvedValueOnce([run({ currentNodeKey: 'wait' })]);
    deps.runs.claimResume.mockResolvedValueOnce(false);

    expect(await service.resumeDue(now)).toEqual({ due: 1, resumed: 0 });
    expect(deps.outbound.sendText).not.toHaveBeenCalled();
  });

  it('fails a due run whose delay node was deleted in the meantime', async () => {
    const { deps, service } = engine([node('other', 'end', {})]);
    deps.runs.findDueParked.mockResolvedValueOnce([run({ currentNodeKey: 'wait' })]);

    await service.resumeDue(now);

    expect(deps.runs.endRun).toHaveBeenCalledWith('run-1', 'failed', 'resume_node_missing');
  });
});

describe('http_request node', () => {
  const flowNodes = (config: Record<string, unknown>) => [
    node('start', 'start', { next_node_key: 'call' }),
    node('call', 'http_request', { url: 'https://api.example.com/order?phone={{vars.phone}}', method: 'GET', next_node_key: 'ok', ...config }),
    node('ok', 'send_message', { text: 'Status: {{vars.status}}', next_node_key: 'done' }),
    node('bad', 'send_message', { text: 'Sorry, try later', next_node_key: 'done' }),
    node('done', 'end', {}),
  ];

  it('calls the API, stores the JSON field and uses it in the next message', async () => {
    const { deps, service } = engine(flowNodes({ save_as: 'status', json_path: 'data.status', auth_header: 'Bearer t0k' }));
    const http = vi.fn(async () => ({ status: 200, text: JSON.stringify({ data: { status: 'shipped' } }), truncated: false }));
    deps.http = http;

    const result = await service.dispatchInbound(inbound());

    expect(http).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.example.com/order?phone=', method: 'GET', headers: { Authorization: 'Bearer t0k' } }));
    expect(deps.runs.setVars).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'shipped' }));
    expect(deps.outbound.sendText).toHaveBeenCalledWith(TARGET, 'Status: shipped');
    expect(result.outcome).toBe('completed');
  });

  it('sends contact and variables as JSON on POST', async () => {
    const { deps, service } = engine(flowNodes({ method: 'POST', url: 'https://api.example.com/lead' }));
    const http = vi.fn(async (_input: { body?: string }) => ({ status: 201, text: '{}', truncated: false }));
    deps.http = http;

    await service.dispatchInbound(inbound());

    const body = JSON.parse(http.mock.calls[0][0].body ?? '{}');
    expect(body.contact).toMatchObject({ name: 'Ada' });
    expect(body.flowRunId).toBe('run-1');
  });

  it('takes the error path on a non-2xx answer', async () => {
    const { deps, service } = engine(flowNodes({ on_error_next_key: 'bad' }));
    deps.http = vi.fn(async () => ({ status: 500, text: 'boom', truncated: false }));

    const result = await service.dispatchInbound(inbound());

    expect(deps.outbound.sendText).toHaveBeenCalledWith(TARGET, 'Sorry, try later');
    expect(result.outcome).toBe('completed');
    expect(events(deps.runs.logEvent)).toContain('error');
  });

  it('fails the run when there is no error path', async () => {
    const { deps, service } = engine(flowNodes({}));
    deps.http = vi.fn(async () => {
      throw new Error('socket hang up');
    });

    const result = await service.dispatchInbound(inbound());

    expect(result.outcome).toBe('failed');
    expect(deps.runs.endRun).toHaveBeenCalledWith('run-1', 'failed', 'http_request_failed');
  });

  it('never calls an internal address, even if a variable points at one', async () => {
    const { deps, service } = engine(flowNodes({ url: 'https://169.254.169.254/latest/meta-data', on_error_next_key: 'bad' }));
    const http = vi.fn(async () => ({ status: 200, text: 'secret', truncated: false }));
    deps.http = http;

    await service.dispatchInbound(inbound());

    expect(http).not.toHaveBeenCalled();
    expect(deps.outbound.sendText).toHaveBeenCalledWith(TARGET, 'Sorry, try later');
  });

  it('treats a missing JSON field as a failure', async () => {
    const { deps, service } = engine(flowNodes({ save_as: 'status', json_path: 'data.missing', on_error_next_key: 'bad' }));
    deps.http = vi.fn(async () => ({ status: 200, text: '{"data":{}}', truncated: false }));

    await service.dispatchInbound(inbound());

    expect(deps.outbound.sendText).toHaveBeenCalledWith(TARGET, 'Sorry, try later');
  });

  it('percent-encodes variable values so they cannot rewrite the URL', () => {
    expect(interpolateUrl('https://a.com/?q={{vars.q}}', { q: 'x&admin=1#' })).toBe('https://a.com/?q=x%26admin%3D1%23');
    expect(interpolateUrl('https://a.com/{{vars.none}}', {})).toBe('https://a.com/');
  });

  it('extracts and bounds the stored value', () => {
    expect(extractHttpValue('plain text')).toBe('plain text');
    expect(extractHttpValue('x'.repeat(5000))).toHaveLength(1000);
    expect(extractHttpValue('{"a":{"b":[1,2]}}', 'a.b')).toBe('[1,2]');
    expect(extractHttpValue('not json', 'a')).toBeUndefined();
  });
});
