/**
 * Automation persistence, including the step tree and the wait queue.
 *
 * Replaces `src/lib/automations/steps-tree.ts`, which imported the raw
 * `prisma` client directly and therefore had no tenant scoping at all — any
 * automation id reached any tenant's steps. Its tree↔flat conversion is
 * preserved here as pure functions running against the guarded client.
 *
 * Also replaces the `admin-client` shim used by the wait-queue cron, which
 * called `.lte('run_at', …)` — a method that shim never implemented, so the
 * cron threw an unhandled `TypeError` and returned 500 on every invocation.
 * Parked `wait` steps therefore never resumed.
 */

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const automationSelect = {
  id: true,
  name: true,
  description: true,
  triggerType: true,
  triggerConfig: true,
  isActive: true,
  executionCount: true,
  lastExecutedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { steps: true } },
} satisfies Prisma.AutomationSelect;

const stepSelect = {
  id: true,
  parentStepId: true,
  branch: true,
  stepType: true,
  stepConfig: true,
  position: true,
} satisfies Prisma.AutomationStepSelect;

export type AutomationRow = Prisma.AutomationGetPayload<{ select: typeof automationSelect }>;
export type AutomationStepRow = Prisma.AutomationStepGetPayload<{ select: typeof stepSelect }>;

/** Tree shape used by both the builder and the engine. */
export interface StepTreeNode {
  id: string;
  stepType: string;
  stepConfig: Record<string, unknown>;
  position: number;
  branches: { yes: StepTreeNode[]; no: StepTreeNode[] };
}

export interface StepTreeInput {
  stepType: string;
  stepConfig: Prisma.InputJsonValue;
  branches?: { yes?: StepTreeInput[]; no?: StepTreeInput[] };
}

interface FlatStepRow {
  id: string;
  automationId: string;
  parentStepId: string | null;
  branch: string | null;
  stepType: string;
  stepConfig: Prisma.InputJsonValue;
  position: number;
}

/**
 * Tree → flat rows. Exported for unit testing: the parent/branch wiring is
 * the part that silently breaks a branch if it regresses.
 */
export function flattenStepTree(automationId: string, tree: StepTreeInput[]): FlatStepRow[] {
  const rows: FlatStepRow[] = [];

  const walk = (steps: StepTreeInput[], parentStepId: string | null, branch: 'yes' | 'no' | null) => {
    steps.forEach((step, index) => {
      const id = randomUUID();
      rows.push({
        id,
        automationId,
        parentStepId,
        branch,
        stepType: step.stepType,
        stepConfig: step.stepConfig,
        position: index,
      });
      // Only a condition owns branches; anything else with them is a
      // builder bug and the extra steps would be unreachable.
      if (step.stepType === 'condition' && step.branches) {
        if (step.branches.yes?.length) walk(step.branches.yes, id, 'yes');
        if (step.branches.no?.length) walk(step.branches.no, id, 'no');
      }
    });
  };

  walk(tree, null, null);
  return rows;
}

/** Flat rows → tree, ordered by `position` within each branch. */
export function buildStepTree(rows: AutomationStepRow[]): StepTreeNode[] {
  const byId = new Map<string, StepTreeNode>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      stepType: row.stepType,
      stepConfig: (row.stepConfig ?? {}) as Record<string, unknown>,
      position: row.position,
      branches: { yes: [], no: [] },
    });
  }

  const roots: StepTreeNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;

    if (!row.parentStepId) {
      roots.push(node);
      continue;
    }

    const parent = byId.get(row.parentStepId);
    if (!parent) {
      // Orphaned by a partial delete: surface it as a root rather than
      // dropping it, so the user can see and remove it.
      roots.push(node);
      continue;
    }
    parent.branches[row.branch === 'no' ? 'no' : 'yes'].push(node);
  }

  const sortRecursive = (nodes: StepTreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position);
    for (const node of nodes) {
      sortRecursive(node.branches.yes);
      sortRecursive(node.branches.no);
    }
  };
  sortRecursive(roots);

  return roots;
}

export class AutomationRepository extends BaseRepository {
  protected readonly resourceName = 'Automation';

  constructor(db: TenantDb) {
    super(db);
  }

  async list(
    filter: { isActive?: boolean; triggerType?: string },
    pagination: PaginationQuery,
  ): Promise<Page<AutomationRow>> {
    const where: Prisma.AutomationWhereInput = {};
    if (filter.isActive !== undefined) where.isActive = filter.isActive;
    if (filter.triggerType) where.triggerType = filter.triggerType;

    return this.paginate(
      ({ skip, take }) =>
        this.db.automation.findMany({
          where,
          select: automationSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.automation.count({ where }),
      pagination,
    );
  }

  async findById(id: string): Promise<AutomationRow> {
    return this.requireFound(await this.db.automation.findFirst({ where: { id }, select: automationSelect }));
  }

  async listSteps(automationId: string): Promise<AutomationStepRow[]> {
    return this.db.automationStep.findMany({
      where: { automationId },
      select: stepSelect,
      orderBy: { position: 'asc' },
    });
  }

  async findStepTree(automationId: string): Promise<StepTreeNode[]> {
    return buildStepTree(await this.listSteps(automationId));
  }

  /** Active automations for a trigger — the engine's entry query. */
  async listActiveForTrigger(triggerType: string): Promise<
    Array<AutomationRow & { steps: AutomationStepRow[] }>
  > {
    const automations = await this.db.automation.findMany({
      where: { triggerType, isActive: true },
      select: automationSelect,
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      automations.map(async (automation) => ({
        ...automation,
        steps: await this.listSteps(automation.id),
      })),
    );
  }

  async create(input: {
    name: string;
    description: string | null;
    triggerType: string;
    triggerConfig: Prisma.InputJsonValue;
    isActive: boolean;
    steps: StepTreeInput[];
    userId: string;
  }): Promise<AutomationRow> {
    const created = await this.db.$transaction(async (tx) => {
      const automation = await tx.automation.create({
        data: scoped({
          name: input.name,
          description: input.description,
          triggerType: input.triggerType,
          triggerConfig: input.triggerConfig,
          isActive: input.isActive,
          userId: input.userId,
        }),
        select: { id: true },
      });

      const rows = flattenStepTree(automation.id, input.steps);
      if (rows.length > 0) {
        await tx.automationStep.createMany({ data: rows });
      }
      return automation;
    });

    return this.findById(created.id);
  }

  async updateMetadata(id: string, data: Prisma.AutomationUpdateManyMutationInput): Promise<void> {
    this.requireAffected(await this.db.automation.updateMany({ where: { id }, data }));
  }

  /**
   * Atomic step replacement. Deleting steps cascades to any parked
   * `AutomationPendingExecution` rows that referenced them
   * (`onDelete: SetNull` on `parentStepId`), so an in-flight wait resumes
   * against the new graph from the top rather than a step that no longer
   * exists.
   */
  async replaceSteps(automationId: string, steps: StepTreeInput[]): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.automationStep.deleteMany({ where: { automationId } });
      const rows = flattenStepTree(automationId, steps);
      if (rows.length > 0) {
        await tx.automationStep.createMany({ data: rows });
      }
    });
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    this.requireAffected(await this.db.automation.updateMany({ where: { id }, data: { isActive } }));
  }

  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.automation.deleteMany({ where: { id } }));
  }

  /** Atomic counter bump — the engine previously incremented on every resume too. */
  async recordExecution(id: string): Promise<void> {
    await this.db.automation.updateMany({
      where: { id },
      data: { executionCount: { increment: 1 }, lastExecutedAt: new Date() },
    });
  }

  // ── logs ──────────────────────────────────────────────────────────

  async listLogs(
    automationId: string,
    pagination: PaginationQuery,
    status?: string,
  ) {
    const where: Prisma.AutomationLogWhereInput = { automationId, ...(status ? { status } : {}) };
    return this.paginate(
      ({ skip, take }) =>
        this.db.automationLog.findMany({
          where,
          select: {
            id: true,
            automationId: true,
            triggerEvent: true,
            status: true,
            errorMessage: true,
            stepsExecuted: true,
            createdAt: true,
            contact: { select: { id: true, phone: true, name: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.automationLog.count({ where }),
      pagination,
    );
  }

  async createLog(input: {
    automationId: string;
    userId: string;
    contactId: string | null;
    triggerEvent: string;
    stepsExecuted: Prisma.InputJsonValue;
    status: string;
  }): Promise<{ id: string }> {
    return this.db.automationLog.create({
      data: scoped({
        automationId: input.automationId,
        userId: input.userId,
        contactId: input.contactId,
        triggerEvent: input.triggerEvent,
        stepsExecuted: input.stepsExecuted,
        status: input.status,
      }),
      select: { id: true },
    });
  }

  async updateLog(
    logId: string,
    data: { stepsExecuted: Prisma.InputJsonValue; status: string; errorMessage: string | null },
  ): Promise<void> {
    await this.db.automationLog.updateMany({ where: { id: logId }, data });
  }

  async findLogSteps(logId: string): Promise<unknown> {
    const row = await this.db.automationLog.findFirst({
      where: { id: logId },
      select: { stepsExecuted: true },
    });
    return row?.stepsExecuted ?? [];
  }
}

/** The parked-`wait` queue. */
export class AutomationQueueRepository extends BaseRepository {
  protected readonly resourceName = 'Pending execution';

  constructor(db: TenantDb) {
    super(db);
  }

  async park(input: {
    automationId: string;
    userId: string;
    contactId: string | null;
    logId: string | null;
    parentStepId: string | null;
    branch: 'yes' | 'no' | null;
    nextStepPosition: number;
    context: Prisma.InputJsonValue;
    runAt: Date;
  }): Promise<{ id: string }> {
    return this.db.automationPendingExecution.create({
      data: scoped({
        automationId: input.automationId,
        userId: input.userId,
        contactId: input.contactId,
        logId: input.logId,
        parentStepId: input.parentStepId,
        branch: input.branch,
        nextStepPosition: input.nextStepPosition,
        context: input.context,
        status: 'pending',
        runAt: input.runAt,
      }),
      select: { id: true },
    });
  }

  /** Due rows. `lte` is a real Prisma filter — the shim had no such method. */
  async findDue(now: Date, limit: number) {
    return this.db.automationPendingExecution.findMany({
      where: { status: 'pending', runAt: { lte: now } },
      select: {
        id: true,
        automationId: true,
        userId: true,
        contactId: true,
        logId: true,
        parentStepId: true,
        branch: true,
        nextStepPosition: true,
        context: true,
      },
      orderBy: { runAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Claims a row for this worker. Returns false when another worker got
   * there first.
   *
   * The old cron's claim could never fail: its shim returned a synthetic
   * one-element array for every update regardless of rows affected, so the
   * `if (!claim) continue` guard was dead and overlapping invocations
   * double-processed the same wait step.
   */
  async claim(id: string): Promise<boolean> {
    const affected = await this.db.automationPendingExecution.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'running' },
    });
    return affected.count > 0;
  }

  async complete(id: string): Promise<void> {
    await this.db.automationPendingExecution.deleteMany({ where: { id } });
  }

  async fail(id: string): Promise<void> {
    await this.db.automationPendingExecution.updateMany({ where: { id }, data: { status: 'failed' } });
  }

  /**
   * Releases rows a crashed worker left `running`. Without this a process
   * killed mid-resume strands the wait step forever.
   */
  async releaseStale(olderThan: Date): Promise<number> {
    const affected = await this.db.automationPendingExecution.updateMany({
      where: { status: 'running', runAt: { lte: olderThan } },
      data: { status: 'pending' },
    });
    return affected.count;
  }
}
