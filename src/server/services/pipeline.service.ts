/**
 * Pipeline, stage and deal business rules.
 *
 * Enforces the intra-tenant relationships the tenant guard cannot see:
 * a stage must belong to the deal's pipeline, and a contact must belong to
 * the caller's tenant. Both were unchecked, so a deal could reference
 * another pipeline's stage and render in a column that does not exist on its
 * own board.
 */

import { ConflictError, NotFoundError, ValidationError, type Page, type TenantDb } from '../kernel';
import {
  toDealDto,
  toPipelineDto,
  toPipelineStageDto,
  type DealDto,
  type PipelineAnalyticsDto,
  type PipelineDto,
  type PipelineStageDto,
} from '../dtos/pipeline.dto';
import { toNumber } from '../dtos/common.dto';
import { ContactRepository } from '../repositories/contact.repository';
import { ConversationRepository } from '../repositories/conversation.repository';
import { DealRepository, PipelineRepository } from '../repositories/pipeline.repository';
import type {
  CreateDealBody,
  CreatePipelineBody,
  CreateStageBody,
  ListDealsQuery,
  ReorderStagesBody,
  UpdateDealBody,
  UpdatePipelineBody,
} from '../validators/pipeline.validator';

/** Board read cap — a pipeline beyond this needs per-stage pagination. */
const BOARD_DEAL_LIMIT = 500;

export interface PipelineServiceDeps {
  pipelines: PipelineRepository;
  deals: DealRepository;
  contacts: Pick<ContactRepository, 'exists'>;
  conversations: Pick<ConversationRepository, 'exists'>;
}

export class PipelineService {
  constructor(
    private readonly deps: PipelineServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string): PipelineService {
    return new PipelineService(
      {
        pipelines: new PipelineRepository(db),
        deals: new DealRepository(db),
        contacts: new ContactRepository(db),
        conversations: new ConversationRepository(db),
      },
      userId,
    );
  }

  async list(): Promise<PipelineDto[]> {
    return (await this.deps.pipelines.list()).map(toPipelineDto);
  }

  async getById(id: string): Promise<PipelineDto> {
    return toPipelineDto(await this.deps.pipelines.findById(id));
  }

  /**
   * Returns the tenant's pipeline, creating a default one on first use.
   *
   * Signup provisions a tenant, workspace, roles and profile but no
   * pipeline, so a new account previously landed on an empty board with no
   * way forward. Seeding on read keeps that out of the signup transaction.
   */
  async getOrCreateDefault(): Promise<PipelineDto> {
    const existing = await this.deps.pipelines.findFirstOrNull();
    if (existing) return toPipelineDto(existing);
    return toPipelineDto(
      await this.deps.pipelines.create({ name: 'Sales Pipeline', userId: this.userId, seedStages: true }),
    );
  }

  async create(body: CreatePipelineBody): Promise<PipelineDto> {
    return toPipelineDto(
      await this.deps.pipelines.create({ name: body.name, userId: this.userId, seedStages: true }),
    );
  }

  async rename(id: string, body: UpdatePipelineBody): Promise<PipelineDto> {
    return toPipelineDto(await this.deps.pipelines.rename(id, body.name));
  }

  /**
   * Deleting a pipeline cascades to its stages and deals. Refused while it
   * holds deals so a mis-click cannot erase a sales history that has no
   * other copy.
   */
  async delete(id: string): Promise<void> {
    await this.deps.pipelines.findById(id);
    const dealCount = await this.deps.deals.countForPipeline(id);
    if (dealCount > 0) {
      throw new ConflictError(
        `This pipeline still holds ${dealCount} deal(s). Move or delete them before deleting the pipeline.`,
        { details: { dealCount } },
      );
    }
    await this.deps.pipelines.delete(id);
  }

  // ── stages ────────────────────────────────────────────────────────

  async listStages(pipelineId: string): Promise<PipelineStageDto[]> {
    await this.deps.pipelines.findById(pipelineId);
    return (await this.deps.pipelines.listStages(pipelineId)).map(toPipelineStageDto);
  }

  async addStage(pipelineId: string, body: CreateStageBody): Promise<PipelineStageDto> {
    await this.deps.pipelines.findById(pipelineId);
    return toPipelineStageDto(await this.deps.pipelines.addStage(pipelineId, body));
  }

  /**
   * Reorder must be exhaustive: the payload has to name every stage in the
   * pipeline. A partial list would leave the omitted stages holding stale
   * positions and produce duplicate or gapped ordering on the board.
   */
  async reorderStages(pipelineId: string, body: ReorderStagesBody): Promise<PipelineStageDto[]> {
    await this.deps.pipelines.findById(pipelineId);

    const existing = await this.deps.pipelines.listStages(pipelineId);
    const submitted = new Set(body.stages.map((stage) => stage.id));

    if (submitted.size !== body.stages.length) {
      throw new ValidationError('The same stage appears more than once.');
    }

    const owned = await this.deps.pipelines.countStagesIn(pipelineId, [...submitted]);
    if (owned !== submitted.size) {
      throw new NotFoundError('Stage');
    }

    const missing = existing.filter((stage) => !submitted.has(stage.id));
    if (missing.length > 0) {
      throw new ValidationError('Include every stage of this pipeline when reordering.', {
        details: { missingStageIds: missing.map((stage) => stage.id) },
      });
    }

    return (await this.deps.pipelines.reorderStages(pipelineId, body.stages)).map(toPipelineStageDto);
  }

  async deleteStage(pipelineId: string, stageId: string): Promise<void> {
    const stage = await this.deps.pipelines.findStage(pipelineId, stageId);
    if (!stage) throw new NotFoundError('Stage');

    const dealCount = await this.deps.pipelines.countDealsInStage(stageId);
    if (dealCount > 0) {
      throw new ConflictError(
        `This stage still holds ${dealCount} deal(s). Move them to another stage first.`,
        { details: { dealCount } },
      );
    }

    const remaining = await this.deps.pipelines.listStages(pipelineId);
    if (remaining.length <= 1) {
      throw new ConflictError('A pipeline needs at least one stage.');
    }

    await this.deps.pipelines.deleteStage(pipelineId, stageId);
  }

  // ── deals ─────────────────────────────────────────────────────────

  async listDeals(query: ListDealsQuery): Promise<Page<DealDto>> {
    const page = await this.deps.deals.list(
      {
        pipelineId: query.pipelineId,
        stageId: query.stageId,
        status: query.status,
        contactId: query.contactId,
        search: query.search,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return { ...page, items: page.items.map(toDealDto) };
  }

  async listBoard(pipelineId: string): Promise<DealDto[]> {
    await this.deps.pipelines.findById(pipelineId);
    return (await this.deps.deals.listForBoard(pipelineId, BOARD_DEAL_LIMIT)).map(toDealDto);
  }

  async getDeal(id: string): Promise<DealDto> {
    return toDealDto(await this.deps.deals.findById(id));
  }

  private async assertStageBelongsTo(pipelineId: string, stageId: string): Promise<void> {
    if (!(await this.deps.pipelines.findStage(pipelineId, stageId))) {
      throw new ValidationError('That stage does not belong to this pipeline.', {
        details: { pipelineId, stageId },
      });
    }
  }

  async createDeal(body: CreateDealBody): Promise<DealDto> {
    await this.deps.pipelines.findById(body.pipelineId);
    await this.assertStageBelongsTo(body.pipelineId, body.stageId);

    if (!(await this.deps.contacts.exists(body.contactId))) {
      throw new NotFoundError('Contact');
    }

    if (body.conversationId && !(await this.deps.conversations.exists(body.conversationId))) {
      throw new NotFoundError('Conversation');
    }

    return toDealDto(
      await this.deps.deals.create({
        pipelineId: body.pipelineId,
        stageId: body.stageId,
        contactId: body.contactId,
        conversationId: body.conversationId,
        title: body.title,
        value: body.value,
        currency: body.currency,
        notes: body.notes,
        expectedCloseDate: body.expectedCloseDate,
        userId: this.userId,
      }),
    );
  }

  async updateDeal(id: string, body: UpdateDealBody): Promise<DealDto> {
    const existing = await this.deps.deals.findById(id);

    // A stage move is the board's drag-and-drop; the target must be a stage
    // of the deal's own pipeline.
    if (body.stageId) {
      await this.assertStageBelongsTo(existing.pipelineId, body.stageId);
    }

    return toDealDto(
      await this.deps.deals.update(id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.stageId !== undefined ? { stageId: body.stageId } : {}),
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.expectedCloseDate !== undefined ? { expectedCloseDate: body.expectedCloseDate } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      }),
    );
  }

  async deleteDeal(id: string): Promise<void> {
    await this.deps.deals.delete(id);
  }

  /**
   * Pipeline analytics, computed in the database and grouped by currency.
   * Previously computed in the browser over an unpaginated deal list, with
   * USD hardcoded.
   */
  async analytics(pipelineId: string): Promise<PipelineAnalyticsDto> {
    const pipeline = await this.deps.pipelines.findById(pipelineId);
    const [byStatus, byStage, totalDeals] = await Promise.all([
      this.deps.deals.aggregateByStatusAndCurrency(pipelineId),
      this.deps.deals.aggregateByStageAndCurrency(pipelineId),
      this.deps.deals.countForPipeline(pipelineId),
    ]);

    const collect = (statuses: string[]) =>
      byStatus
        .filter((group) => statuses.includes(group.status))
        .map((group) => ({
          currency: group.currency,
          value: toNumber(group._sum.value),
          count: group._count._all,
        }));

    const wonCount = byStatus
      .filter((group) => group.status === 'won')
      .reduce((total, group) => total + group._count._all, 0);
    const lostCount = byStatus
      .filter((group) => group.status === 'lost')
      .reduce((total, group) => total + group._count._all, 0);
    const decided = wonCount + lostCount;

    return {
      pipelineId,
      totalDeals,
      openTotals: collect(['active', 'open']),
      wonTotals: collect(['won']),
      lostTotals: collect(['lost']),
      winRate: decided > 0 ? Math.round((wonCount / decided) * 1000) / 10 : 0,
      byStage: pipeline.stages.map((stage) => ({
        stageId: stage.id,
        stageName: stage.name,
        dealCount: byStage
          .filter((group) => group.stageId === stage.id)
          .reduce((total, group) => total + group._count._all, 0),
        totals: byStage
          .filter((group) => group.stageId === stage.id)
          .map((group) => ({
            currency: group.currency,
            value: toNumber(group._sum.value),
            count: group._count._all,
          })),
      })),
    };
  }
}
