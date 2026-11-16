import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AutomationEngineService,
  groupSiblings,
  interpolate,
  type AutomationEngineDeps,
} from './automation-engine.service';
import type { AutomationStepRow } from '../repositories/automation.repository';

const TAG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const PIPELINE = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';
const STAGE = '3f2504e0-4f89-11d3-9a0c-0305e82c3303';
const AGENT = '3f2504e0-4f89-11d3-9a0c-0305e82c3304';
const now = new Date('2026-06-01T12:00:00.000Z');

function step(
  overrides: Partial<AutomationStepRow> & Pick<AutomationStepRow, 'stepType' | 'stepConfig'>,
): AutomationStepRow {
  return {
    id: overrides.id ?? `step-${overrides.stepType}`,
    parentStepId: overrides.parentStepId ?? null,
    branch: overrides.branch ?? null,
    position: overrides.position ?? 0,
    stepType: overrides.stepType,
    stepConfig: overrides.stepConfig,
  };
}

const TARGET = {
  conversationId: 'conv-1',
  contactId: 'contact-1',
  phone: '+15551230000',
  status: 'open',
  lastInboundAt: new Date(now.getTime() - 60_000),
};

function makeDeps(steps: AutomationStepRow[]) {
  const automations = {
    listActiveForTrigger: vi.fn(async () => [
      {
        id: 'auto-1',
        triggerType: 'new_message_received',
        triggerConfig: {},
        steps,
      },
    ]),
    findById: vi.fn(async () => ({ id: 'auto-1', triggerType: 'new_message_received' })),
    listSteps: vi.fn(async () => steps),
    createLog: vi.fn(async () => ({ id: 'log-1' })),
    // Parameters are annotated so `mock.calls` types as a real tuple; an
    // inferred `() => …` mock gives `[]` and indexing it fails to compile.
    updateLog: vi.fn(
      async (
        _logId: string,
        _data: { stepsExecuted: unknown; status: string; errorMessage: string | null },
      ): Promise<void> => undefined,
    ),
    findLogSteps: vi.fn(async (): Promise<unknown> => []),
    recordExecution: vi.fn(async () => undefined),
  };
  const queue = { park: vi.fn(async () => ({ id: 'pending-1' })) };
  const contacts = {
    addTags: vi.fn(async () => undefined),
    removeTag: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    hasTag: vi.fn(async () => false),
    findDetail: vi.fn(async () => ({ id: 'contact-1', name: 'Ada', email: null, phone: '+1', company: null })),
  };
  const conversations = {
    update: vi.fn(async () => undefined),
    findByContact: vi.fn(async () => ({ id: 'conv-1' })),
    openLoadByAgent: vi.fn(async () => new Map<string, number>()),
  };
  const pipelines = {
    findStage: vi.fn(async (): Promise<{ id: string } | null> => ({ id: STAGE })),
  };
  const deals = { create: vi.fn(async () => ({ id: 'deal-1' })) };
  const profiles = {
    existsInTenant: vi.fn(async () => true),
    listMembers: vi.fn(async () => [{ userId: AGENT }]),
  };
  const outbound = {
    resolveTarget: vi.fn(async () => TARGET),
    sendText: vi.fn(async () => ({ messageId: 'm1', whatsappMessageId: 'wamid.1', conversationId: 'conv-1' })),
    sendTemplate: vi.fn(async () => ({ messageId: 'm2', whatsappMessageId: 'wamid.2', conversationId: 'conv-1' })),
  };

  return {
    automations,
    queue,
    contacts,
    conversations,
    pipelines,
    deals,
    profiles,
    outbound,
  } as unknown as AutomationEngineDeps & {
    automations: typeof automations;
    queue: typeof queue;
    contacts: typeof contacts;
    conversations: typeof conversations;
    pipelines: typeof pipelines;
    deals: typeof deals;
    profiles: typeof profiles;
    outbound: typeof outbound;
  };
}

function engine(steps: AutomationStepRow[]) {
  const deps = makeDeps(steps);
  return { deps, service: new AutomationEngineService(deps, 'user-1') };
}

const dispatch = { triggerType: 'new_message_received' as const, contactId: 'contact-1' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

type UpdateLogMock = ReturnType<typeof makeDeps>['automations']['updateLog'];

/** The last log write, which holds the full step outcome list. */
function lastLog(updateLog: UpdateLogMock) {
  const call = updateLog.mock.calls.at(-1);
  if (!call) throw new Error('updateLog was never called.');
  return call[1];
}

/** The log entry recorded for the nth executed step. */
function outcomeAt(updateLog: UpdateLogMock, index: number): Record<string, unknown> {
  const steps = lastLog(updateLog).stepsExecuted as Record<string, unknown>[];
  return steps[index];
}

describe('pure helpers', () => {
  it('groups siblings by parent and branch, ordered by position', () => {
    const groups = groupSiblings([
      step({ id: 'b', stepType: 'send_message', stepConfig: { text: 'b' }, position: 1 }),
      step({ id: 'a', stepType: 'send_message', stepConfig: { text: 'a' }, position: 0 }),
      step({ id: 'y', stepType: 'add_tag', stepConfig: {}, parentStepId: 'a', branch: 'yes', position: 0 }),
    ]);

    expect(groups.get('root|main')?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(groups.get('a|yes')?.map((s) => s.id)).toEqual(['y']);
  });

  it('interpolates vars and renders missing keys as empty', () => {
    expect(interpolate('Hi {{vars.name}}!', { vars: { name: 'Ada' } })).toBe('Hi Ada!');
    expect(interpolate('Hi {{vars.name}}!', {})).toBe('Hi !');
  });
});

describe('wait steps', () => {
  it('parks using the canonical amount/unit keys', async () => {
    const { deps, service } = engine([
      step({ id: 'w', stepType: 'wait', stepConfig: { amount: 2, unit: 'hours' } }),
    ]);

    await service.dispatch(dispatch);

    expect(deps.queue.park).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: 'auto-1',
        nextStepPosition: 1,
        runAt: new Date(now.getTime() + 2 * 3_600_000),
      }),
    );
    expect(outcomeAt(deps.automations.updateLog, 0).status).toBe('parked');
  });

  it('fails the step rather than parking at an invalid date when the legacy key is stored', async () => {
    // Rows written before the contract carried `duration`, which the old
    // engine multiplied into NaN milliseconds.
    const { deps, service } = engine([
      step({ id: 'w', stepType: 'wait', stepConfig: { duration: 2, unit: 'hours' } }),
    ]);

    await service.dispatch(dispatch);

    expect(deps.queue.park).not.toHaveBeenCalled();
    const outcome = outcomeAt(deps.automations.updateLog, 0);
    expect(outcome.status).toBe('failed');
    expect(String(outcome.error)).toContain('amount');
  });

  it('does not count a resume as a second execution', async () => {
    const steps = [step({ id: 's', stepType: 'add_tag', stepConfig: { tag_id: TAG } })];
    const { deps, service } = engine(steps);

    await service.resume({
      id: 'pending-1',
      automationId: 'auto-1',
      contactId: 'contact-1',
      logId: 'log-1',
      parentStepId: null,
      branch: null,
      nextStepPosition: 0,
      context: {},
    });

    expect(deps.automations.recordExecution).not.toHaveBeenCalled();
    expect(deps.automations.createLog).not.toHaveBeenCalled();
  });
});

describe('condition steps', () => {
  it('takes the yes branch when a tag is present', async () => {
    const steps = [
      step({
        id: 'c',
        stepType: 'condition',
        stepConfig: { subject: 'tag_presence', operand: TAG },
      }),
      step({
        id: 'yes-1',
        stepType: 'send_message',
        stepConfig: { text: 'You are tagged' },
        parentStepId: 'c',
        branch: 'yes',
      }),
      step({
        id: 'no-1',
        stepType: 'send_message',
        stepConfig: { text: 'You are not' },
        parentStepId: 'c',
        branch: 'no',
      }),
    ];
    const { deps, service } = engine(steps);
    deps.contacts.hasTag.mockResolvedValue(true);

    await service.dispatch(dispatch);

    expect(outcomeAt(deps.automations.updateLog, 0).branchChosen).toBe('yes');
    expect(deps.outbound.sendText).toHaveBeenCalledWith(TARGET, 'You are tagged');
  });

  it('matches message content case-insensitively', async () => {
    const steps = [
      step({
        id: 'c',
        stepType: 'condition',
        stepConfig: { subject: 'message_content', operand: 'REFUND' },
      }),
      step({
        id: 'yes-1',
        stepType: 'send_message',
        stepConfig: { text: 'Refunds team' },
        parentStepId: 'c',
        branch: 'yes',
      }),
    ];
    const { deps, service } = engine(steps);

    await service.dispatch({ ...dispatch, context: { messageText: 'I want a refund please' } });

    expect(outcomeAt(deps.automations.updateLog, 0).branchChosen).toBe('yes');
  });

  it('continues after the parent step once a branch is exhausted', async () => {
    const steps = [
      step({
        id: 'c',
        stepType: 'condition',
        stepConfig: { subject: 'message_content', operand: 'hi' },
        position: 0,
      }),
      step({
        id: 'yes-1',
        stepType: 'add_tag',
        stepConfig: { tag_id: TAG },
        parentStepId: 'c',
        branch: 'yes',
      }),
      step({ id: 'after', stepType: 'close_conversation', stepConfig: {}, position: 1 }),
    ];
    const { deps, service } = engine(steps);

    await service.dispatch({ ...dispatch, context: { messageText: 'hi' } });

    expect(deps.contacts.addTags).toHaveBeenCalled();
    expect(deps.conversations.update).toHaveBeenCalledWith('conv-1', { status: 'closed' });
  });
});

describe('steps the old engine could not perform', () => {
  it('closes a conversation', async () => {
    const { deps, service } = engine([
      step({ id: 'x', stepType: 'close_conversation', stepConfig: {} }),
    ]);

    await service.dispatch(dispatch);

    expect(deps.conversations.update).toHaveBeenCalledWith('conv-1', { status: 'closed' });
    expect(outcomeAt(deps.automations.updateLog, 0).status).toBe('success');
  });

  it('creates a deal with the configured title, value and currency', async () => {
    const { deps, service } = engine([
      step({
        id: 'd',
        stepType: 'create_deal',
        stepConfig: {
          pipeline_id: PIPELINE,
          stage_id: STAGE,
          title: 'Inbound lead',
          value: 4200,
          currency: 'EUR',
        },
      }),
    ]);

    await service.dispatch(dispatch);

    expect(deps.deals.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Inbound lead', value: 4200, currency: 'EUR' }),
    );
  });

  it('refuses to create a deal in a stage that no longer exists', async () => {
    const { deps, service } = engine([
      step({
        id: 'd',
        stepType: 'create_deal',
        stepConfig: { pipeline_id: PIPELINE, stage_id: STAGE, title: 'x', value: 0, currency: 'USD' },
      }),
    ]);
    deps.pipelines.findStage.mockResolvedValueOnce(null);

    await service.dispatch(dispatch);

    expect(deps.deals.create).not.toHaveBeenCalled();
    expect(outcomeAt(deps.automations.updateLog, 0).status).toBe('failed');
  });

  it('assigns round-robin to the least-loaded agent', async () => {
    const busy = '3f2504e0-4f89-11d3-9a0c-0305e82c3305';
    const { deps, service } = engine([
      step({ id: 'a', stepType: 'assign_conversation', stepConfig: { mode: 'round_robin' } }),
    ]);
    deps.profiles.listMembers.mockResolvedValueOnce([{ userId: busy }, { userId: AGENT }]);
    deps.conversations.openLoadByAgent.mockResolvedValueOnce(new Map([[busy, 7]]));

    await service.dispatch(dispatch);

    expect(deps.conversations.update).toHaveBeenCalledWith('conv-1', { assignedAgentId: AGENT });
  });

  it('skips assignment to an agent who has left the tenant', async () => {
    const { deps, service } = engine([
      step({
        id: 'a',
        stepType: 'assign_conversation',
        stepConfig: { mode: 'specific', agent_id: AGENT },
      }),
    ]);
    deps.profiles.existsInTenant.mockResolvedValueOnce(false);

    await service.dispatch(dispatch);

    expect(deps.conversations.update).not.toHaveBeenCalled();
    expect(outcomeAt(deps.automations.updateLog, 0).status).toBe('skipped');
  });

  it('writes a contact field from the canonical field/value keys', async () => {
    const { deps, service } = engine([
      step({
        id: 'u',
        stepType: 'update_contact_field',
        stepConfig: { field: 'company', value: 'Acme' },
      }),
    ]);

    await service.dispatch(dispatch);

    expect(deps.contacts.update).toHaveBeenCalledWith('contact-1', { company: 'Acme' });
  });
});

describe('failure containment', () => {
  it('stops the automation at the failed step and records the reason', async () => {
    const { deps, service } = engine([
      step({ id: 's1', stepType: 'send_message', stepConfig: { text: 'first' }, position: 0 }),
      step({ id: 's2', stepType: 'add_tag', stepConfig: { tag_id: TAG }, position: 1 }),
    ]);
    deps.outbound.sendText.mockRejectedValueOnce(new Error('window closed'));

    await service.dispatch(dispatch);

    expect(deps.contacts.addTags).not.toHaveBeenCalled();
    const last = lastLog(deps.automations.updateLog);
    expect(last.status).toBe('failed');
    expect(last.errorMessage).toBe('window closed');
  });

  it('does not let an invalid keyword trigger silence later automations', async () => {
    const { deps, service } = engine([]);
    deps.automations.listActiveForTrigger.mockResolvedValueOnce([
      { id: 'broken', triggerType: 'keyword_match', triggerConfig: { keywords: [] }, steps: [] },
      {
        id: 'healthy',
        triggerType: 'new_message_received',
        triggerConfig: {},
        steps: [step({ id: 's', stepType: 'close_conversation', stepConfig: {} })],
      },
    ]);

    const result = await service.dispatch({ ...dispatch, context: { messageText: 'hello' } });

    expect(result.failed).toBe(0);
    expect(deps.conversations.update).toHaveBeenCalledWith('conv-1', { status: 'closed' });
  });
});

describe('keyword matching', () => {
  it('matches on a word boundary, not a substring', async () => {
    const { deps, service } = engine([]);
    deps.automations.listActiveForTrigger.mockResolvedValue([
      {
        id: 'auto-1',
        triggerType: 'keyword_match',
        triggerConfig: { keywords: ['hi'], match_type: 'contains', case_sensitive: false },
        steps: [step({ id: 's', stepType: 'close_conversation', stepConfig: {} })],
      },
    ]);

    expect(
      (await service.dispatch({ ...dispatch, context: { messageText: 'this is history' } })).executed,
    ).toBe(0);
    expect((await service.dispatch({ ...dispatch, context: { messageText: 'Hi there' } })).executed).toBe(1);
  });
});
