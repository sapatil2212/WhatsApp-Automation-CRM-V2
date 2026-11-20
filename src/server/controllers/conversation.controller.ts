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

import { ExternalApiError, ValidationError, createHandler, getLogger, result } from '../kernel';
import {
  conversationDetailDtoSchema,
  conversationDtoSchema,
  messageDtoSchema,
  unreadSummaryDtoSchema,
} from '../dtos/conversation.dto';
import { ConversationService, type OutboundTransport, type ReactionSender } from '../services/conversation.service';
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

const log = getLogger('conversation.controller');

type InboxTransport = OutboundTransport & ReactionSender;

/**
 * Local development only: when Meta rejects a send (no real number, expired
 * sandbox token) or WhatsApp is not connected, the message is still recorded
 * with a `sandbox-` id so the inbox can be exercised end to end. This mirrors
 * what the legacy `/api/whatsapp/send` route did. Never active in production.
 */
function withDevSandbox(real: InboxTransport | null): InboxTransport | null {
  if (process.env.NODE_ENV !== 'development') return real;
  const sandboxId = () => ({ whatsappMessageId: `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  const guard = async <T extends { whatsappMessageId: string }>(op: string, call?: () => Promise<T>) => {
    if (!call) {
      log.warn('dev sandbox: WhatsApp not connected, recording send locally', { op });
      return sandboxId();
    }
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof ExternalApiError)) throw error;
      log.warn('dev sandbox: Meta rejected the send, recording it locally', { op, err: error });
      return sandboxId();
    }
  };
  return {
    sendText: (input) => guard('text', real ? () => real.sendText(input) : undefined),
    sendTemplate: (input) => guard('template', real ? () => real.sendTemplate(input) : undefined),
    sendMedia: (input) => guard('media', real ? () => real.sendMedia(input) : undefined),
    sendReaction: (input) => guard('reaction', real ? () => real.sendReaction(input) : undefined),
  };
}

/**
 * Resolves a send-capable service. A tenant that has not connected WhatsApp
 * gets one clear 400 here instead of an opaque failure deep inside a send.
 */
async function sendingService(db: TenantDb, userId: string): Promise<ConversationService> {
  const transport = withDevSandbox(await WhatsappTransport.forTenant(db));
  if (!transport) {
    throw new ValidationError('Connect your WhatsApp Business account in Settings before sending.');
  }
  return ConversationService.create(db, userId, transport);
}

/**
 * An agent replying is the strongest "a human is here" signal: pause any
 * active Flow run for the contact (same as the legacy send route did).
 * Best-effort — the message already reached Meta.
 */
async function pauseFlowsForAgentReply(db: TenantDb, conversationId: string): Promise<void> {
  try {
    const conversation = await db.conversation.findFirst({ where: { id: conversationId }, select: { contactId: true } });
    if (!conversation) return;
    await db.flowRun.updateMany({
      where: { contactId: conversation.contactId, status: 'active' },
      data: { status: 'paused_by_agent', endedAt: new Date(), endReason: 'agent_replied' },
    });
  } catch (error) {
    log.warn('pause-on-agent-send failed', { err: error });
  }
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
    rateLimit: { limit: 60, windowMs: 60_000, key: ({ ctx }) => `inbox-send:${ctx?.userId ?? 'anon'}` },
    handle: async ({ ctx, db, params, body }) => {
      const message = await (await sendingService(db, ctx.userId)).sendMessage(params.id, body);
      await pauseFlowsForAgentReply(db, params.id);
      return message;
    },
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
