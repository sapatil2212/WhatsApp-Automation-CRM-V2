/**
 * Outbound sending on behalf of the *system* — automations, flows, and
 * scheduled reminders — as opposed to an agent typing in the inbox.
 *
 * ## Why this exists
 *
 * Three near-identical copies of "resolve the contact, decrypt the token,
 * call Meta, insert a message row, touch the conversation" existed:
 * `lib/automations/meta-send.ts`, `lib/flows/meta-send.ts`, and inline code
 * in `api/whatsapp/send/route.ts`. Each drifted from the others:
 *
 *   - none of them recorded `senderId`, so the inbox could not tell an
 *     automation's message from an agent's,
 *   - only the route retried phone-number variants,
 *   - none of them checked the 24-hour service window, so a `wait` step
 *     that resumed two days later sent free text and got Meta error
 *     #131047 — surfaced to nobody, because the engine swallowed it,
 *   - `lib/flows/meta-send.ts` decrypted the access token itself, a second
 *     credential path outside the transport.
 *
 * This service is the single system-send path. It differs from
 * `ConversationService.sendMessage` in exactly two ways, which is why it is
 * separate rather than a flag: the sender is `bot`, and the caller starts
 * from a **contact**, not a conversation that is already open on screen.
 *
 * Everything Meta-shaped is injected, so the engines are unit-testable with
 * no network and no database.
 */

import {
  ConflictError,
  NotFoundError,
  ValidationError,
  getLogger,
  type TenantDb,
} from '../kernel';
import { computeServiceWindow } from '../dtos/conversation.dto';
import { ConversationRepository } from '../repositories/conversation.repository';
import { MessageRepository } from '../repositories/message.repository';
import type { OutboundTransport } from './conversation.service';

const log = getLogger('outbound');

/** Buttons and lists. Separate from `OutboundTransport` because only flows need it. */
export interface InteractiveTransport {
  sendInteractiveButtons(input: {
    to: string;
    bodyText: string;
    headerText?: string;
    footerText?: string;
    buttons: Array<{ id: string; title: string }>;
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }>;
  sendInteractiveList(input: {
    to: string;
    bodyText: string;
    buttonLabel: string;
    headerText?: string;
    footerText?: string;
    sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }>;
}

/** Reactions. Used by the inbox react route and nothing else. */
export interface ReactionTransport {
  sendReaction(input: {
    to: string;
    targetWhatsappMessageId: string;
    emoji: string;
  }): Promise<{ whatsappMessageId: string }>;
}

/** What an engine needs. Deliberately the union of only what it calls. */
export type SystemTransport = OutboundTransport & InteractiveTransport;

/** The conversation a system send will land in, plus the recipient. */
export interface SendTarget {
  conversationId: string;
  contactId: string;
  phone: string;
  status: string;
  lastInboundAt: Date | null;
}

export interface OutboundResult {
  /** Our own `Message.id`. */
  messageId: string;
  /** Meta's `wamid.…`. */
  whatsappMessageId: string;
  conversationId: string;
}

export interface OutboundServiceDeps {
  conversations: ConversationRepository;
  messages: MessageRepository;
  transport: SystemTransport;
}

export class OutboundMessageService {
  constructor(
    private readonly deps: OutboundServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string, transport: SystemTransport): OutboundMessageService {
    return new OutboundMessageService(
      {
        conversations: new ConversationRepository(db),
        messages: new MessageRepository(db),
        transport,
      },
      userId,
    );
  }

  /**
   * Resolves — creating if necessary — the conversation a system message for
   * this contact belongs in, and reads the facts needed to decide whether the
   * send is allowed.
   *
   * One round trip more than strictly necessary, and worth it: the previous
   * engines took `conversationId` from the trigger context and trusted it, so
   * an automation on `new_contact_created` (no conversation yet) failed with
   * "no conversation found for contact" and the whole automation aborted.
   */
  async resolveTarget(input: { contactId: string; conversationId?: string | null }): Promise<SendTarget> {
    const conversationId =
      input.conversationId ??
      (await this.deps.conversations.ensureForContact(input.contactId, this.userId)).id;

    const conversation = await this.deps.conversations.findForSend(conversationId);
    if (conversation.contactId !== input.contactId) {
      // The trigger context named a conversation belonging to a different
      // contact. Refuse rather than message the wrong customer.
      throw new NotFoundError('Conversation');
    }

    const phone = conversation.contact?.phone;
    if (!phone) {
      throw new ValidationError('This contact has no phone number on file.');
    }

    return {
      conversationId: conversation.id,
      contactId: input.contactId,
      phone,
      status: conversation.status,
      lastInboundAt: conversation.messages[0]?.createdAt ?? null,
    };
  }

  /**
   * WhatsApp only accepts free-form content within 24 hours of the last
   * customer message. Templates are exempt. Checking here converts an opaque
   * Meta #131047 into a step failure that names the cause.
   */
  private assertSendable(target: SendTarget, isTemplate: boolean): void {
    if (isTemplate) return;
    const window = computeServiceWindow(target.lastInboundAt);
    if (window.expired) {
      throw new ConflictError(
        'The 24-hour customer service window has closed; only an approved template can be sent.',
        { details: { serviceWindow: window, conversationId: target.conversationId } },
      );
    }
  }

  /**
   * Sends, then persists. The order matters: persisting first would leave a
   * phantom message in the thread whenever Meta rejected the send, which is
   * what the old broadcast path did.
   */
  private async persist(input: {
    target: SendTarget;
    whatsappMessageId: string;
    contentType: string;
    contentText: string | null;
    templateName: string | null;
    preview: string;
  }): Promise<OutboundResult> {
    const message = await this.deps.messages.create({
      conversationId: input.target.conversationId,
      senderType: 'bot',
      // Attributes the send to the automation's owner. Nothing recorded this
      // before, so the inbox showed system messages as authorless.
      senderId: this.userId,
      contentType: input.contentType,
      contentText: input.contentText,
      templateName: input.templateName,
      whatsappMessageId: input.whatsappMessageId,
      status: 'sent',
    });

    await this.deps.conversations.touchLastMessage(
      input.target.conversationId,
      input.preview,
      message.createdAt,
    );

    log.info('system message sent', {
      conversationId: input.target.conversationId,
      contentType: input.contentType,
      // Never the body: customer text is PII.
      contentLength: input.contentText?.length ?? 0,
    });

    return {
      messageId: message.id,
      whatsappMessageId: input.whatsappMessageId,
      conversationId: input.target.conversationId,
    };
  }

  async sendText(target: SendTarget, text: string): Promise<OutboundResult> {
    this.assertSendable(target, false);
    const { whatsappMessageId } = await this.deps.transport.sendText({ to: target.phone, text });
    return this.persist({
      target,
      whatsappMessageId,
      contentType: 'text',
      contentText: text,
      templateName: null,
      preview: text,
    });
  }

  async sendTemplate(
    target: SendTarget,
    input: { templateName: string; language?: string; params: string[] },
  ): Promise<OutboundResult> {
    this.assertSendable(target, true);
    const { whatsappMessageId } = await this.deps.transport.sendTemplate({
      to: target.phone,
      templateName: input.templateName,
      language: input.language,
      params: input.params,
    });
    return this.persist({
      target,
      whatsappMessageId,
      contentType: 'template',
      contentText: null,
      templateName: input.templateName,
      preview: `[template] ${input.templateName}`,
    });
  }

  async sendButtons(
    target: SendTarget,
    input: {
      bodyText: string;
      headerText?: string;
      footerText?: string;
      buttons: Array<{ id: string; title: string }>;
    },
  ): Promise<OutboundResult> {
    this.assertSendable(target, false);
    const { whatsappMessageId } = await this.deps.transport.sendInteractiveButtons({
      to: target.phone,
      bodyText: input.bodyText,
      headerText: input.headerText,
      footerText: input.footerText,
      buttons: input.buttons,
    });
    return this.persist({
      target,
      whatsappMessageId,
      contentType: 'interactive',
      contentText: input.bodyText,
      templateName: null,
      preview: input.bodyText,
    });
  }

  async sendList(
    target: SendTarget,
    input: {
      bodyText: string;
      buttonLabel: string;
      headerText?: string;
      footerText?: string;
      sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    },
  ): Promise<OutboundResult> {
    this.assertSendable(target, false);
    const { whatsappMessageId } = await this.deps.transport.sendInteractiveList({
      to: target.phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      headerText: input.headerText,
      footerText: input.footerText,
      sections: input.sections,
    });
    return this.persist({
      target,
      whatsappMessageId,
      contentType: 'interactive',
      contentText: input.bodyText,
      templateName: null,
      preview: input.bodyText,
    });
  }
}
