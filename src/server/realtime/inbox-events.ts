/**
 * Inbox realtime broadcaster.
 *
 * Messages and conversations are written from many places — the webhook,
 * the AI healthcare responder, flows, automations, the legacy send route,
 * the simulator — and none of them announced the change, so the inbox only
 * updated on refresh. Rather than sprinkle an emit after every write (and
 * miss the next new writer), a Prisma middleware observes writes to the
 * inbox models and pushes a compact event to the owning tenant's
 * socket.io room.
 *
 * Events (all scoped to the tenant room `tenantId`):
 *   inbox:message       { kind, conversationId, message }   created/updated
 *   inbox:conversation  { kind, conversationId, patch }     created/updated
 *   inbox:reaction      { conversationId, messageId, reactions }
 *   inbox:contact       { contactId }                       tags/notes changed
 *
 * Broadcasting is best-effort and never fails the write: every emit runs
 * after `next()` resolved and swallows its own errors.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { toMessageDto } from '../dtos/conversation.dto';

type GlobalWithIO = typeof globalThis & {
  io?: { to(room: string): { emit(event: string, data: unknown): void } };
};

type Params = Prisma.MiddlewareParams;

const WRITE_ACTIONS = new Set(['create', 'update', 'upsert', 'updateMany', 'delete', 'deleteMany', 'createMany']);
const WATCHED_MODELS = new Set(['Message', 'Conversation', 'MessageReaction', 'ContactNote', 'ContactTag']);
const MAX_FANOUT = 200;

const REGISTERED = Symbol.for('chatnexgen.inboxRealtime');

export function emitToTenant(tenantId: string | null | undefined, event: string, data: unknown): void {
  if (!tenantId) return;
  const io = (globalThis as GlobalWithIO).io;
  if (!io) return;
  try {
    io.to(tenantId).emit(event, data);
  } catch {
    /* realtime is best-effort */
  }
}

/** Bounded conversationId → tenantId cache; a conversation never changes tenant. */
const tenantByConversation = new Map<string, string>();
const tenantByContact = new Map<string, string>();

function remember(map: Map<string, string>, key: string, value: string) {
  if (map.size > 5000) map.clear();
  map.set(key, value);
}

const conversationPatchSelect = {
  id: true,
  tenantId: true,
  contactId: true,
  status: true,
  assignedAgentId: true,
  lastMessageText: true,
  lastMessageAt: true,
  unreadCount: true,
  updatedAt: true,
} satisfies Prisma.ConversationSelect;

const messageInclude = {
  reactions: {
    select: { id: true, actorType: true, actorId: true, emoji: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  replyTo: {
    select: { id: true, senderType: true, contentType: true, contentText: true, templateName: true },
  },
  conversation: { select: { tenantId: true } },
} satisfies Prisma.MessageInclude;

type Client = PrismaClient;

async function tenantForConversation(client: Client, conversationId: string): Promise<string | null> {
  const cached = tenantByConversation.get(conversationId);
  if (cached) return cached;
  const row = await client.conversation.findUnique({ where: { id: conversationId }, select: { tenantId: true } });
  if (row) remember(tenantByConversation, conversationId, row.tenantId);
  return row?.tenantId ?? null;
}

async function tenantForContact(client: Client, contactId: string): Promise<string | null> {
  const cached = tenantByContact.get(contactId);
  if (cached) return cached;
  const row = await client.contact.findUnique({ where: { id: contactId }, select: { tenantId: true } });
  if (row) remember(tenantByContact, contactId, row.tenantId);
  return row?.tenantId ?? null;
}

async function emitMessages(client: Client, ids: string[], kind: 'created' | 'updated') {
  if (ids.length === 0) return;
  const rows = await client.message.findMany({ where: { id: { in: ids.slice(0, MAX_FANOUT) } }, include: messageInclude });
  for (const row of rows) {
    remember(tenantByConversation, row.conversationId, row.conversation.tenantId);
    emitToTenant(row.conversation.tenantId, 'inbox:message', {
      kind,
      conversationId: row.conversationId,
      message: toMessageDto(row),
    });
  }
}

async function emitConversations(client: Client, ids: string[], kind: 'created' | 'updated') {
  if (ids.length === 0) return;
  const rows = await client.conversation.findMany({
    where: { id: { in: ids.slice(0, MAX_FANOUT) } },
    select: conversationPatchSelect,
  });
  for (const row of rows) {
    remember(tenantByConversation, row.id, row.tenantId);
    const { tenantId, ...patch } = row;
    emitToTenant(tenantId, 'inbox:conversation', {
      kind,
      conversationId: row.id,
      patch: {
        ...patch,
        lastMessageAt: patch.lastMessageAt?.toISOString() ?? null,
        updatedAt: patch.updatedAt.toISOString(),
      },
    });
  }
}

async function emitReactions(client: Client, targets: Array<{ messageId: string; conversationId: string }>) {
  const seen = new Set<string>();
  for (const target of targets.slice(0, MAX_FANOUT)) {
    if (seen.has(target.messageId)) continue;
    seen.add(target.messageId);
    const tenantId = await tenantForConversation(client, target.conversationId);
    const reactions = await client.messageReaction.findMany({
      where: { messageId: target.messageId },
      select: { id: true, actorType: true, actorId: true, emoji: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    emitToTenant(tenantId, 'inbox:reaction', {
      conversationId: target.conversationId,
      messageId: target.messageId,
      reactions: reactions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    });
  }
}

async function emitContacts(client: Client, contactIds: string[]) {
  for (const contactId of [...new Set(contactIds)].slice(0, MAX_FANOUT)) {
    const tenantId = await tenantForContact(client, contactId);
    emitToTenant(tenantId, 'inbox:contact', { contactId });
  }
}

/** Ids matched by a bulk write's `where`, captured before the write runs. */
async function captureIds(client: Client, model: string, where: unknown): Promise<string[]> {
  const delegate = (client as unknown as Record<string, { findMany(args: unknown): Promise<Array<{ id: string }>> }>)[
    model.charAt(0).toLowerCase() + model.slice(1)
  ];
  if (!delegate) return [];
  const rows = await delegate.findMany({ where: where ?? {}, select: { id: true }, take: MAX_FANOUT });
  return rows.map((row) => row.id);
}

type Row = Record<string, unknown>;

async function afterWrite(client: Client, params: Params, resultValue: unknown, preIds: string[], preRows: Row[]) {
  const model = params.model as string;
  const action = params.action as string;
  const row = (resultValue && typeof resultValue === 'object' ? resultValue : {}) as Row;

  switch (model) {
    case 'Message': {
      if (action === 'create') await emitMessages(client, [row.id as string], 'created');
      else if (action === 'upsert') await emitMessages(client, [row.id as string], 'updated');
      else if (action === 'update') await emitMessages(client, [row.id as string], 'updated');
      else if (action === 'updateMany') await emitMessages(client, preIds, 'updated');
      return;
    }
    case 'Conversation': {
      if (action === 'create') await emitConversations(client, [row.id as string], 'created');
      else if (action === 'update' || action === 'upsert') await emitConversations(client, [row.id as string], 'updated');
      else if (action === 'updateMany') await emitConversations(client, preIds, 'updated');
      return;
    }
    case 'MessageReaction': {
      const targets: Array<{ messageId: string; conversationId: string }> = [];
      if (action === 'deleteMany') {
        for (const r of preRows) targets.push({ messageId: r.messageId as string, conversationId: r.conversationId as string });
      } else if (row.messageId && row.conversationId) {
        targets.push({ messageId: row.messageId as string, conversationId: row.conversationId as string });
      }
      await emitReactions(client, targets);
      return;
    }
    case 'ContactNote':
    case 'ContactTag': {
      const ids: string[] = [];
      if (action === 'deleteMany' || action === 'createMany') {
        for (const r of preRows) if (r.contactId) ids.push(r.contactId as string);
        const data = (params.args as { data?: unknown })?.data;
        if (Array.isArray(data)) {
          for (const d of data) {
            if ((d as Row)?.contactId) ids.push((d as Row).contactId as string);
          }
        } else if (data && (data as Row).contactId) {
          ids.push((data as Row).contactId as string);
        }
      } else if (row.contactId) {
        ids.push(row.contactId as string);
      }
      await emitContacts(client, ids);
      return;
    }
  }
}

/**
 * Registers the broadcaster on a Prisma client. Idempotent per instance, so
 * hot reloads that reuse the global client do not stack middlewares.
 */
export function registerInboxRealtime(client: PrismaClient): void {
  const flagged = client as unknown as Record<symbol, boolean>;
  if (flagged[REGISTERED]) return;
  flagged[REGISTERED] = true;
  if (typeof (client as { $use?: unknown }).$use !== 'function') return;

  client.$use(async (params, next) => {
    if (!params.model || !WATCHED_MODELS.has(params.model) || !WRITE_ACTIONS.has(params.action)) {
      return next(params);
    }
    // Nothing to tell when no socket server runs in this process (tests,
    // scripts, cron workers) — skip the extra reads entirely.
    if (!(globalThis as GlobalWithIO).io) return next(params);

    let preIds: string[] = [];
    let preRows: Row[] = [];
    try {
      const where = (params.args as { where?: unknown })?.where;
      if (params.action === 'updateMany' && (params.model === 'Message' || params.model === 'Conversation')) {
        preIds = await captureIds(client, params.model, where);
      } else if (params.action === 'deleteMany' && params.model !== 'Message' && params.model !== 'Conversation') {
        const delegate = (client as unknown as Record<string, { findMany(args: unknown): Promise<Row[]> }>)[
          params.model.charAt(0).toLowerCase() + params.model.slice(1)
        ];
        preRows = delegate ? await delegate.findMany({ where: where ?? {}, take: MAX_FANOUT }) : [];
      } else if (params.action === 'delete' && params.model === 'MessageReaction') {
        // `delete` returns the removed row, so nothing to capture.
      }
    } catch {
      /* capture is best-effort */
    }

    const resultValue = await next(params);

    void afterWrite(client, params, resultValue, preIds, preRows).catch(() => {
      /* realtime is best-effort */
    });

    return resultValue;
  });
}
