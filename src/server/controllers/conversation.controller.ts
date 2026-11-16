/**
 * Inbox endpoints.
 *
 * Replaces the browser's direct table access (39 components called
 * `@/lib/supabase/client`) and `api/whatsapp/send/route.ts` /
 * `api/whatsapp/react/route.ts`.
 *
 * What moves server-side here was previously enforced only in the browser, or
 * not at all:
 *
 *  - the conversation list is paginated (it used to load every conversation
 *    and filter in browser memory),
 *  - the 24-hour service window is checked before Meta is called,
 *  - assignment targets are verified to be members of this tenant,
 *  - a reaction is sent to Meta and mirrored, in that order.
 *
 * `send` is deliberately mounted on the conversation rather than on
 * `/api/whatsapp/send`: the recipient is a property of the conversation, and
 * the old route took a `conversation_id` *and* a `phone` in the body, which
 * could disagree.
 */

import { z } from 'zod';

import { ValidationError, createHandler, result } from '../kernel';
import {
  conversationDetailDtoSchema,
  conversationDtoSchema,
  messageDtoSchema,
  unreadSummaryDtoSchema,
} from '../dtos/conversation.dto';
import { ConversationService } from '../services/conversation.service';
import { WhatsappTransport } from '../services/whatsapp-transport';
import {
  conversationParamsSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  messageParamsSchema,
  sendMessageBodySchema,
  setReactionBodySchema,
  updateConversationBodySchema,
} from '../validators/conversation.validator';
import type { TenantDb } from '../kernel';
import { paged } from './controller-kit';

/**
 * Resolves a send-capable service. A tenant that has not connected WhatsApp
 * gets one clear 400 here instead of an opaque failure deep inside a send.
 */
async function sendingService(db: TenantDb, userId: string): Promise<ConversationService> {
  const transport = await WhatsappTransport.forTenant(db);
  if (!transport) {
    throw new ValidationError('Connect your WhatsApp Business account in Settings before sending.');
  }
  return ConversationService.create(db, userId, transport);
}

export const conversationController = {
  list: createHandler({
    operation: 'conversations.list',
    auth: 'tenant',
    query: listConversationsQuerySchema,
    response: z.array(conversationDtoSchema),
    handle: async ({ ctx, db, query }) =>
      paged(await ConversationService.create(db, ctx.userId).list(query), 'Conversations retrieved.'),
  }),

  get: createHandler({
    operation: 'conversations.get',
    auth: 'tenant',
    params: conversationParamsSchema,
    response: conversationDetailDtoSchema,
    handle: async ({ ctx, db, params }) =>
      ConversationService.create(db, ctx.userId).getDetail(params.id),
  }),

  update: createHandler({
    operation: 'conversations.update',
    auth: 'tenant',
    params: conversationParamsSchema,
    body: updateConversationBodySchema,
    response: conversationDetailDtoSchema,
    message: 'Conversation updated.',
    handle: async ({ ctx, db, params, body }) =>
      ConversationService.create(db, ctx.userId).update(params.id, body),
  }),

  /** Idempotent. `changed` lets the client skip a needless realtime broadcast. */
  markRead: createHandler({
    operation: 'conversations.markRead',
    auth: 'tenant',
    params: conversationParamsSchema,
    response: z.object({ changed: z.boolean() }),
    handle: async ({ ctx, db, params }) =>
      ConversationService.create(db, ctx.userId).markRead(params.id),
  }),

  unreadSummary: createHandler({
    operation: 'conversations.unreadSummary',
    auth: 'tenant',
    response: unreadSummaryDtoSchema,
    handle: async ({ ctx, db }) => ConversationService.create(db, ctx.userId).unreadSummary(),
  }),

  listMessages: createHandler({
    operation: 'conversations.messages',
    auth: 'tenant',
    params: conversationParamsSchema,
    query: listMessagesQuerySchema,
    response: z.array(messageDtoSchema),
    handle: async ({ ctx, db, params, query }) =>
      paged(
        await ConversationService.create(db, ctx.userId).listMessages(params.id, query),
        'Messages retrieved.',
      ),
  }),

  send: createHandler({
    operation: 'conversations.send',
    auth: 'tenant',
    params: conversationParamsSchema,
    body: sendMessageBodySchema,
    response: messageDtoSchema,
    status: 201,
    message: 'Message sent.',
    handle: async ({ ctx, db, params, body }) =>
      (await sendingService(db, ctx.userId)).sendMessage(params.id, body),
  }),

  setReaction: createHandler({
    operation: 'conversations.react',
    auth: 'tenant',
    params: messageParamsSchema,
    body: setReactionBodySchema,
    response: z.object({ ok: z.literal(true) }),
    handle: async ({ ctx, db, params, body }) => {
      await (await sendingService(db, ctx.userId)).setReaction(params.id, params.messageId, body);
      return result({ ok: true } as const, { message: 'Reaction updated.' });
    },
  }),
};
