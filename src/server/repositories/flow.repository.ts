/**
 * Flow persistence — both the editor's CRUD and the runner's state machine.
 *
 * Four defects the previous data layer caused here, all structural:
 *
 *  1. **The runner died on the first customer reply.** Its duplicate check
 *     called `.filter("payload->>meta_message_id", …)`, a PostgREST-only
 *     operator the shim never implemented, so the call threw, the outer
 *     `try` swallowed it, and every reply was reported as "no match".
 *     Idempotency now keys on `Message.messageId`, a real indexed column.
 *
 *  2. **One-active-run-per-contact was never enforced.** The engine relied
 *     on a PostgreSQL *partial* unique index and caught SQLSTATE 23505.
 *     This is MySQL: no partial indexes, so the constraint did not exist
 *     and the error branch was dead code. Enforced here with a serialisable
 *     transaction instead.
 *
 *  3. **`execution_count` never incremented.** The RPC shim read
 *     `args.flow_id` while the caller passed `p_flow_id`, so every update
 *     ran with `id: undefined` and threw. Flow cards always showed 0 runs.
 *
 *  4. **Node replacement was not transactional**, acknowledged in a comment
 *     in the old route.
 */

import { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const flowSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  triggerType: true,
  triggerConfig: true,
  entryNodeId: true,
  fallbackPolicy: true,
  executionCount: true,
  lastExecutedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { nodes: true } },
} satisfies Prisma.FlowSelect;

const nodeSelect = {
  nodeKey: true,
  nodeType: true,
  config: true,
} satisfies Prisma.FlowNodeSelect;

export type FlowRow = Prisma.FlowGetPayload<{ select: typeof flowSelect }>;
export type FlowNodeRow = Prisma.FlowNodeGetPayload<{ select: typeof nodeSelect }>;

export interface FlowNodeWrite {
  nodeKey: string;
  nodeType: string;
  config: Prisma.InputJsonValue;
}

export class FlowRepository extends BaseRepository {
  protected readonly resourceName = 'Flow';

  constructor(db: TenantDb) {
    super(db);
  }

  async list(
    filter: { status?: string; search?: string },
    pagination: PaginationQuery,
  ): Promise<Page<FlowRow>> {
    const where: Prisma.FlowWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.search) where.name = { contains: filter.search };

    return this.paginate(
      ({ skip, take }) =>
        this.db.flow.findMany({
          where,
          select: flowSelect,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.flow.count({ where }),
      pagination,
    );
  }

  async findById(id: string): Promise<FlowRow> {
    return this.requireFound(await this.db.flow.findFirst({ where: { id }, select: flowSelect }));
  }

  async findWithNodes(id: string): Promise<FlowRow & { nodes: FlowNodeRow[] }> {
    const flow = await this.findById(id);
    return { ...flow, nodes: await this.listNodes(id) };
  }

  async listNodes(flowId: string): Promise<FlowNodeRow[]> {
    return this.db.flowNode.findMany({ where: { flowId }, select: nodeSelect, orderBy: { nodeKey: 'asc' } });
  }

  async create(input: {
    name: string;
    description: string | null;
    triggerType: string;
    triggerConfig: Prisma.InputJsonValue;
    entryNodeKey: string | null;
    fallbackPolicy: Prisma.InputJsonValue;
    nodes: FlowNodeWrite[];
    userId: string;
  }): Promise<FlowRow> {
    const created = await this.db.$transaction(async (tx) => {
      const flow = await tx.flow.create({
        data: scoped({
          name: input.name,
          description: input.description,
          status: 'draft',
          triggerType: input.triggerType,
          triggerConfig: input.triggerConfig,
          entryNodeId: input.entryNodeKey,
          fallbackPolicy: input.fallbackPolicy,
          userId: input.userId,
        }),
        select: { id: true },
      });

      if (input.nodes.length > 0) {
        await tx.flowNode.createMany({
          data: input.nodes.map((node) => ({
            flowId: flow.id,
            nodeKey: node.nodeKey,
            nodeType: node.nodeType,
            config: node.config,
          })),
        });
      }

      return flow;
    });

    return this.findById(created.id);
  }

  async updateMetadata(id: string, data: Prisma.FlowUpdateManyMutationInput): Promise<void> {
    this.requireAffected(await this.db.flow.updateMany({ where: { id }, data }));
  }

  /**
   * Replaces the node graph atomically.
   *
   * Delete-then-insert inside one transaction: a diffing upsert would be
   * more surgical, but the editor always submits the whole graph and
   * `(flowId, nodeKey)` is unique, so a partial diff risks transient
   * unique-constraint collisions when two nodes swap keys.
   */
  async replaceNodes(flowId: string, nodes: FlowNodeWrite[]): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.flowNode.deleteMany({ where: { flowId } });
      if (nodes.length > 0) {
        await tx.flowNode.createMany({
          data: nodes.map((node) => ({
            flowId,
            nodeKey: node.nodeKey,
            nodeType: node.nodeType,
            config: node.config,
          })),
        });
      }
    });
  }

  async setStatus(id: string, status: string): Promise<void> {
    this.requireAffected(await this.db.flow.updateMany({ where: { id }, data: { status } }));
  }

  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.flow.deleteMany({ where: { id } }));
  }

  /** Active flows a fresh inbound message could trigger. */
  async listActiveForTrigger(triggerTypes: string[]): Promise<Array<FlowRow & { nodes: FlowNodeRow[] }>> {
    const flows = await this.db.flow.findMany({
      where: { status: 'active', triggerType: { in: triggerTypes } },
      select: flowSelect,
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(flows.map(async (flow) => ({ ...flow, nodes: await this.listNodes(flow.id) })));
  }

  /** Atomic counter bump. Replaces the RPC shim that always threw. */
  async incrementExecutionCount(id: string): Promise<void> {
    await this.db.flow.updateMany({
      where: { id },
      data: { executionCount: { increment: 1 }, lastExecutedAt: new Date() },
    });
  }
}

const runSelect = {
  id: true,
  flowId: true,
  status: true,
  currentNodeKey: true,
  vars: true,
  repromptCount: true,
  startedAt: true,
  lastAdvancedAt: true,
  endedAt: true,
  endReason: true,
  contactId: true,
  conversationId: true,
  userId: true,
} satisfies Prisma.FlowRunSelect;

const runWithContact = {
  ...runSelect,
  contact: { select: { id: true, phone: true, name: true } },
} satisfies Prisma.FlowRunSelect;

export type FlowRunRow = Prisma.FlowRunGetPayload<{ select: typeof runSelect }>;
export type FlowRunWithContactRow = Prisma.FlowRunGetPayload<{ select: typeof runWithContact }>;

export class FlowRunRepository extends BaseRepository {
  protected readonly resourceName = 'Flow run';

  constructor(db: TenantDb) {
    super(db);
  }

  async listForFlow(
    flowId: string,
    pagination: PaginationQuery,
    status?: string,
  ): Promise<Page<FlowRunWithContactRow>> {
    const where: Prisma.FlowRunWhereInput = { flowId, ...(status ? { status } : {}) };
    return this.paginate(
      ({ skip, take }) =>
        this.db.flowRun.findMany({
          where,
          select: runWithContact,
          orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.flowRun.count({ where }),
      pagination,
    );
  }

  async findActiveForContact(contactId: string): Promise<FlowRunRow | null> {
    // `.limit(1)` semantics rather than `findUnique`: a historical duplicate
    // must not throw and take the whole webhook down for that contact.
    const rows = await this.db.flowRun.findMany({
      where: { contactId, status: 'active' },
      select: runSelect,
      orderBy: { startedAt: 'desc' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  /**
   * Starts a run, guaranteeing at most one active run per contact.
   *
   * Serialisable isolation is what makes the check-then-insert safe: MySQL
   * cannot express "unique where status='active'", so two concurrent
   * webhooks would both pass a plain read. Returns null when another
   * transaction won the race.
   */
  async startRun(input: {
    flowId: string;
    userId: string;
    contactId: string;
    conversationId: string | null;
    entryNodeKey: string;
  }): Promise<FlowRunRow | null> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const existing = await tx.flowRun.count({
            where: { contactId: input.contactId, status: 'active' },
          });
          if (existing > 0) return null;

          return tx.flowRun.create({
            data: scoped({
              flowId: input.flowId,
              userId: input.userId,
              contactId: input.contactId,
              conversationId: input.conversationId,
              status: 'active',
              currentNodeKey: input.entryNodeKey,
              vars: {},
            }),
            select: runSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch {
      // A serialisation failure means a concurrent starter committed first.
      // Treated as "already running", same as the explicit count check.
      return null;
    }
  }

  /**
   * Optimistic advance: only moves the pointer when it still holds the
   * value the caller read. Two simultaneous button taps collide here and
   * the second becomes a no-op.
   */
  async advanceCurrentNode(input: {
    runId: string;
    expectedNodeKey: string | null;
    nextNodeKey: string;
  }): Promise<boolean> {
    const affected = await this.db.flowRun.updateMany({
      where: {
        id: input.runId,
        status: 'active',
        currentNodeKey: input.expectedNodeKey,
      },
      data: { currentNodeKey: input.nextNodeKey, lastAdvancedAt: new Date() },
    });
    return affected.count > 0;
  }

  async setVars(runId: string, vars: Prisma.InputJsonValue): Promise<void> {
    await this.db.flowRun.updateMany({
      where: { id: runId },
      data: { vars, repromptCount: 0, lastAdvancedAt: new Date() },
    });
  }

  async setRepromptCount(runId: string, count: number): Promise<void> {
    await this.db.flowRun.updateMany({ where: { id: runId }, data: { repromptCount: count } });
  }

  /**
   * Records the message a suspending node just sent, so the inbox can show
   * which prompt a customer is answering.
   */
  async setLastPromptMessage(runId: string, messageId: string | null): Promise<void> {
    await this.db.flowRun.updateMany({
      where: { id: runId },
      data: { lastPromptMessageId: messageId },
    });
  }

  async endRun(runId: string, status: string, reason: string): Promise<void> {
    await this.db.flowRun.updateMany({
      where: { id: runId },
      data: { status, endedAt: new Date(), endReason: reason },
    });
  }

  /** Pauses any active run for a contact — an agent replying takes over. */
  async pauseForContact(contactId: string, reason: string): Promise<number> {
    const affected = await this.db.flowRun.updateMany({
      where: { contactId, status: 'active' },
      data: { status: 'paused_by_agent', endedAt: new Date(), endReason: reason },
    });
    return affected.count;
  }

  /**
   * Stale-run sweep. Each flow's own `on_timeout_hours` is honoured by
   * returning the policy alongside the run — the old cron dropped the
   * joined policy and swept everything at the 24h default.
   */
  async findStaleActive(limit: number) {
    return this.db.flowRun.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        flowId: true,
        lastAdvancedAt: true,
        flow: { select: { fallbackPolicy: true } },
      },
      orderBy: { lastAdvancedAt: 'asc' },
      take: limit,
    });
  }

  async timeOut(runId: string): Promise<boolean> {
    const affected = await this.db.flowRun.updateMany({
      where: { id: runId, status: 'active' },
      data: { status: 'timed_out', endedAt: new Date(), endReason: 'stale_sweep' },
    });
    return affected.count > 0;
  }

  // ── events ────────────────────────────────────────────────────────

  async logEvent(input: {
    flowRunId: string;
    eventType: string;
    nodeKey: string | null;
    payload: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.db.flowRunEvent.create({
      data: {
        flowRunId: input.flowRunId,
        eventType: input.eventType,
        nodeKey: input.nodeKey,
        payload: input.payload,
      },
    });
  }

  async listEvents(runId: string, limit = 200) {
    return this.db.flowRunEvent.findMany({
      where: { flowRunId: runId },
      select: { id: true, eventType: true, nodeKey: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
}
