/**
 * Pipeline, stage and deal persistence.
 *
 * The routes this replaces were the healthiest in the codebase — raw Prisma
 * with a consistent `getAuthContext` — but they carried three ownership
 * holes that the tenant guard now closes structurally:
 *
 *  - `PUT /api/pipelines/[id]/stages` upserted `where: { id: s.id }` without
 *    checking the existing row's `pipelineId`, so passing another tenant's
 *    stage id renamed and reordered *their* stage.
 *  - `POST`/`PATCH /api/deals` verified the pipeline's tenant but never that
 *    `stageId` belonged to that pipeline, nor that `contactId` belonged to
 *    the tenant.
 *
 * `PipelineStage` is guarded through `pipeline` and `Deal` has its own
 * `tenantId`, so a cross-tenant id now yields zero rows — but the service
 * still asserts the *intra-tenant* relationships, because "this stage
 * belongs to a different pipeline of yours" is a real error the guard
 * cannot see.
 */

import type { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const stageSelect = {
  id: true,
  pipelineId: true,
  name: true,
  position: true,
  color: true,
  _count: { select: { deals: true } },
} satisfies Prisma.PipelineStageSelect;

const pipelineSelect = {
  id: true,
  name: true,
  createdAt: true,
  stages: { select: stageSelect, orderBy: { position: 'asc' } },
} satisfies Prisma.PipelineSelect;

export type PipelineRow = Prisma.PipelineGetPayload<{ select: typeof pipelineSelect }>;
export type StageRow = Prisma.PipelineStageGetPayload<{ select: typeof stageSelect }>;

/** Stages seeded with a new pipeline, matching the previous behaviour. */
export const DEFAULT_STAGES: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'New Lead', color: '#3b82f6' },
  { name: 'Qualified', color: '#8b5cf6' },
  { name: 'Proposal', color: '#f59e0b' },
  { name: 'Negotiation', color: '#06b6d4' },
  { name: 'Closed Won', color: '#10b981' },
];

export class PipelineRepository extends BaseRepository {
  protected readonly resourceName = 'Pipeline';

  constructor(db: TenantDb) {
    super(db);
  }

  async list(): Promise<PipelineRow[]> {
    return this.db.pipeline.findMany({ select: pipelineSelect, orderBy: { createdAt: 'asc' } });
  }

  async findById(id: string): Promise<PipelineRow> {
    return this.requireFound(await this.db.pipeline.findFirst({ where: { id }, select: pipelineSelect }));
  }

  async findFirstOrNull(): Promise<PipelineRow | null> {
    return this.db.pipeline.findFirst({ select: pipelineSelect, orderBy: { createdAt: 'asc' } });
  }

  /** Pipeline + default stages in one transaction. */
  async create(input: { name: string; userId: string; seedStages: boolean }): Promise<PipelineRow> {
    const created = await this.db.$transaction(async (tx) => {
      const pipeline = await tx.pipeline.create({
        data: scoped({ name: input.name, userId: input.userId }),
        select: { id: true },
      });

      if (input.seedStages) {
        await tx.pipelineStage.createMany({
          data: DEFAULT_STAGES.map((stage, index) => ({
            pipelineId: pipeline.id,
            name: stage.name,
            color: stage.color,
            position: index,
          })),
        });
      }
      return pipeline;
    });

    return this.findById(created.id);
  }

  async rename(id: string, name: string): Promise<PipelineRow> {
    this.requireAffected(await this.db.pipeline.updateMany({ where: { id }, data: { name } }));
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.pipeline.deleteMany({ where: { id } }));
  }

  // ── stages ────────────────────────────────────────────────────────

  async listStages(pipelineId: string): Promise<StageRow[]> {
    return this.db.pipelineStage.findMany({
      where: { pipelineId },
      select: stageSelect,
      orderBy: { position: 'asc' },
    });
  }

  /** Scoped by `pipelineId`, so another pipeline's stage id resolves to null. */
  async findStage(pipelineId: string, stageId: string): Promise<StageRow | null> {
    return this.db.pipelineStage.findFirst({ where: { id: stageId, pipelineId }, select: stageSelect });
  }

  async countStagesIn(pipelineId: string, stageIds: string[]): Promise<number> {
    if (stageIds.length === 0) return 0;
    return this.db.pipelineStage.count({
      where: { pipelineId, id: { in: [...new Set(stageIds)] } },
    });
  }

  async addStage(pipelineId: string, input: { name: string; color: string }): Promise<StageRow> {
    const highest = await this.db.pipelineStage.aggregate({
      where: { pipelineId },
      _max: { position: true },
    });
    return this.db.pipelineStage.create({
      data: {
        pipelineId,
        name: input.name,
        color: input.color,
        position: (highest._max.position ?? -1) + 1,
      },
      select: stageSelect,
    });
  }

  /**
   * Applies a reorder. Every write is filtered by `pipelineId` as well as
   * `id`, which is the fix for the cross-tenant rename: a stage that is not
   * part of this pipeline matches zero rows instead of being updated.
   */
  async reorderStages(
    pipelineId: string,
    stages: Array<{ id: string; name: string; color: string }>,
  ): Promise<StageRow[]> {
    await this.db.$transaction(
      stages.map((stage, index) =>
        this.db.pipelineStage.updateMany({
          where: { id: stage.id, pipelineId },
          data: { name: stage.name, color: stage.color, position: index },
        }),
      ),
    );
    return this.listStages(pipelineId);
  }

  async countDealsInStage(stageId: string): Promise<number> {
    return this.db.deal.count({ where: { stageId } });
  }

  async deleteStage(pipelineId: string, stageId: string): Promise<void> {
    this.requireAffected(
      await this.db.pipelineStage.deleteMany({ where: { id: stageId, pipelineId } }),
    );
  }
}

const dealInclude = {
  contact: { select: { id: true, phone: true, name: true } },
  stage: { select: { id: true, name: true, color: true, position: true } },
} satisfies Prisma.DealInclude;

export type DealRow = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

export interface DealListFilter {
  pipelineId?: string;
  stageId?: string;
  status?: string;
  contactId?: string;
  search?: string;
}

export class DealRepository extends BaseRepository {
  protected readonly resourceName = 'Deal';

  constructor(db: TenantDb) {
    super(db);
  }

  private buildWhere(filter: DealListFilter): Prisma.DealWhereInput {
    const where: Prisma.DealWhereInput = {};
    if (filter.pipelineId) where.pipelineId = filter.pipelineId;
    if (filter.stageId) where.stageId = filter.stageId;
    if (filter.contactId) where.contactId = filter.contactId;
    if (filter.status) {
      // `active` also matches legacy `open` rows.
      where.status = filter.status === 'active' ? { in: ['active', 'open'] } : filter.status;
    }
    if (filter.search) {
      where.OR = [{ title: { contains: filter.search } }, { notes: { contains: filter.search } }];
    }
    return where;
  }

  async list(filter: DealListFilter, pagination: PaginationQuery): Promise<Page<DealRow>> {
    const where = this.buildWhere(filter);
    return this.paginate(
      ({ skip, take }) =>
        this.db.deal.findMany({
          where,
          include: dealInclude,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.deal.count({ where }),
      pagination,
    );
  }

  /** Whole board in one query — the Kanban view needs every stage's deals. */
  async listForBoard(pipelineId: string, limit: number): Promise<DealRow[]> {
    return this.db.deal.findMany({
      where: { pipelineId, status: { in: ['active', 'open'] } },
      include: dealInclude,
      orderBy: [{ stageId: 'asc' }, { updatedAt: 'desc' }],
      take: limit,
    });
  }

  async findById(id: string): Promise<DealRow> {
    return this.requireFound(await this.db.deal.findFirst({ where: { id }, include: dealInclude }));
  }

  async create(input: {
    pipelineId: string;
    stageId: string;
    contactId: string;
    conversationId: string | null;
    title: string;
    value: number;
    currency: string;
    notes: string | null;
    expectedCloseDate: Date | null;
    userId: string;
  }): Promise<DealRow> {
    return this.db.deal.create({
      data: scoped({
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        contactId: input.contactId,
        conversationId: input.conversationId,
        title: input.title,
        value: input.value,
        currency: input.currency,
        notes: input.notes,
        expectedCloseDate: input.expectedCloseDate,
        status: 'active',
        userId: input.userId,
      }),
      include: dealInclude,
    });
  }

  async update(id: string, data: Prisma.DealUpdateManyMutationInput): Promise<DealRow> {
    this.requireAffected(await this.db.deal.updateMany({ where: { id }, data }));
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.deal.deleteMany({ where: { id } }));
  }

  /**
   * Aggregates grouped by status *and* currency. Summing across currencies
   * would produce a meaningless number, which is what the client-side
   * analytics did.
   */
  async aggregateByStatusAndCurrency(pipelineId: string) {
    return this.db.deal.groupBy({
      by: ['status', 'currency'],
      where: { pipelineId },
      _sum: { value: true },
      _count: { _all: true },
    });
  }

  async aggregateByStageAndCurrency(pipelineId: string) {
    return this.db.deal.groupBy({
      by: ['stageId', 'currency'],
      where: { pipelineId, status: { in: ['active', 'open'] } },
      _sum: { value: true },
      _count: { _all: true },
    });
  }

  async countForPipeline(pipelineId: string): Promise<number> {
    return this.db.deal.count({ where: { pipelineId } });
  }
}
