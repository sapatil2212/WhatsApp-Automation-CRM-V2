/**
 * Conversation persistence.
 *
 * `contactInclude` is the fix for the inbox: every read that returns a
 * conversation carries its contact. The old data layer accepted
 * `.select('*, contact:contacts(*)')`, threw the relation string away, and
 * returned bare rows.
 */

import type { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const contactSelect = {
  id: true,
  phone: true,
  name: true,
  avatarUrl: true,
} satisfies Prisma.ContactSelect;

/**
 * The most recent *inbound* message, used to compute the 24-hour service
 * window. Selected as a one-row relation so the window is a property of
 * the conversation read rather than an extra query per row.
 */
const lastInboundMessage = {
  where: { senderType: 'customer' },
  orderBy: { createdAt: 'desc' },
  take: 1,
  select: { createdAt: true },
} satisfies Prisma.Conversation$messagesArgs;

const listInclude = {
  contact: { select: contactSelect },
  messages: lastInboundMessage,
} satisfies Prisma.ConversationInclude;

const detailInclude = {
  contact: { include: { tags: { include: { tag: true } } } },
  messages: lastInboundMessage,
} satisfies Prisma.ConversationInclude;

export type ConversationListRow = Prisma.ConversationGetPayload<{ include: typeof listInclude }>;
export type ConversationDetailRow = Prisma.ConversationGetPayload<{ include: typeof detailInclude }>;

export interface ConversationListFilter {
  status?: 'open' | 'pending' | 'closed';
  search?: string;
  assignedTo?: string;
  unreadOnly?: boolean;
}

export class ConversationRepository extends BaseRepository {
  protected readonly resourceName = 'Conversation';

  constructor(db: TenantDb) {
    super(db);
  }

  private buildWhere(filter: ConversationListFilter): Prisma.ConversationWhereInput {
    const where: Prisma.ConversationWhereInput = {};

    if (filter.status) where.status = filter.status;
    if (filter.unreadOnly) where.unreadCount = { gt: 0 };

    if (filter.assignedTo === 'unassigned') {
      where.assignedAgentId = null;
    } else if (filter.assignedTo) {
      where.assignedAgentId = filter.assignedTo;
    }

    if (filter.search) {
      // Searching the contact through the relation, plus the denormalised
      // last-message text. No `mode: 'insensitive'` — MySQL only, and its
      // default collation is already case-insensitive.
      where.OR = [
        { contact: { name: { contains: filter.search } } },
        { contact: { phone: { contains: filter.search } } },
        { lastMessageText: { contains: filter.search } },
      ];
    }

    return where;
  }

  async list(
    filter: ConversationListFilter,
    pagination: PaginationQuery,
  ): Promise<Page<ConversationListRow>> {
    const where = this.buildWhere(filter);
    return this.paginate(
      ({ skip, take }) =>
        this.db.conversation.findMany({
          where,
          include: listInclude,
          // Nulls sort last on MySQL for DESC, so brand-new conversations
          // with no messages fall to the bottom rather than the top.
          orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
          skip,
          take,
        }),
      () => this.db.conversation.count({ where }),
      pagination,
    );
  }

  async findDetail(id: string): Promise<ConversationDetailRow> {
    return this.requireFound(
      await this.db.conversation.findFirst({ where: { id }, include: detailInclude }),
    );
  }

  async findForSend(id: string) {
    return this.requireFound(
      await this.db.conversation.findFirst({
        where: { id },
        select: {
          id: true,
          status: true,
          contactId: true,
          contact: { select: { id: true, phone: true } },
          messages: lastInboundMessage,
        },
      }),
    );
  }

  async findByContact(contactId: string): Promise<{ id: string } | null> {
    return this.db.conversation.findFirst({
      where: { contactId },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
  }

  async update(
    id: string,
    data: Partial<{ status: string; assignedAgentId: string | null }>,
  ): Promise<ConversationDetailRow> {
    this.requireAffected(await this.db.conversation.updateMany({ where: { id }, data }));
    return this.findDetail(id);
  }

  /**
   * Resets the unread badge. Returns whether anything changed so the
   * caller can skip a realtime broadcast when it was already zero — the
   * old client re-issued this update on every render and relied on a
   * `hasUnread` guard to avoid an infinite loop.
   */
  async markRead(id: string): Promise<boolean> {
    const affected = await this.db.conversation.updateMany({
      where: { id, unreadCount: { gt: 0 } },
      data: { unreadCount: 0 },
    });
    return affected.count > 0;
  }

  async unreadSummary(): Promise<{ totalUnread: number; conversationsWithUnread: number }> {
    const [aggregate, count] = await Promise.all([
      this.db.conversation.aggregate({
        where: { unreadCount: { gt: 0 } },
        _sum: { unreadCount: true },
      }),
      this.db.conversation.count({ where: { unreadCount: { gt: 0 } } }),
    ]);
    return {
      totalUnread: aggregate._sum.unreadCount ?? 0,
      conversationsWithUnread: count,
    };
  }

  /**
   * Ensures a conversation exists for a contact. Used by the send path and
   * (in step 1.3) the webhook. `userId` is carried because the column is
   * non-null in the schema, though tenant scoping is what actually
   * governs visibility.
   */
  async ensureForContact(contactId: string, userId: string): Promise<{ id: string }> {
    const existing = await this.findByContact(contactId);
    if (existing) return existing;
    return this.db.conversation.create({
      data: scoped({ contactId, userId, status: 'open' }),
      select: { id: true },
    });
  }

  /**
   * Open conversations per assigned agent.
   *
   * Backs round-robin assignment without a rotation counter: picking the
   * least-loaded agent is stateless, so it stays correct across restarts and
   * across two cron workers running at once. A stored "next agent" pointer
   * would need its own locking to achieve the same thing.
   */
  async openLoadByAgent(): Promise<Map<string, number>> {
    const rows = await this.db.conversation.groupBy({
      by: ['assignedAgentId'],
      where: { status: { in: ['open', 'pending'] }, assignedAgentId: { not: null } },
      _count: { _all: true },
    });
    const load = new Map<string, number>();
    for (const row of rows) {
      if (row.assignedAgentId) load.set(row.assignedAgentId, row._count._all);
    }
    return load;
  }

  /** Denormalised preview fields, updated whenever a message is stored. */
  async touchLastMessage(id: string, preview: string, at: Date): Promise<void> {
    await this.db.conversation.updateMany({
      where: { id },
      data: { lastMessageText: preview.slice(0, 500), lastMessageAt: at },
    });
  }

  /**
   * Records an inbound message: preview fields plus an **atomic** unread
   * increment.
   *
   * The webhook previously wrote `unreadCount: (read value) + 1`, so two
   * messages arriving in the same batch both wrote the same number and the
   * badge under-counted. `{ increment: 1 }` is computed by the database.
   */
  async recordInbound(id: string, preview: string, at: Date): Promise<void> {
    await this.db.conversation.updateMany({
      where: { id },
      data: {
        lastMessageText: preview.slice(0, 500),
        lastMessageAt: at,
        unreadCount: { increment: 1 },
      },
    });
  }

  async exists(id: string): Promise<boolean> {
    return (await this.db.conversation.count({ where: { id } })) > 0;
  }
}
