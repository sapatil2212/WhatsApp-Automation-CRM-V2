import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from '../kernel';
import { PipelineService, type PipelineServiceDeps } from './pipeline.service';

const now = new Date('2026-05-22T10:00:00.000Z');

function stageRow(id: string, position: number, dealCount = 0) {
  return {
    id,
    pipelineId: 'pipe-1',
    name: `Stage ${position}`,
    position,
    color: '#3b82f6',
    _count: { deals: dealCount },
  };
}

function pipelineRow(stages = [stageRow('stage-1', 0), stageRow('stage-2', 1)]) {
  return { id: 'pipe-1', name: 'Sales Pipeline', createdAt: now, stages };
}

function dealRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deal-1',
    pipelineId: 'pipe-1',
    stageId: 'stage-1',
    title: 'Acme renewal',
    value: 1500,
    currency: 'USD',
    notes: null,
    expectedCloseDate: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    conversationId: null,
    contact: { id: 'contact-1', phone: '919876543210', name: 'Asha' },
    stage: { id: 'stage-1', name: 'New Lead', color: '#3b82f6', position: 0 },
    ...overrides,
  };
}

function makeDeps() {
  const pipelines = {
    list: vi.fn(async () => [pipelineRow()]),
    findById: vi.fn(async () => pipelineRow()),
    findFirstOrNull: vi.fn(async () => pipelineRow()),
    create: vi.fn(async () => pipelineRow()),
    rename: vi.fn(async () => pipelineRow()),
    delete: vi.fn(async () => undefined),
    listStages: vi.fn(async () => [stageRow('stage-1', 0), stageRow('stage-2', 1)]),
    findStage: vi.fn(async () => stageRow('stage-1', 0)),
    countStagesIn: vi.fn(async (_pipelineId: string, ids: string[]) => ids.length),
    addStage: vi.fn(async () => stageRow('stage-3', 2)),
    reorderStages: vi.fn(async () => [stageRow('stage-2', 0), stageRow('stage-1', 1)]),
    countDealsInStage: vi.fn(async () => 0),
    deleteStage: vi.fn(async () => undefined),
  };
  const deals = {
    list: vi.fn(),
    listForBoard: vi.fn(async () => [dealRow()]),
    findById: vi.fn(async () => dealRow()),
    create: vi.fn(async () => dealRow()),
    update: vi.fn(async () => dealRow()),
    delete: vi.fn(async () => undefined),
    aggregateByStatusAndCurrency: vi.fn(async () => []),
    aggregateByStageAndCurrency: vi.fn(async () => []),
    countForPipeline: vi.fn(async () => 0),
  };
  const contacts = { exists: vi.fn(async () => true) };
  const conversations = { exists: vi.fn(async () => true) };
  return { pipelines, deals, contacts, conversations } as unknown as PipelineServiceDeps & {
    pipelines: typeof pipelines;
    deals: typeof deals;
    contacts: typeof contacts;
    conversations: typeof conversations;
  };
}

let deps: ReturnType<typeof makeDeps>;
let service: PipelineService;

beforeEach(() => {
  deps = makeDeps();
  service = new PipelineService(deps, 'user-1');
});

describe('getOrCreateDefault', () => {
  it('returns the existing pipeline', async () => {
    await service.getOrCreateDefault();
    expect(deps.pipelines.create).not.toHaveBeenCalled();
  });

  it('seeds a default pipeline on first use, since signup does not create one', async () => {
    deps.pipelines.findFirstOrNull.mockResolvedValueOnce(null as never);
    await service.getOrCreateDefault();
    expect(deps.pipelines.create).toHaveBeenCalledWith({
      name: 'Sales Pipeline',
      userId: 'user-1',
      seedStages: true,
    });
  });
});

describe('delete pipeline', () => {
  it('refuses while deals remain, so sales history cannot be lost to a mis-click', async () => {
    deps.deals.countForPipeline.mockResolvedValueOnce(7);
    await expect(service.delete('pipe-1')).rejects.toBeInstanceOf(ConflictError);
    expect(deps.pipelines.delete).not.toHaveBeenCalled();
  });

  it('deletes an empty pipeline', async () => {
    await service.delete('pipe-1');
    expect(deps.pipelines.delete).toHaveBeenCalledWith('pipe-1');
  });
});

describe('reorderStages', () => {
  const body = {
    stages: [
      { id: 'stage-2', name: 'Qualified', color: '#8b5cf6' },
      { id: 'stage-1', name: 'New Lead', color: '#3b82f6' },
    ],
  };

  it('derives position from array order rather than trusting the client', async () => {
    await service.reorderStages('pipe-1', body);
    expect(deps.pipelines.reorderStages).toHaveBeenCalledWith('pipe-1', body.stages);
  });

  it('rejects a stage that belongs to another pipeline — the cross-tenant rename hole', async () => {
    deps.pipelines.countStagesIn.mockResolvedValueOnce(1);
    await expect(service.reorderStages('pipe-1', body)).rejects.toBeInstanceOf(NotFoundError);
    expect(deps.pipelines.reorderStages).not.toHaveBeenCalled();
  });

  it('rejects a duplicated stage id', async () => {
    await expect(
      service.reorderStages('pipe-1', {
        stages: [
          { id: 'stage-1', name: 'A', color: '#3b82f6' },
          { id: 'stage-1', name: 'B', color: '#3b82f6' },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a partial list, which would leave stale positions behind', async () => {
    await expect(
      service.reorderStages('pipe-1', { stages: [{ id: 'stage-1', name: 'A', color: '#3b82f6' }] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('deleteStage', () => {
  it('404s for a stage from another pipeline', async () => {
    deps.pipelines.findStage.mockResolvedValueOnce(null as never);
    await expect(service.deleteStage('pipe-1', 'stage-9')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses while the stage holds deals', async () => {
    deps.pipelines.countDealsInStage.mockResolvedValueOnce(3);
    await expect(service.deleteStage('pipe-1', 'stage-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to remove the last stage', async () => {
    deps.pipelines.listStages.mockResolvedValueOnce([stageRow('stage-1', 0)]);
    await expect(service.deleteStage('pipe-1', 'stage-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('deletes an empty stage when others remain', async () => {
    await service.deleteStage('pipe-1', 'stage-1');
    expect(deps.pipelines.deleteStage).toHaveBeenCalledWith('pipe-1', 'stage-1');
  });
});

describe('createDeal', () => {
  const body = {
    title: 'Acme renewal',
    pipelineId: 'pipe-1',
    stageId: 'stage-1',
    contactId: 'contact-1',
    conversationId: null,
    value: 1500,
    currency: 'USD',
    notes: null,
    expectedCloseDate: null,
  };

  it('rejects a stage that is not part of the deal’s pipeline', async () => {
    deps.pipelines.findStage.mockResolvedValueOnce(null as never);
    await expect(service.createDeal(body)).rejects.toBeInstanceOf(ValidationError);
    expect(deps.deals.create).not.toHaveBeenCalled();
  });

  it('rejects a contact outside the tenant', async () => {
    deps.contacts.exists.mockResolvedValueOnce(false);
    await expect(service.createDeal(body)).rejects.toBeInstanceOf(NotFoundError);
    expect(deps.deals.create).not.toHaveBeenCalled();
  });

  it('rejects a conversation outside the tenant', async () => {
    deps.conversations.exists.mockResolvedValueOnce(false);
    await expect(service.createDeal({ ...body, conversationId: 'conv-9' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('skips the conversation check when none is linked', async () => {
    await service.createDeal(body);
    expect(deps.conversations.exists).not.toHaveBeenCalled();
  });

  it('creates the deal as active', async () => {
    await service.createDeal(body);
    expect(deps.deals.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });
});

describe('updateDeal', () => {
  it('validates a stage move against the deal’s own pipeline', async () => {
    deps.pipelines.findStage.mockResolvedValueOnce(null as never);
    await expect(service.updateDeal('deal-1', { stageId: 'stage-other' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('applies a valid stage move — the board’s drag-and-drop', async () => {
    await service.updateDeal('deal-1', { stageId: 'stage-2' });
    expect(deps.deals.update).toHaveBeenCalledWith('deal-1', { stageId: 'stage-2' });
  });

  it('passes through only the supplied fields', async () => {
    await service.updateDeal('deal-1', { status: 'won' });
    expect(deps.deals.update).toHaveBeenCalledWith('deal-1', { status: 'won' });
  });
});

describe('analytics', () => {
  it('groups totals by currency instead of summing them together', async () => {
    deps.deals.aggregateByStatusAndCurrency.mockResolvedValueOnce([
      { status: 'active', currency: 'USD', _sum: { value: 1000 }, _count: { _all: 2 } },
      { status: 'active', currency: 'INR', _sum: { value: 80000 }, _count: { _all: 3 } },
    ] as never);

    const result = await service.analytics('pipe-1');
    expect(result.openTotals).toEqual([
      { currency: 'USD', value: 1000, count: 2 },
      { currency: 'INR', value: 80000, count: 3 },
    ]);
  });

  it('counts legacy `open` rows as active', async () => {
    deps.deals.aggregateByStatusAndCurrency.mockResolvedValueOnce([
      { status: 'open', currency: 'USD', _sum: { value: 500 }, _count: { _all: 1 } },
    ] as never);
    expect((await service.analytics('pipe-1')).openTotals).toEqual([
      { currency: 'USD', value: 500, count: 1 },
    ]);
  });

  it('computes win rate over decided deals only', async () => {
    deps.deals.aggregateByStatusAndCurrency.mockResolvedValueOnce([
      { status: 'won', currency: 'USD', _sum: { value: 300 }, _count: { _all: 3 } },
      { status: 'lost', currency: 'USD', _sum: { value: 100 }, _count: { _all: 1 } },
      { status: 'active', currency: 'USD', _sum: { value: 900 }, _count: { _all: 9 } },
    ] as never);
    expect((await service.analytics('pipe-1')).winRate).toBe(75);
  });

  it('reports a zero win rate rather than NaN when nothing is decided', async () => {
    expect((await service.analytics('pipe-1')).winRate).toBe(0);
  });

  it('reports every stage, including empty ones', async () => {
    const result = await service.analytics('pipe-1');
    expect(result.byStage.map((entry) => entry.stageId)).toEqual(['stage-1', 'stage-2']);
    expect(result.byStage[0].dealCount).toBe(0);
  });
});
