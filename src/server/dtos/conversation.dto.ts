/**
 * Inbox wire contracts.
 *
 * The single most consequential change here is that `contact` is a real,
 * always-populated field. The shim silently discarded the `select()`
 * relation string and never passed `include` to Prisma, so every
 * conversation arrived with `contact === undefined`. That one gap made the
 * conversation list render "Unknown" for every row, prevented the message
 * thread from ever opening (`if (!conversation || !contact) return
 * <empty>`), and made `/api/whatsapp/send` reject every request with
 * "Contact phone number not found".
 */

import { z } from 'zod';

import { isoDateSchema, toIso, toIsoOrNull } from './common.dto';
import { toContactDto, type ContactDto } from './contact.dto';

// ── enums, mirrored from the schema's documented string values ───────

export const CONVERSATION_STATUSES = ['open', 'pending', 'closed'] as const;
export const conversationStatusSchema = z.enum(CONVERSATION_STATUSES);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const SENDER_TYPES = ['customer', 'agent', 'bot'] as const;
export const senderTypeSchema = z.enum(SENDER_TYPES);
export type SenderType = z.infer<typeof senderTypeSchema>;

export const CONTENT_TYPES = [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
  'sticker',
] as const;
export const contentTypeSchema = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof contentTypeSchema>;

export const MESSAGE_STATUSES = ['sending', 'sent', 'delivered', 'read', 'failed'] as const;
export const messageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const REACTION_ACTORS = ['customer', 'agent'] as const;
export const reactionActorSchema = z.enum(REACTION_ACTORS);

/**
 * Legacy rows may hold a value outside the current enum. Degrading is
 * preferable to failing the whole response over one historical row —
 * a hard parse would take the entire inbox down.
 */
function narrowEnum<TValues extends [string, ...string[]]>(
  schema: z.ZodEnum<TValues>,
  value: string,
  fallback: TValues[number],
): TValues[number] {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

// ── message ─────────────────────────────────────────────────────────

export const messageDtoSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderType: senderTypeSchema,
  senderId: z.string().nullable(),
  contentType: contentTypeSchema,
  contentText: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  templateName: z.string().nullable(),
  /** Meta's `wamid.…`. Null until the send is accepted upstream. */
  whatsappMessageId: z.string().nullable(),
  status: messageStatusSchema,
  /** Set only for `interactive`: the button/list row the customer tapped. */
  interactiveReplyId: z.string().nullable(),
  /** Quoted message id, when this message is a reply. */
  replyToMessageId: z.string().nullable(),
  /**
   * Denormalised preview of the quoted message so the bubble can render the
   * quote without a second fetch or a client-side lookup that fails whenever
   * the parent falls outside the loaded page.
   */
  replyTo: z
    .object({
      id: z.string(),
      senderType: senderTypeSchema,
      contentType: contentTypeSchema,
      preview: z.string(),
    })
    .nullable(),
  createdAt: isoDateSchema,
  reactions: z.array(
    z.object({
      id: z.string(),
      actorType: reactionActorSchema,
      actorId: z.string().nullable(),
      emoji: z.string(),
      createdAt: isoDateSchema,
    }),
  ),
});
export type MessageDto = z.infer<typeof messageDtoSchema>;

interface MessageReactionRow {
  id: string;
  actorType: string;
  actorId: string | null;
  emoji: string;
  createdAt: Date;
}

interface MessageRow {
  id: string;
  conversationId: string;
  senderType: string;
  senderId: string | null;
  contentType: string;
  contentText: string | null;
  mediaUrl: string | null;
  templateName: string | null;
  messageId: string | null;
  status: string;
  interactiveReplyId: string | null;
  replyToMessageId: string | null;
  createdAt: Date;
  reactions?: MessageReactionRow[];
  replyTo?: {
    id: string;
    senderType: string;
    contentType: string;
    contentText: string | null;
    templateName: string | null;
  } | null;
}

/**
 * One-line excerpt of a quoted message. Media and template messages have no
 * body text, so they get a type label instead of rendering as an empty quote.
 */
const QUOTE_PREVIEW_LENGTH = 120;

export function buildQuotePreview(parent: {
  contentType: string;
  contentText: string | null;
  templateName: string | null;
}): string {
  const text = parent.contentText?.trim();
  if (text) {
    return text.length > QUOTE_PREVIEW_LENGTH ? `${text.slice(0, QUOTE_PREVIEW_LENGTH)}…` : text;
  }
  if (parent.contentType === 'template' && parent.templateName) {
    return `[template] ${parent.templateName}`;
  }
  return `[${parent.contentType}]`;
}

export function toMessageDto(row: MessageRow): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: narrowEnum(senderTypeSchema, row.senderType, 'customer'),
    senderId: row.senderId ?? null,
    contentType: narrowEnum(contentTypeSchema, row.contentType, 'text'),
    contentText: row.contentText ?? null,
    mediaUrl: row.mediaUrl ?? null,
    templateName: row.templateName ?? null,
    // Renamed on the wire: the column is `messageId`, which reads as our
    // own primary key. `whatsappMessageId` says what it actually is.
    whatsappMessageId: row.messageId ?? null,
    status: narrowEnum(messageStatusSchema, row.status, 'sent'),
    interactiveReplyId: row.interactiveReplyId ?? null,
    replyToMessageId: row.replyToMessageId ?? null,
    replyTo: row.replyTo
      ? {
          id: row.replyTo.id,
          senderType: narrowEnum(senderTypeSchema, row.replyTo.senderType, 'customer'),
          contentType: narrowEnum(contentTypeSchema, row.replyTo.contentType, 'text'),
          preview: buildQuotePreview(row.replyTo),
        }
      : null,
    createdAt: toIso(row.createdAt),
    reactions: (row.reactions ?? []).map((reaction) => ({
      id: reaction.id,
      actorType: narrowEnum(reactionActorSchema, reaction.actorType, 'agent'),
      actorId: reaction.actorId ?? null,
      emoji: reaction.emoji,
      createdAt: toIso(reaction.createdAt),
    })),
  };
}

// ── conversation ────────────────────────────────────────────────────

export const conversationDtoSchema = z.object({
  id: z.string(),
  status: conversationStatusSchema,
  assignedAgentId: z.string().nullable(),
  lastMessageText: z.string().nullable(),
  lastMessageAt: isoDateSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  /** Always present. This is the join the old data layer dropped. */
  contact: z.object({
    id: z.string(),
    phone: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  /**
   * Hours left in WhatsApp's 24-hour customer-service window, computed
   * server-side from the last inbound message. Previously derived in the
   * browser only, which meant a direct POST bypassed it entirely.
   */
  serviceWindow: z.object({
    expired: z.boolean(),
    hoursRemaining: z.number().nullable(),
    lastCustomerMessageAt: isoDateSchema.nullable(),
  }),
});
export type ConversationDto = z.infer<typeof conversationDtoSchema>;

interface ConversationRow {
  id: string;
  status: string;
  assignedAgentId: string | null;
  lastMessageText: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
  contact: {
    id: string;
    phone: string;
    name: string | null;
    avatarUrl: string | null;
  };
  /** Most recent inbound message, selected as a one-row relation. */
  messages?: Array<{ createdAt: Date }>;
}

export const SERVICE_WINDOW_HOURS = 24;

export function computeServiceWindow(
  lastCustomerMessageAt: Date | null,
  now: Date = new Date(),
): ConversationDto['serviceWindow'] {
  if (!lastCustomerMessageAt) {
    // No inbound message ever: a business-initiated conversation must use
    // an approved template, which is the same constraint as "expired".
    return { expired: true, hoursRemaining: null, lastCustomerMessageAt: null };
  }
  const elapsedHours = (now.getTime() - lastCustomerMessageAt.getTime()) / 3_600_000;
  const remaining = SERVICE_WINDOW_HOURS - elapsedHours;
  return {
    expired: remaining <= 0,
    hoursRemaining: remaining > 0 ? Math.round(remaining * 10) / 10 : 0,
    lastCustomerMessageAt: toIso(lastCustomerMessageAt),
  };
}

export function toConversationDto(row: ConversationRow, now?: Date): ConversationDto {
  return {
    id: row.id,
    status: narrowEnum(conversationStatusSchema, row.status, 'open'),
    assignedAgentId: row.assignedAgentId ?? null,
    lastMessageText: row.lastMessageText ?? null,
    lastMessageAt: toIsoOrNull(row.lastMessageAt),
    unreadCount: row.unreadCount,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    contact: {
      id: row.contact.id,
      phone: row.contact.phone,
      name: row.contact.name ?? null,
      avatarUrl: row.contact.avatarUrl ?? null,
    },
    serviceWindow: computeServiceWindow(row.messages?.[0]?.createdAt ?? null, now),
  };
}

/** Conversation plus the full contact record, for the detail pane. */
export const conversationDetailDtoSchema = conversationDtoSchema.extend({
  contactDetail: z.custom<ContactDto>(),
});
export type ConversationDetailDto = z.infer<typeof conversationDetailDtoSchema>;

export function toConversationDetailDto(
  row: ConversationRow & { contact: Parameters<typeof toContactDto>[0] },
  now?: Date,
): ConversationDetailDto {
  return {
    ...toConversationDto(row, now),
    contactDetail: toContactDto(row.contact),
  };
}

// ── aggregate ───────────────────────────────────────────────────────

export const unreadSummaryDtoSchema = z.object({
  totalUnread: z.number().int().nonnegative(),
  conversationsWithUnread: z.number().int().nonnegative(),
});
export type UnreadSummaryDto = z.infer<typeof unreadSummaryDtoSchema>;
