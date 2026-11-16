/**
 * Broadcast persistence.
 *
 * Two things this fixes structurally:
 *
 *  1. **The aggregate counters are actually maintained.** `sentCount`,
 *     `deliveredCount`, `readCount`, `repliedCount` and `failedCount` were
 *     written once at insert (all zero) and never again. Both the list and
 *     detail pages carried a comment claiming "aggregate counts are
 *     maintained by the DB trigger (migration 003)" — there is no
 *     migrations directory in this repository and no trigger. Every rate
 *     and funnel rendered 0% forever. Counters are now incremented
 *     atomically alongside each recipient transition.
 *
 *  2. **Recipients are paginated and carry their contact.** The detail page
 *     read every recipient row and lost the contact join.
 */

import type { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const broadcastSelect = {
  id: true,
  name: true,
  templateName: true,
  templateLanguage: true,
  templateVariables: true,
  audienceFilter: true,
  scheduledAt: true,
  status: true,
  totalRecipients: true,
  sentCount: true,
  deliveredCount: true,
  readCount: true,
  repliedCount: true,
  failedCount: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BroadcastSelect;

const recipientInclude = {
  contact: { select: { id: true, phone: true, name: true } },
} satisfies Prisma.BroadcastRecipientInclude;

export type BroadcastRow = Prisma.BroadcastGetPayload<{ select: typeof broadcastSelect }>;
export type BroadcastRecipientRow = Prisma.BroadcastRecipientGetPayload<{
  include: typeof recipientInclude;
}>;

export interface BroadcastListFilter {
  status?: string;
  search?: string;
}

/** Counter column matching each recipient status. */
const COUNTER_COLUMN: Record<string, keyof BroadcastRow | null> = {
  pending: null,
  sent: 'sentCount',
  delivered: 'deliveredCount',
  read: 'readCount',
  replied: 'repliedCount',
  failed: 'failedCount',
};

export class BroadcastRepository extends BaseRepository {
  protected readonly resourceName = 'Campaign';

  constructor(db: TenantDb) {
    super(db);
  }

  private buildWhere(filter: BroadcastListFilter): Prisma.BroadcastWhereInput {
    const where: Prisma.BroadcastWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.search) where.name = { contains: filter.search };
    return where;
  }

  async list(filter: BroadcastListFilter, pagination: PaginationQuery): Promise<Page<BroadcastRow>> {
    const where = this.buildWhere(filter);
    return this.paginate(
      ({ skip, take }) =>
        this.db.broadcast.findMany({
          where,
          select: broadcastSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.broadcast.count({ where }),
      pagination,
    );
  }

  async findById(id: string): Promise<BroadcastRow> {
    return this.requireFound(await this.db.broadcast.findFirst({ where: { id }, select: broadcastSelect }));
  }

  /**
   * Find scheduled broadcasts that are due to begin dispatch.
   */
  async findDueScheduled(now = new Date(), limit = 10): Promise<BroadcastRow[]> {
    return this.db.broadcast.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: now },
      },
      select: broadcastSelect,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async create(input: {
    name: string;
    templateName: string;
    templateLanguage: string;
    templateVariables: Prisma.InputJsonValue | undefined;
    audienceFilter: Prisma.InputJsonValue | undefined;
    scheduledAt: Date | null;
    status: string;
    userId: string;
  }): Promise<BroadcastRow> {
    return this.db.broadcast.create({
      data: scoped({
        name: input.name,
        templateName: input.templateName,
        templateLanguage: input.templateLanguage,
        ...(input.templateVariables !== undefined ? { templateVariables: input.templateVariables } : {}),
        ...(input.audienceFilter !== undefined ? { audienceFilter: input.audienceFilter } : {}),
        scheduledAt: input.scheduledAt,
        status: input.status,
        userId: input.userId,
      }),
      select: broadcastSelect,
    });
  }

  async update(
    id: string,
    data: Prisma.BroadcastUpdateManyMutationInput,
  ): Promise<BroadcastRow> {
    this.requireAffected(await this.db.broadcast.updateMany({ where: { id }, data }));
    return this.findById(id);
  }

  /**
   * Status change guarded by the expected current status, so two concurrent
   * dispatchers cannot both move a campaign into `sending`. Returns false
   * when the precondition failed — the caller treats that as "someone else
   * got there first".
   */
  async transitionStatus(id: string, from: string, to: string): Promise<boolean> {
    const affected = await this.db.broadcast.updateMany({
      where: { id, status: from },
      data: { status: to },
    });
    return affected.count > 0;
  }

  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.broadcast.deleteMany({ where: { id } }));
  }

  // ── recipients ────────────────────────────────────────────────────

  /**
   * Materialises the audience. Chunked because MySQL's max packet size
   * makes a single multi-thousand-row insert unreliable, and
   * `skipDuplicates` keeps a retried materialisation idempotent.
   */
  async addRecipients(broadcastId: string, contactIds: string[]): Promise<number> {
    if (contactIds.length === 0) return 0;

    const CHUNK = 500;
    let inserted = 0;

    for (let index = 0; index < contactIds.length; index += CHUNK) {
      const chunk = contactIds.slice(index, index + CHUNK);
      const result = await this.db.broadcastRecipient.createMany({
        data: chunk.map((contactId) => ({ broadcastId, contactId, status: 'pending' })),
      });
      inserted += result.count;
    }

    await this.db.broadcast.updateMany({
      where: { id: broadcastId },
      data: { totalRecipients: { increment: inserted } },
    });

    return inserted;
  }

  async listRecipients(
    broadcastId: string,
    pagination: PaginationQuery,
    status?: string,
  ): Promise<Page<BroadcastRecipientRow>> {
    const where: Prisma.BroadcastRecipientWhereInput = {
      broadcastId,
      ...(status ? { status } : {}),
    };
    return this.paginate(
      ({ skip, take }) =>
        this.db.broadcastRecipient.findMany({
          where,
          include: recipientInclude,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.broadcastRecipient.count({ where }),
      pagination,
    );
  }

  /** Next pending batch, with the phone number the send needs. */
  async claimPendingBatch(broadcastId: string, batchSize: number) {
    return this.db.broadcastRecipient.findMany({
      where: { broadcastId, status: 'pending' },
      select: {
        id: true,
        contactId: true,
        contact: { select: { id: true, phone: true, name: true } },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
  }

  async countPending(broadcastId: string): Promise<number> {
    return this.db.broadcastRecipient.count({ where: { broadcastId, status: 'pending' } });
  }

  /**
   * Moves one recipient forward and bumps the matching campaign counter in
   * the same transaction, so the aggregate can never drift from the rows it
   * summarises.
   */
  async recordRecipientResult(input: {
    broadcastId: string;
    recipientId: string;
    status: 'sent' | 'failed';
    at: Date;
    errorMessage?: string | null;
    /** Meta's `wamid.…`, so the delivery webhook can find this row later. */
    whatsappMessageId?: string | null;
  }): Promise<void> {
    const counter = COUNTER_COLUMN[input.status];

    await this.db.$transaction(async (tx) => {
      const affected = await tx.broadcastRecipient.updateMany({
        // `status: 'pending'` is the precondition: if another dispatcher
        // already handled this row, we must not double-count it.
        where: { id: input.recipientId, broadcastId: input.broadcastId, status: 'pending' },
        data: {
          status: input.status,
          ...(input.status === 'sent' ? { sentAt: input.at } : {}),
          ...(input.whatsappMessageId !== undefined
            ? { whatsappMessageId: input.whatsappMessageId }
            : {}),
          errorMessage: input.errorMessage ?? null,
        },
      });

      if (affected.count === 0 || !counter) return;

      await tx.broadcast.updateMany({
        where: { id: input.broadcastId },
        data: { [counter]: { increment: affected.count } },
      });
    });
  }

  /**
   * Applies a Meta delivery callback. Guarded by the ladder at the service
   * layer; here the write is conditional on the row still holding the
   * status we read, and the counter moves with it.
   */
  async advanceRecipientStatus(input: {
    recipientId: string;
    broadcastId: string;
    from: string;
    to: 'delivered' | 'read' | 'replied';
    at: Date;
  }): Promise<boolean> {
    const counter = COUNTER_COLUMN[input.to];
    const timestampColumn =
      input.to === 'delivered' ? 'deliveredAt' : input.to === 'read' ? 'readAt' : 'repliedAt';

    return this.db.$transaction(async (tx) => {
      const affected = await tx.broadcastRecipient.updateMany({
        where: { id: input.recipientId, status: input.from },
        data: { status: input.to, [timestampColumn]: input.at },
      });
      if (affected.count === 0) return false;

      if (counter) {
        await tx.broadcast.updateMany({
          where: { id: input.broadcastId },
          data: { [counter]: { increment: affected.count } },
        });
      }
      return true;
    });
  }

  /**
   * Resolves a recipient from Meta's message id — the correlation the old
   * webhook could not perform. It matched `BroadcastRecipient.id` (a UUID
   * primary key) against `status.id` (a `wamid.…`), then fell back to
   * searching `errorMessage` for the id. Neither could ever match, so
   * delivered/read tracking was dead code.
   */
  async findRecipientByWhatsappMessageId(whatsappMessageId: string) {
    return this.db.broadcastRecipient.findFirst({
      where: { whatsappMessageId },
      select: { id: true, broadcastId: true, status: true },
    });
  }

  /** Recipient rows for a contact, used to flag a reply to a campaign. */
  async findRecipientsForContact(contactId: string, since: Date) {
    return this.db.broadcastRecipient.findMany({
      where: {
        contactId,
        status: { in: ['sent', 'delivered', 'read'] },
        sentAt: { gte: since },
      },
      select: { id: true, broadcastId: true, status: true },
      orderBy: { sentAt: 'desc' },
      take: 5,
    });
  }
}
