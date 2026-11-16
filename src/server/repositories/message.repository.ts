/**
 * Message and reaction persistence.
 *
 * `Message` has no `tenantId` column, so it is guarded through its
 * conversation (see TENANT_SCOPES). That matters here: the previous data
 * layer injected `tenantId` into *every* insert unconditionally, which
 * made `prisma.message.create` throw `Unknown argument 'tenantId'` on
 * every outbound message. The message reached WhatsApp and then failed to
 * persist, so the agent saw an error toast for a message the customer had
 * already received.
 */

import type { Prisma } from '@prisma/client';

import { type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const messageInclude = {
  reactions: {
    select: { id: true, actorType: true, actorId: true, emoji: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  // The quoted message travels with the reply. Resolving it client-side from
  // the loaded page fails whenever the parent is older than the current page,
  // which is exactly when a quote matters most.
  replyTo: {
    select: {
      id: true,
      senderType: true,
      contentType: true,
      contentText: true,
      templateName: true,
    },
  },
} satisfies Prisma.MessageInclude;

export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export interface CreateMessageInput {
  conversationId: string;
  senderType: 'customer' | 'agent' | 'bot';
  senderId?: string | null;
  contentType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  /** Meta's `wamid.…`, when the upstream send already succeeded. */
  whatsappMessageId?: string | null;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  interactiveReplyId?: string | null;
  /** Our own message id being quoted, for reply-with-context. */
  replyToMessageId?: string | null;
}

export class MessageRepository extends BaseRepository {
  protected readonly resourceName = 'Message';

  constructor(db: TenantDb) {
    super(db);
  }

  /**
   * Newest-first page. A chat thread loads the tail and scrolls up, so
   * paging from the newest end is what the UI actually needs — and it
   * bounds the query, unlike the old `select('*')` over the whole
   * conversation.
   */
  async listForConversation(
    conversationId: string,
    pagination: PaginationQuery,
    before?: Date,
  ): Promise<Page<MessageRow>> {
    const where: Prisma.MessageWhereInput = {
      conversationId,
      ...(before ? { createdAt: { lt: before } } : {}),
    };
    return this.paginate(
      ({ skip, take }) =>
        this.db.message.findMany({
          where,
          include: messageInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take,
        }),
      () => this.db.message.count({ where }),
      pagination,
    );
  }

  async findById(id: string): Promise<MessageRow> {
    return this.requireFound(await this.db.message.findFirst({ where: { id }, include: messageInclude }));
  }

  /** Resolves our row from Meta's id, for webhook status mirroring. */
  async findByWhatsappId(whatsappMessageId: string) {
    return this.db.message.findFirst({
      where: { messageId: whatsappMessageId },
      select: { id: true, conversationId: true, status: true },
    });
  }

  async create(input: CreateMessageInput): Promise<MessageRow> {
    return this.db.message.create({
      data: {
        conversationId: input.conversationId,
        senderType: input.senderType,
        senderId: input.senderId ?? null,
        contentType: input.contentType,
        contentText: input.contentText ?? null,
        mediaUrl: input.mediaUrl ?? null,
        templateName: input.templateName ?? null,
        // Column is `messageId`; the DTO exposes it as
        // `whatsappMessageId` because that is what it holds.
        messageId: input.whatsappMessageId ?? null,
        status: input.status ?? 'sent',
        interactiveReplyId: input.interactiveReplyId ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
      },
      include: messageInclude,
    });
  }

  /**
   * Resolves a quote target. Scoped by conversation so a caller cannot quote
   * a message from a conversation they are not in by guessing its id.
   * Returns the Meta id too, which is what `context.message_id` needs.
   */
  async findQuoteTarget(conversationId: string, messageId: string) {
    return this.db.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, messageId: true },
    });
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db.message.updateMany({ where: { id }, data: { status } });
  }

  /**
   * Mirrors a Meta delivery receipt. Scoped by conversation through the
   * guard, so a spoofed webhook cannot touch another tenant's rows.
   */
  async updateStatusByWhatsappId(whatsappMessageId: string, status: string): Promise<boolean> {
    const affected = await this.db.message.updateMany({
      where: { messageId: whatsappMessageId },
      data: { status },
    });
    return affected.count > 0;
  }

  async countInboundSince(conversationId: string, since: Date): Promise<number> {
    return this.db.message.count({
      where: { conversationId, senderType: 'customer', createdAt: { gte: since } },
    });
  }

  /** Most recent inbound timestamp, for the 24-hour service window. */
  async lastInboundAt(conversationId: string): Promise<Date | null> {
    const row = await this.db.message.findFirst({
      where: { conversationId, senderType: 'customer' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  // ── reactions ─────────────────────────────────────────────────────

  /**
   * Sets or replaces one actor's reaction. `MessageReaction` is unique on
   * `(messageId, actorType, actorId)`, and `actorId` is nullable, so the
   * empty string stands in for "no actor id" to keep the constraint usable
   * — matching the shape the existing rows already use.
   */
  async setReaction(input: {
    messageId: string;
    conversationId: string;
    actorType: 'customer' | 'agent';
    actorId: string | null;
    emoji: string;
  }): Promise<void> {
    const key = {
      messageId_actorType_actorId: {
        messageId: input.messageId,
        actorType: input.actorType,
        actorId: input.actorId ?? '',
      },
    };
    await this.db.messageReaction.upsert({
      where: key,
      create: {
        messageId: input.messageId,
        conversationId: input.conversationId,
        actorType: input.actorType,
        actorId: input.actorId ?? '',
        emoji: input.emoji,
      },
      update: { emoji: input.emoji },
    });
  }

  /**
   * Removes one actor's reaction. Previously broken: the shim forced
   * `where.tenantId` onto every delete, and `MessageReaction` has no
   * `tenantId` column, so clearing a reaction always threw.
   */
  async clearReaction(input: {
    messageId: string;
    actorType: 'customer' | 'agent';
    actorId: string | null;
  }): Promise<void> {
    await this.db.messageReaction.deleteMany({
      where: {
        messageId: input.messageId,
        actorType: input.actorType,
        actorId: input.actorId ?? '',
      },
    });
  }

  async listReactions(conversationId: string) {
    return this.db.messageReaction.findMany({
      where: { conversationId },
      select: {
        id: true,
        messageId: true,
        actorType: true,
        actorId: true,
        emoji: true,
        createdAt: true,
      },
    });
  }
}
