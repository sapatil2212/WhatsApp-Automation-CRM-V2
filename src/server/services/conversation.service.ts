/**
 * Inbox business rules.
 *
 * Owns the rules that were previously enforced only in the browser, or not
 * at all:
 *  - the 24-hour customer-service window (client-side only before, so a
 *    direct POST bypassed it and burned a Meta send),
 *  - "a template is required once the window has closed",
 *  - assignment targets must be members of this tenant,
 *  - marking read is idempotent.
 *
 * Actually talking to Meta is not this service's job. `sendMessage` here
 * persists and validates; the WhatsApp transport is injected, so this file
 * stays unit-testable and the same rules apply whether a send originates
 * from the inbox, an automation, or a flow.
 */

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Page,
  type TenantDb,
} from '../kernel';
import {
  computeServiceWindow,
  toConversationDetailDto,
  toConversationDto,
  toMessageDto,
  type ConversationDetailDto,
  type ConversationDto,
  type MessageDto,
  type UnreadSummaryDto,
} from '../dtos/conversation.dto';
import { ConversationRepository, type ConversationListFilter } from '../repositories/conversation.repository';
import { MessageRepository } from '../repositories/message.repository';
import { ProfileRepository } from '../repositories/profile.repository';
import type {
  ListConversationsQuery,
  ListMessagesQuery,
  SendMessageBody,
  SetReactionBody,
  UpdateConversationBody,
} from '../validators/conversation.validator';

/**
 * What the service needs from the WhatsApp transport. Deliberately narrow:
 * the service knows "send this and give me an id", not how tokens are
 * decrypted or which phone-number variant succeeded.
 */
export interface OutboundTransport {
  sendText(input: {
    to: string;
    text: string;
    /** Meta's `wamid.…` to quote, for reply-with-context. */
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }>;
  sendTemplate(input: {
    to: string;
    templateName: string;
    language?: string;
    params: string[];
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }>;
  sendMedia(input: {
    to: string;
    contentType: 'image' | 'document' | 'audio' | 'video';
    mediaUrl: string;
    caption?: string;
    filename?: string;
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }>;
}

/**
 * Reactions. Split from `OutboundTransport` because only the inbox uses it —
 * an automation cannot react.
 */
export interface ReactionSender {
  sendReaction(input: {
    to: string;
    targetWhatsappMessageId: string;
    emoji: string;
  }): Promise<{ whatsappMessageId: string }>;
}

export interface ConversationServiceDeps {
  conversations: ConversationRepository;
  messages: MessageRepository;
  profiles: Pick<ProfileRepository, 'existsInTenant'>;
  transport?: OutboundTransport;
  reactions?: ReactionSender;
}

export class ConversationService {
  constructor(
    private readonly deps: ConversationServiceDeps,
    private readonly userId: string,
  ) {}

  static create(
    db: TenantDb,
    userId: string,
    transport?: OutboundTransport & Partial<ReactionSender>,
  ): ConversationService {
    return new ConversationService(
      {
        conversations: new ConversationRepository(db),
        messages: new MessageRepository(db),
        profiles: new ProfileRepository(db),
        transport,
        reactions: transport && 'sendReaction' in transport ? (transport as ReactionSender) : undefined,
      },
      userId,
    );
  }

  async list(query: ListConversationsQuery): Promise<Page<ConversationDto>> {
    const filter: ConversationListFilter = {
      status: query.status,
      search: query.search,
      assignedTo: query.assignedTo,
      unreadOnly: query.unreadOnly,
    };
    const page = await this.deps.conversations.list(filter, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return { ...page, items: page.items.map((row) => toConversationDto(row)) };
  }

  async getDetail(id: string): Promise<ConversationDetailDto> {
    return toConversationDetailDto(await this.deps.conversations.findDetail(id));
  }

  async update(id: string, body: UpdateConversationBody): Promise<ConversationDetailDto> {
    if (body.assignedAgentId) {
      // Guards against assigning a conversation to a user outside this
      // tenant. Nothing checked this before.
      if (!(await this.deps.profiles.existsInTenant(body.assignedAgentId))) {
        throw new NotFoundError('Agent');
      }
    }

    const row = await this.deps.conversations.update(id, {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.assignedAgentId !== undefined ? { assignedAgentId: body.assignedAgentId } : {}),
    });
    return toConversationDetailDto(row);
  }

  /** Idempotent: returns whether the badge actually changed. */
  async markRead(id: string): Promise<{ changed: boolean }> {
    if (!(await this.deps.conversations.exists(id))) throw new NotFoundError('Conversation');
    return { changed: await this.deps.conversations.markRead(id) };
  }

  async unreadSummary(): Promise<UnreadSummaryDto> {
    return this.deps.conversations.unreadSummary();
  }

  async listMessages(conversationId: string, query: ListMessagesQuery): Promise<Page<MessageDto>> {
    if (!(await this.deps.conversations.exists(conversationId))) throw new NotFoundError('Conversation');
    const page = await this.deps.messages.listForConversation(
      conversationId,
      { page: query.page, pageSize: query.pageSize },
      query.before,
    );
    return { ...page, items: page.items.map(toMessageDto) };
  }

  /**
   * Server-side enforcement of WhatsApp's 24-hour customer-service window.
   *
   * Outside the window Meta only accepts template messages. Sending free
   * text anyway returns error #131047 *after* the request, which the old
   * code surfaced as a generic 502 with no explanation. Refusing up front
   * turns an opaque upstream failure into an actionable 409.
   */
  private assertSendable(input: {
    contentType: SendMessageBody['contentType'];
    lastInboundAt: Date | null;
    conversationStatus: string;
  }): void {
    if (input.conversationStatus === 'closed') {
      throw new ConflictError('This conversation is closed. Reopen it before sending.');
    }

    const window = computeServiceWindow(input.lastInboundAt);
    if (window.expired && input.contentType !== 'template') {
      throw new ConflictError(
        'The 24-hour customer service window has closed. Send an approved template to re-open the conversation.',
        { details: { serviceWindow: window, requiredContentType: 'template' } },
      );
    }
  }

  async sendMessage(conversationId: string, body: SendMessageBody): Promise<MessageDto> {
    const transport = this.deps.transport;
    if (!transport) {
      // A programming error, not a client one: the controller must inject
      // a transport for any route that can send.
      throw new ForbiddenError('Outbound messaging is not available in this context.');
    }

    const conversation = await this.deps.conversations.findForSend(conversationId);
    const phone = conversation.contact?.phone;
    if (!phone) {
      throw new ValidationError('This contact has no phone number on file.');
    }

    this.assertSendable({
      contentType: body.contentType,
      lastInboundAt: conversation.messages[0]?.createdAt ?? null,
      conversationStatus: conversation.status,
    });

    // Resolve the quote target before touching Meta. A parent from another
    // conversation is refused so a caller cannot quote a message they cannot
    // see by guessing its id.
    let contextMessageId: string | undefined;
    if (body.replyToMessageId) {
      const parent = await this.deps.messages.findQuoteTarget(conversationId, body.replyToMessageId);
      if (!parent) {
        throw new ValidationError('The message being replied to is not part of this conversation.', {
          details: { replyToMessageId: body.replyToMessageId },
        });
      }
      // A parent that never reached Meta has no id to quote. Send without the
      // quote rather than dropping the message entirely.
      contextMessageId = parent.messageId ?? undefined;
    }

    let whatsappMessageId: string;
    let preview: string;
    let contentText: string | null = null;
    let mediaUrl: string | null = null;
    let templateName: string | null = null;

    if (body.contentType === 'text') {
      ({ whatsappMessageId } = await transport.sendText({
        to: phone,
        text: body.text,
        contextMessageId,
      }));
      contentText = body.text;
      preview = body.text;
    } else if (body.contentType === 'template') {
      ({ whatsappMessageId } = await transport.sendTemplate({
        to: phone,
        templateName: body.templateName,
        language: body.templateLanguage,
        params: body.templateParams,
        contextMessageId,
      }));
      templateName = body.templateName;
      preview = `[template] ${body.templateName}`;
    } else {
      ({ whatsappMessageId } = await transport.sendMedia({
        to: phone,
        contentType: body.contentType,
        mediaUrl: body.mediaUrl,
        caption: body.caption,
        filename: body.filename,
        contextMessageId,
      }));
      mediaUrl = body.mediaUrl;
      contentText = body.caption ?? null;
      preview = body.caption ?? `[${body.contentType}]`;
    }

    // Persist only after Meta accepted, and record the upstream id so the
    // delivery webhook can correlate. The old path stored no id at all,
    // which is why delivered/read tracking never worked.
    const message = await this.deps.messages.create({
      conversationId,
      senderType: 'agent',
      senderId: this.userId,
      contentType: body.contentType,
      contentText,
      mediaUrl,
      templateName,
      whatsappMessageId,
      status: 'sent',
      // Persisted even when the parent had no Meta id: the quote still
      // renders in our own thread.
      replyToMessageId: body.replyToMessageId ?? null,
    });

    await this.deps.conversations.touchLastMessage(conversationId, preview, message.createdAt);

    return toMessageDto(message);
  }

  /**
   * Sets or clears this agent's reaction; an empty emoji clears it.
   *
   * Meta is told first, then the row is written, so the customer's phone and
   * our thread cannot disagree. A message that never reached Meta has nothing
   * to react to — refused rather than stored as a reaction only we can see.
   */
  async setReaction(conversationId: string, messageId: string, body: SetReactionBody): Promise<void> {
    const message = await this.deps.messages.findById(messageId);
    if (message.conversationId !== conversationId) {
      // Prevents reacting to a message by guessing its id from another
      // conversation the caller can see.
      throw new NotFoundError('Message');
    }

    const emoji = body.emoji.trim();

    if (this.deps.reactions) {
      if (!message.messageId) {
        throw new ValidationError('This message has not reached WhatsApp yet, so it cannot be reacted to.');
      }
      const conversation = await this.deps.conversations.findForSend(conversationId);
      const phone = conversation.contact?.phone;
      if (!phone) {
        throw new ValidationError('This contact has no phone number on file.');
      }
      await this.deps.reactions.sendReaction({
        to: phone,
        targetWhatsappMessageId: message.messageId,
        emoji,
      });
    }

    if (emoji.length === 0) {
      await this.deps.messages.clearReaction({
        messageId,
        actorType: 'agent',
        actorId: this.userId,
      });
      return;
    }

    await this.deps.messages.setReaction({
      messageId,
      conversationId,
      actorType: 'agent',
      actorId: this.userId,
      emoji,
    });
  }
}
