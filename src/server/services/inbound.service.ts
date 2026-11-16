/**
 * Inbound message handling — the webhook's business logic.
 *
 * The webhook is the one place a request arrives with no session, so it is
 * also the one place a tenant must be *derived* rather than authenticated.
 * That derivation (`phoneNumberId` → `WhatsappConfig` → tenant) is the only
 * thing here that uses `systemDb`; everything downstream runs through a
 * scoped client.
 *
 * Corrections over the previous inline implementation:
 *
 *  1. **Idempotency.** Meta retries a delivery until it gets a 2xx, and the
 *     old handler had no duplicate check at the message level — only the flow
 *     engine tried, using a PostgREST operator that did not exist. A retry
 *     therefore re-inserted the message, re-incremented `unreadCount`, and
 *     re-fired every automation. Now a message whose `wamid` is already
 *     stored is acknowledged and dropped.
 *
 *  2. **Contact resolution was O(tenant).** `findOrCreateContact` loaded
 *     *every* contact in the tenant and matched in JavaScript on every
 *     inbound message. Now it is an indexed lookup on the normalised phone,
 *     with a bounded fallback for historically-formatted numbers.
 *
 *  3. **Delivery receipts never reached campaigns.** The old handler looked
 *     up `BroadcastRecipient` by `id: status.id` — comparing a Meta `wamid`
 *     to our primary key — then fell back to a `LIKE` over `errorMessage`.
 *     Both always missed, so campaign analytics stayed at "sent" forever.
 *     `BroadcastRecipient.whatsappMessageId` is now recorded at send time and
 *     matched here.
 *
 *  4. **The unread badge drifted.** It was written as
 *     `unreadCount: (conversation.unreadCount || 0) + 1` from a value read
 *     earlier in the request, so two messages arriving together both wrote
 *     the same number. Now an atomic increment.
 */

import { getLogger, type TenantDb } from '../kernel';
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';
import { BroadcastService } from './broadcast.service';
import { ContactRepository } from '../repositories/contact.repository';
import { ConversationRepository } from '../repositories/conversation.repository';
import { MessageRepository } from '../repositories/message.repository';

const log = getLogger('inbound');

/** A single inbound message, already normalised out of Meta's envelope. */
export interface InboundMessage {
  /** Meta's `wamid.…`. */
  whatsappMessageId: string;
  /** Sender's phone as Meta reports it. */
  from: string;
  /** WhatsApp profile name, when Meta supplies one. */
  profileName: string | null;
  /** Seconds since epoch, as Meta sends it. */
  timestamp: number;
  contentType: string;
  contentText: string | null;
  mediaUrl: string | null;
  /** Set when the customer tapped a button or list row. */
  interactiveReplyId: string | null;
  /** Meta id of the message being replied to, if any. */
  contextWhatsappMessageId: string | null;
}

export interface InboundReaction {
  /** Meta id of the message being reacted to. */
  targetWhatsappMessageId: string;
  /** Empty string removes the reaction. */
  emoji: string;
  from: string;
}

export interface StoredInbound {
  contactId: string;
  conversationId: string;
  messageId: string;
  /** True when this contact had never messaged before. */
  isFirstInboundMessage: boolean;
  /** True when the contact row was created by this message. */
  contactWasCreated: boolean;
  text: string;
}

/**
 * The campaign feedback the webhook produces. Narrowed to two methods so the
 * inbound path does not have to construct a full `BroadcastService` — which
 * would drag in the template service and the Meta transport it needs only for
 * *sending*.
 */
export type CampaignFeedback = Pick<
  BroadcastService,
  'applyDeliveryStatusByWhatsappMessageId' | 'flagReplyForContact'
>;

export interface InboundServiceDeps {
  contacts: ContactRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  campaigns: CampaignFeedback;
}

export class InboundService {
  constructor(
    private readonly deps: InboundServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string, campaigns: CampaignFeedback): InboundService {
    return new InboundService(
      {
        contacts: new ContactRepository(db),
        conversations: new ConversationRepository(db),
        messages: new MessageRepository(db),
        campaigns,
      },
      userId,
    );
  }

  /**
   * Whether this Meta message id has already been stored.
   *
   * Checked before anything else, so a retry is a single indexed read. This
   * one guard protects the message table, the unread badge, the AI handlers,
   * the flow runner and every automation at once — the previous per-engine
   * attempt protected none of them.
   */
  async isDuplicate(whatsappMessageId: string): Promise<boolean> {
    return (await this.deps.messages.findByWhatsappId(whatsappMessageId)) !== null;
  }

  /**
   * Resolves the contact, creating one on first contact.
   *
   * Two-step by necessity: `@@unique([tenantId, phone])` makes the normalised
   * lookup exact and indexed, but numbers stored before normalisation may
   * differ in formatting, so a bounded second pass compares by trailing
   * digits. That pass reads at most 200 rows instead of the whole table.
   */
  private async resolveContact(input: {
    phone: string;
    profileName: string | null;
  }): Promise<{ id: string; created: boolean }> {
    const phone = normalizePhone(input.phone);

    const exact = await this.deps.contacts.findByPhone(phone);
    if (exact) {
      await this.renameIfNeeded(exact.id, input.profileName);
      return { id: exact.id, created: false };
    }

    const legacy = await this.deps.contacts.findByPhoneSuffix(phone);
    const match = legacy.find((candidate) => phonesMatch(candidate.phone, phone));
    if (match) {
      await this.renameIfNeeded(match.id, input.profileName);
      return { id: match.id, created: false };
    }

    const created = await this.deps.contacts.create({
      phone,
      name: input.profileName || phone,
      email: null,
      company: null,
      avatarUrl: null,
      userId: this.userId,
    });
    return { id: created.id, created: true };
  }

  /**
   * Adopts the WhatsApp profile name only while the contact has none or is
   * still named after their own number. Overwriting a name an agent typed
   * with whatever the customer set on their phone loses deliberate edits.
   */
  private async renameIfNeeded(contactId: string, profileName: string | null): Promise<void> {
    if (!profileName) return;
    const contact = await this.deps.contacts.findDetail(contactId).catch(() => null);
    if (!contact) return;
    const current = contact.name ?? '';
    if (current && current !== contact.phone && current !== normalizePhone(contact.phone)) return;
    if (current === profileName) return;
    await this.deps.contacts.update(contactId, { name: profileName });
  }

  /** Stores an inbound message and everything derived from it. */
  async store(message: InboundMessage): Promise<StoredInbound> {
    const contact = await this.resolveContact({
      phone: message.from,
      profileName: message.profileName,
    });
    const conversation = await this.deps.conversations.ensureForContact(contact.id, this.userId);

    const priorInbound = await this.deps.messages.countInboundSince(conversation.id, new Date(0));

    const replyTo = message.contextWhatsappMessageId
      ? await this.deps.messages.findByWhatsappId(message.contextWhatsappMessageId)
      : null;

    const stored = await this.deps.messages.create({
      conversationId: conversation.id,
      senderType: 'customer',
      contentType: message.contentType,
      contentText: message.contentText,
      mediaUrl: message.mediaUrl,
      whatsappMessageId: message.whatsappMessageId,
      status: 'delivered',
      interactiveReplyId: message.interactiveReplyId,
      // Only quote a parent in the same conversation; a `context.id` pointing
      // elsewhere would render a quote from another thread.
      replyToMessageId: replyTo?.conversationId === conversation.id ? replyTo.id : null,
    });

    await this.deps.conversations.recordInbound(
      conversation.id,
      message.contentText || `[${message.contentType}]`,
      new Date(message.timestamp * 1000),
    );

    // A reply is the strongest campaign signal there is, and it was never
    // recorded: the old lookup matched a Meta id against our primary key.
    await this.deps.campaigns
      .flagReplyForContact(contact.id)
      .catch((error: unknown) => log.warn('campaign reply not flagged', { err: error }));

    return {
      contactId: contact.id,
      conversationId: conversation.id,
      messageId: stored.id,
      isFirstInboundMessage: priorInbound === 0,
      contactWasCreated: contact.created,
      text: message.contentText ?? '',
    };
  }

  /**
   * Mirrors a customer's reaction. Silently ignored when the target message
   * is not one of ours — Meta will report reactions to messages sent before
   * this account was connected.
   */
  async applyReaction(reaction: InboundReaction): Promise<void> {
    const target = await this.deps.messages.findByWhatsappId(reaction.targetWhatsappMessageId);
    if (!target) {
      log.warn('reaction target not found', { });
      return;
    }

    const contact = await this.deps.contacts.findByPhone(normalizePhone(reaction.from));
    const actorId = contact?.id ?? null;

    if (reaction.emoji === '') {
      await this.deps.messages.clearReaction({
        messageId: target.id,
        actorType: 'customer',
        actorId,
      });
      return;
    }

    await this.deps.messages.setReaction({
      messageId: target.id,
      conversationId: target.conversationId,
      actorType: 'customer',
      actorId,
      emoji: reaction.emoji,
    });
  }

  /**
   * Applies a delivery receipt to both the message and, when the id belongs
   * to a campaign, the recipient ladder.
   */
  async applyStatus(input: {
    whatsappMessageId: string;
    status: string;
    at: Date;
  }): Promise<{ messageUpdated: boolean; recipientUpdated: boolean }> {
    const messageUpdated = await this.deps.messages.updateStatusByWhatsappId(
      input.whatsappMessageId,
      input.status,
    );

    const recipientUpdated =
      input.status === 'delivered' || input.status === 'read'
        ? await this.deps.campaigns.applyDeliveryStatusByWhatsappMessageId({
            whatsappMessageId: input.whatsappMessageId,
            incomingStatus: input.status,
            at: input.at,
          })
        : false;

    return { messageUpdated, recipientUpdated };
  }
}
