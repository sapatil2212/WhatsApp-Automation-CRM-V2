/**
 * Inbox request schemas.
 *
 * Two gaps closed relative to the previous implementation: the
 * conversation list had no server-side pagination at all (it pulled every
 * conversation and filtered in browser memory), and message content was
 * accepted with no length cap despite WhatsApp rejecting bodies over 4096
 * characters — the send failed at Meta after we had already committed.
 */

import { z } from 'zod';

import { paginationQuerySchema } from '../kernel';
import { CONTENT_TYPES, conversationStatusSchema } from '../dtos/conversation.dto';
import { idSchema, optionalHttpUrlSchema, searchSchema } from './common.validator';

/** WhatsApp's hard limit for a text message body. */
export const MAX_MESSAGE_LENGTH = 4096;

export const listConversationsQuerySchema = paginationQuerySchema.extend({
  status: conversationStatusSchema.optional(),
  search: searchSchema,
  /** `unassigned` is a distinct case from "any assignee". */
  assignedTo: z.union([idSchema, z.literal('unassigned')]).optional(),
  unreadOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const listMessagesQuerySchema = paginationQuerySchema.extend({
  /**
   * Messages page backwards from newest, because that is what a chat
   * thread scrolls through. The client reverses for display.
   */
  before: z.coerce.date().optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const updateConversationBodySchema = z
  .object({
    status: conversationStatusSchema.optional(),
    /** `null` unassigns. Omitted leaves the assignee untouched. */
    assignedAgentId: idSchema.nullable().optional(),
  })
  .refine((value) => value.status !== undefined || value.assignedAgentId !== undefined, {
    message: 'Provide a status or an assignee to update.',
  });
export type UpdateConversationBody = z.infer<typeof updateConversationBodySchema>;

/**
 * Outbound message request. `contentType` decides which other fields are
 * required, enforced by the discriminated union rather than by
 * hand-written `if` checks inside the route.
 */
/**
 * Any outbound message may quote an earlier one. Validated as our own message
 * id; the service resolves it to Meta's `context.message_id` and rejects a
 * parent from a different conversation.
 */
// `.nullish()` without a transform: the field stays optional in the parsed
// type, so internal callers (automations, flows) are not forced to pass it.
const replyToMessageId = idSchema.nullish();

export const sendMessageBodySchema = z.discriminatedUnion('contentType', [
  z.object({
    contentType: z.literal('text'),
    text: z
      .string()
      .min(1, 'Message text is required.')
      .max(MAX_MESSAGE_LENGTH, `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`),
    replyToMessageId,
  }),
  z.object({
    contentType: z.literal('template'),
    templateName: z.string().trim().min(1, 'Template name is required.').max(512),
    templateLanguage: z.string().trim().max(20).optional(),
    /** Positional `{{1}}…{{n}}` substitutions. */
    templateParams: z.array(z.string().max(1024)).max(20).default([]),
    replyToMessageId,
  }),
  z.object({
    contentType: z.enum(
      CONTENT_TYPES.filter((type): type is 'image' | 'document' | 'audio' | 'video' =>
        ['image', 'document', 'audio', 'video'].includes(type),
      ) as unknown as ['image', 'document', 'audio', 'video'],
    ),
    mediaUrl: optionalHttpUrlSchema.refine((value): value is string => value !== null, {
      message: 'A media URL is required for media messages.',
    }),
    caption: z.string().max(1024).optional(),
    filename: z.string().max(255).optional(),
    replyToMessageId,
  }),
]);
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

export const conversationParamsSchema = z.object({ id: idSchema });
export type ConversationParams = z.infer<typeof conversationParamsSchema>;

export const messageParamsSchema = z.object({ id: idSchema, messageId: idSchema });
export type MessageParams = z.infer<typeof messageParamsSchema>;

/**
 * Reaction set/clear. An empty emoji clears the actor's reaction, which
 * keeps one endpoint instead of a separate DELETE — the previous code
 * expressed the same intent but its clear path threw, because the shim
 * forced a `tenantId` filter onto a table that has no such column.
 */
export const setReactionBodySchema = z.object({
  emoji: z.string().max(16),
});
export type SetReactionBody = z.infer<typeof setReactionBodySchema>;
