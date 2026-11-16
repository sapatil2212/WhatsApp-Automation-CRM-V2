import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../kernel';
import { FlowService, type FlowServiceDeps } from './flow.service';

const now = new Date('2026-05-22T10:00:00.000Z');

/** A minimal graph that passes `validateFlowForActivation`. */
function validNodes() {
  return [
    { nodeKey: 'start', nodeType: 'start', config: { next_node_key: 'greet' } },
    { nodeKey: 'greet', nodeType: 'send_message', config: { text: 'Hello', next_node_key: 'done' } },
    { nodeKey: 'done', nodeType: 'end', config: {} },
  ];
}

function flowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flow-1',
    name: 'Welcome menu',
    description: null,
    status: 'draft',
    triggerType: 'keyword',
    triggerConfig: { keywords: ['hi'], match_type: 'contains' },
    entryNodeId: 'start',
    fallbackPolicy: {
      on_no_match: 'reprompt',
      max_reprompts: 2,
      on_exhaust: 'handoff',
      on_timeout_hours: 24,
    },
    executionCount: 0,
    lastExecutedAt: null,
    createdAt: now,
    updatedAt: now,
    _count: { nodes: 3 },
    ...overrides,
  };
}

function makeDeps() {
  const flows = {
    list: vi.fn(),
    findById: vi.fn(async () => flowRow()),
    findWithNodes: vi.fn(async () => ({ ...flowRow(), nodes: validNodes() })),
    listNodes: vi.fn(async () => validNodes()),
    create: vi.fn(async () => flowRow()),
    updateMetadata: vi.fn(async () => undefined),
    replaceNodes: vi.fn(async () => undefined),
    setStatus: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    listActiveForTrigger: vi.fn(),
    incrementExecutionCount: vi.fn(),
  };
  const runs = {
    listForFlow: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25 })),
    findActiveForContact: vi.fn(),
    startRun: vi.fn(),
    advanceCurrentNode: vi.fn(),
    setVars: vi.fn(),
    setRepromptCount: vi.fn(),
    endRun: vi.fn(),
    pauseForContact: vi.fn(),
    findStaleActive: vi.fn(),
    timeOut: vi.fn(),
    logEvent: vi.fn(),
    listEvents: vi.fn(async () => []),
  };
  return { flows, runs } as unknown as FlowServiceDeps & {
    flows: typeof flows;
    runs: typeof runs;
  };
}

let deps: ReturnType<typeof makeDeps>;
let service: FlowService;

beforeEach(() => {
  deps = makeDeps();
  service = new FlowService(deps, 'user-1');
});

describe('create', () => {
  const body = {
    name: 'Welcome menu',
    description: null,
    triggerType: 'keyword' as const,
    triggerConfig: { keywords: ['hi'] },
    entryNodeKey: 'start',
    nodes: validNodes() as never,
  };

  it('rejects duplicate node keys', async () => {
    await expect(
      service.create({
        ...body,
        nodes: [
          { nodeKey: 'a', nodeType: 'end', config: {} },
          { nodeKey: 'a', nodeType: 'end', config: {} },
        ] as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(deps.flows.create).not.toHaveBeenCalled();
  });

  it('rejects an entry key that is not among the nodes', async () => {
    await expect(service.create({ ...body, entryNodeKey: 'nowhere' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('allows a null entry key on an empty draft', async () => {
    await service.create({ ...body, entryNodeKey: null, nodes: [] as never });
    expect(deps.flows.create).toHaveBeenCalled();
  });

  it('creates as draft with the default fallback policy', async () => {
    await service.create(body);
    expect(deps.flows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackPolicy: expect.objectContaining({ on_no_match: 'reprompt', on_timeout_hours: 24 }),
      }),
    );
  });
});

describe('update', () => {
  it('replaces the node graph only when nodes are supplied', async () => {
    await service.update('flow-1', { name: 'Renamed' });
    expect(deps.flows.replaceNodes).not.toHaveBeenCalled();

    await service.update('flow-1', { nodes: validNodes() as never });
    expect(deps.flows.replaceNodes).toHaveBeenCalledOnce();
  });

  it('rejects an entry key that the new node set does not contain', async () => {
    await expect(
      service.update('flow-1', {
        entryNodeKey: 'ghost',
        nodes: validNodes() as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('validates the entry key against the existing nodes when only the key changes', async () => {
    await expect(service.update('flow-1', { entryNodeKey: 'greet' })).resolves.toBeDefined();
    await expect(service.update('flow-1', { entryNodeKey: 'ghost' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('demotes a live flow to draft when an edit breaks it', async () => {
    const broken = [{ nodeKey: 'start', nodeType: 'start', config: { next_node_key: 'missing' } }];
    deps.flows.findWithNodes
      .mockResolvedValueOnce({ ...flowRow({ status: 'active' }), nodes: validNodes() } as never)
      .mockResolvedValueOnce({ ...flowRow({ status: 'active' }), nodes: broken } as never)
      .mockResolvedValueOnce({ ...flowRow({ status: 'draft' }), nodes: broken } as never);

    await service.update('flow-1', { nodes: broken as never });
    expect(deps.flows.setStatus).toHaveBeenCalledWith('flow-1', 'draft');
  });

  it('leaves a live flow active when the edit is still valid', async () => {
    deps.flows.findWithNodes.mockResolvedValue({
      ...flowRow({ status: 'active' }),
      nodes: validNodes(),
    } as never);

    await service.update('flow-1', { name: 'Still fine' });
    expect(deps.flows.setStatus).not.toHaveBeenCalled();
  });

  it('does not re-validate a draft on every save, so partial work can be saved', async () => {
    const broken = [{ nodeKey: 'start', nodeType: 'start', config: {} }];
    deps.flows.findWithNodes.mockResolvedValue({
      ...flowRow({ status: 'draft', entryNodeId: null }),
      nodes: broken,
    } as never);

    await expect(service.update('flow-1', { nodes: broken as never })).resolves.toBeDefined();
    expect(deps.flows.setStatus).not.toHaveBeenCalled();
  });
});

describe('activate', () => {
  it('activates a valid flow', async () => {
    const result = await service.activate('flow-1');
    expect(deps.flows.setStatus).toHaveBeenCalledWith('flow-1', 'active');
    expect(result.flow).not.toBeNull();
  });

  it('refuses activation and returns the issues when the graph is broken', async () => {
    deps.flows.findWithNodes.mockResolvedValue({
      ...flowRow(),
      nodes: [{ nodeKey: 'start', nodeType: 'start', config: { next_node_key: 'missing' } }],
    } as never);

    const result = await service.activate('flow-1');
    expect(result.flow).toBeNull();
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true);
    expect(deps.flows.setStatus).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-active flow', async () => {
    deps.flows.findById.mockResolvedValueOnce(flowRow({ status: 'active' }) as never);
    const result = await service.activate('flow-1');
    expect(result.issues).toEqual([]);
    expect(deps.flows.setStatus).not.toHaveBeenCalled();
  });

  it('reports the offending node key so the editor can highlight it', async () => {
    deps.flows.findWithNodes.mockResolvedValue({
      ...flowRow(),
      nodes: [{ nodeKey: 'start', nodeType: 'start', config: { next_node_key: 'missing' } }],
    } as never);

    const result = await service.activate('flow-1');
    expect(result.issues.some((issue) => issue.nodeKey === 'start')).toBe(true);
  });
});

describe('setStatus', () => {
  it('throws when activation is requested but the flow is invalid', async () => {
    deps.flows.findWithNodes.mockResolvedValue({
      ...flowRow(),
      nodes: [{ nodeKey: 'start', nodeType: 'start', config: { next_node_key: 'missing' } }],
    } as never);

    await expect(service.setStatus('flow-1', 'active')).rejects.toBeInstanceOf(ValidationError);
  });

  it('archives without validation, so a broken flow can always be taken offline', async () => {
    await service.setStatus('flow-1', 'archived');
    expect(deps.flows.setStatus).toHaveBeenCalledWith('flow-1', 'archived');
  });
});

describe('delete', () => {
  it('refuses while conversations are in progress', async () => {
    deps.runs.listForFlow.mockResolvedValueOnce({ items: [], total: 4, page: 1, pageSize: 1 } as never);
    await expect(service.delete('flow-1')).rejects.toBeInstanceOf(ConflictError);
    expect(deps.flows.delete).not.toHaveBeenCalled();
  });

  it('reports how many runs are blocking the delete', async () => {
    deps.runs.listForFlow.mockResolvedValueOnce({ items: [], total: 4, page: 1, pageSize: 1 } as never);
    await service.delete('flow-1').catch((error: ConflictError) => {
      expect(error.details).toEqual({ activeRuns: 4 });
    });
  });

  it('deletes when no run is active', async () => {
    await service.delete('flow-1');
    expect(deps.flows.delete).toHaveBeenCalledWith('flow-1');
  });
});

describe('duplicate', () => {
  it('copies the graph as a draft with a distinct name', async () => {
    await service.duplicate('flow-1');
    expect(deps.flows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Welcome menu (Copy)',
        entryNodeKey: 'start',
        nodes: expect.arrayContaining([expect.objectContaining({ nodeKey: 'start' })]),
      }),
    );
  });

  it('carries the source fallback policy rather than resetting it', async () => {
    deps.flows.findWithNodes.mockResolvedValueOnce({
      ...flowRow({
        fallbackPolicy: {
          on_no_match: 'handoff',
          max_reprompts: 0,
          on_exhaust: 'end',
          on_timeout_hours: 4,
        },
      }),
      nodes: validNodes(),
    } as never);

    await service.duplicate('flow-1');
    expect(deps.flows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackPolicy: expect.objectContaining({ on_timeout_hours: 4 }),
      }),
    );
  });
});
