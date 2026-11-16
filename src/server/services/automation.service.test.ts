import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../kernel';
import { AutomationService, type AutomationServiceDeps } from './automation.service';
import type { StepTreeNode } from '../repositories/automation.repository';

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const now = new Date('2026-05-22T10:00:00.000Z');

function treeNode(stepType: string, stepConfig: Record<string, unknown>, id = 's1'): StepTreeNode {
  return { id, stepType, stepConfig, position: 0, branches: { yes: [], no: [] } };
}

function automationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'auto-1',
    name: 'Greet new leads',
    description: null,
    triggerType: 'keyword_match',
    triggerConfig: { keywords: ['hi'], match_type: 'contains', case_sensitive: false },
    isActive: false,
    executionCount: 0,
    lastExecutedAt: null,
    createdAt: now,
    updatedAt: now,
    _count: { steps: 1 },
    ...overrides,
  };
}

function makeDeps() {
  const automations = {
    list: vi.fn(),
    findById: vi.fn(async () => automationRow()),
    listSteps: vi.fn(),
    findStepTree: vi.fn(async (): Promise<StepTreeNode[]> => [
      treeNode('send_message', { text: 'Hello' }),
    ]),
    listActiveForTrigger: vi.fn(),
    create: vi.fn(async () => automationRow()),
    updateMetadata: vi.fn(async () => undefined),
    replaceSteps: vi.fn(async () => undefined),
    setActive: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    recordExecution: vi.fn(),
    listLogs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25 })),
    createLog: vi.fn(),
    updateLog: vi.fn(),
    findLogSteps: vi.fn(),
  };
  const tags = { countOwned: vi.fn(async (ids: string[]) => ids.length) };
  const customFields = { countOwned: vi.fn(async (ids: string[]) => ids.length) };
  return { automations, tags, customFields } as unknown as AutomationServiceDeps & {
    automations: typeof automations;
    tags: typeof tags;
    customFields: typeof customFields;
  };
}

let deps: ReturnType<typeof makeDeps>;
let service: AutomationService;

beforeEach(() => {
  deps = makeDeps();
  service = new AutomationService(deps, 'user-1');
});

describe('validate', () => {
  it('passes a well-formed automation', async () => {
    expect(await service.validate('auto-1')).toEqual([]);
  });

  it('reports an unsupported legacy trigger that could never fire', async () => {
    deps.automations.findById.mockResolvedValueOnce(automationRow({ triggerType: 'time_based' }) as never);
    const issues = await service.validate('auto-1');
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('trigger.type');
    expect(issues[0].message).toContain('no longer supported');
  });

  it('reports a keyword trigger with no keywords', async () => {
    deps.automations.findById.mockResolvedValueOnce(
      automationRow({ triggerConfig: { keywords: [] } }) as never,
    );
    const issues = await service.validate('auto-1');
    expect(issues.some((issue) => issue.path.startsWith('trigger.keywords'))).toBe(true);
  });

  it('reports an automation with no steps', async () => {
    deps.automations.findStepTree.mockResolvedValueOnce([]);
    const issues = await service.validate('auto-1');
    expect(issues.some((issue) => issue.path === 'steps')).toBe(true);
  });

  it('reports a step whose config is invalid, with a path the builder can map', async () => {
    deps.automations.findStepTree.mockResolvedValueOnce([treeNode('send_message', { text: '' })]);
    const issues = await service.validate('auto-1');
    expect(issues[0].path).toBe('steps[0].text');
  });

  it('catches the wait config the engine used to misread', async () => {
    deps.automations.findStepTree.mockResolvedValueOnce([treeNode('wait', { duration: 2, unit: 'hours' })]);
    const issues = await service.validate('auto-1');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.path.startsWith('steps[0].amount'))).toBe(true);
  });

  it('reports a condition with no branch steps', async () => {
    deps.automations.findStepTree.mockResolvedValueOnce([
      treeNode('condition', { subject: 'message_content', operand: 'refund' }),
    ]);
    const issues = await service.validate('auto-1');
    expect(issues.some((issue) => issue.path === 'steps[0].branches')).toBe(true);
  });

  it('reports branches attached to a non-condition step as unreachable', async () => {
    const node = treeNode('send_message', { text: 'Hi' });
    node.branches.yes = [treeNode('add_tag', { tag_id: UUID }, 's2')];
    deps.automations.findStepTree.mockResolvedValueOnce([node]);
    const issues = await service.validate('auto-1');
    expect(issues.some((issue) => issue.message.includes('would never run'))).toBe(true);
  });

  it('validates steps inside condition branches', async () => {
    const condition = treeNode('condition', { subject: 'message_content', operand: 'refund' });
    condition.branches.yes = [treeNode('send_message', { text: '' }, 's2')];
    deps.automations.findStepTree.mockResolvedValueOnce([condition]);
    const issues = await service.validate('auto-1');
    expect(issues.some((issue) => issue.path === 'steps[0].yes[0].text')).toBe(true);
  });

  it('reports a tag that no longer exists', async () => {
    deps.automations.findStepTree.mockResolvedValueOnce([treeNode('add_tag', { tag_id: UUID })]);
    deps.tags.countOwned.mockResolvedValueOnce(0);
    const issues = await service.validate('auto-1');
    expect(issues.some((issue) => issue.message.includes('referenced tags'))).toBe(true);
  });

  it('checks tag ownership for a tag_presence condition too', async () => {
    const condition = treeNode('condition', { subject: 'tag_presence', operand: UUID });
    condition.branches.yes = [treeNode('send_message', { text: 'Hi' }, 's2')];
    deps.automations.findStepTree.mockResolvedValueOnce([condition]);
    deps.tags.countOwned.mockResolvedValueOnce(0);
    const issues = await service.validate('auto-1');
    expect(issues.some((issue) => issue.message.includes('referenced tags'))).toBe(true);
  });
});

describe('create', () => {
  const body = {
    name: 'Greet new leads',
    description: null,
    triggerType: 'keyword_match' as const,
    triggerConfig: { keywords: ['hi'], match_type: 'contains' as const, case_sensitive: false },
    steps: [{ step_type: 'send_message' as const, step_config: { text: 'Hello' } }],
    isActive: false,
  };

  it('creates an inactive automation without validating, so drafts can be saved', async () => {
    await service.create({ ...body, steps: [] });
    expect(deps.automations.create).toHaveBeenCalled();
  });

  it('refuses to create an active automation that cannot execute', async () => {
    await expect(service.create({ ...body, steps: [], isActive: true })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(deps.automations.create).not.toHaveBeenCalled();
  });

  it('creates an active automation when it validates', async () => {
    await service.create({ ...body, isActive: true });
    expect(deps.automations.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it('returns the issue list so the builder can highlight fields', async () => {
    await service
      .create({ ...body, steps: [{ step_type: 'wait', step_config: { duration: 1 } }], isActive: true })
      .catch((error: ValidationError) => {
        const details = error.details as { issues: Array<{ path: string }> };
        expect(details.issues.length).toBeGreaterThan(0);
      });
  });
});

describe('update', () => {
  it('deactivates a live automation when an edit breaks it', async () => {
    deps.automations.findById.mockResolvedValue(automationRow({ isActive: true }) as never);
    await service.update('auto-1', { steps: [] });
    expect(deps.automations.setActive).toHaveBeenCalledWith('auto-1', false);
  });

  it('throws instead of deactivating when activation was explicitly requested', async () => {
    await expect(service.update('auto-1', { isActive: true, steps: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('leaves a live automation active when the edit is still valid', async () => {
    deps.automations.findById.mockResolvedValue(automationRow({ isActive: true }) as never);
    await service.update('auto-1', { name: 'Renamed' });
    expect(deps.automations.setActive).not.toHaveBeenCalled();
  });

  it('replaces steps only when steps are supplied', async () => {
    await service.update('auto-1', { name: 'Renamed' });
    expect(deps.automations.replaceSteps).not.toHaveBeenCalled();

    await service.update('auto-1', { steps: [{ step_type: 'send_message', step_config: { text: 'Hi' } }] });
    expect(deps.automations.replaceSteps).toHaveBeenCalledOnce();
  });

  it('does not validate an inactive automation, so partial work saves', async () => {
    await expect(service.update('auto-1', { steps: [] })).resolves.toBeDefined();
    expect(deps.automations.setActive).not.toHaveBeenCalled();
  });
});

describe('setActive', () => {
  it('refuses to activate an invalid automation', async () => {
    deps.automations.findStepTree.mockResolvedValue([]);
    await expect(service.setActive('auto-1', true)).rejects.toBeInstanceOf(ValidationError);
    expect(deps.automations.setActive).not.toHaveBeenCalled();
  });

  it('deactivates without validation, so a broken automation can always be stopped', async () => {
    deps.automations.findStepTree.mockResolvedValue([]);
    await service.setActive('auto-1', false);
    expect(deps.automations.setActive).toHaveBeenCalledWith('auto-1', false);
  });
});

describe('duplicate', () => {
  it('copies the step tree', async () => {
    await service.duplicate('auto-1');
    expect(deps.automations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Greet new leads (Copy)',
        steps: [expect.objectContaining({ stepType: 'send_message' })],
      }),
    );
  });

  it('never creates the copy active, so it cannot double-fire with the original', async () => {
    deps.automations.findById.mockResolvedValueOnce(automationRow({ isActive: true }) as never);
    await service.duplicate('auto-1');
    expect(deps.automations.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });
});

describe('delete', () => {
  it('refuses to delete a live automation', async () => {
    deps.automations.findById.mockResolvedValueOnce(automationRow({ isActive: true }) as never);
    await expect(service.delete('auto-1')).rejects.toBeInstanceOf(ConflictError);
    expect(deps.automations.delete).not.toHaveBeenCalled();
  });

  it('deletes an inactive automation', async () => {
    await service.delete('auto-1');
    expect(deps.automations.delete).toHaveBeenCalledWith('auto-1');
  });
});
