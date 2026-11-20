/**
 * Team-inbox read model and agent preferences.
 *
 * The conversation endpoints (`/api/conversations/*`) own the core rules —
 * sending, the 24-hour window, assignment, read receipts. This service adds
 * what a WhatsApp-Web-style team inbox needs on top of them:
 *
 *  - a list row carrying everything the chat list renders (last message
 *    ticks, contact labels, pin/star state) in one query,
 *  - per-filter counts for the filter chips,
 *  - the contact drawer context (labels, internal notes, deals, appointments),
 *  - per-agent pinned / starred chats and tenant-wide quick replies.
 *
 * Preferences and quick replies live in `Tenant.settings.inbox` (JSON) so the
 * feature needs no schema change. That row is read and written through
 * `systemDb` keyed by the caller's own authenticated tenant id — the Tenant
 * table is `global` in the tenant-scope map and unreachable via `tenantDb`.
 */

import { randomUUID } from 'crypto';

import type { Prisma } from '@prisma/client';

import { NotFoundError, ValidationError, scoped, systemDb, type TenantDb } from '../kernel';
import { computeServiceWindow } from '../dtos/conversation.dto';

// ── types ───────────────────────────────────────────────────────────

export const INBOX_FILTERS = ['all', 'unread', 'mine', 'unassigned', 'open', 'resolved', 'starred'] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export interface InboxTag {
  id: string;
  name: string;
  color: string;
}

export interface InboxConversation {
  id: string;
  status: string;
  assignedAgentId: string | null;
  unreadCount: number;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  contact: {
    id: string;
    phone: string;
    name: string | null;
    avatarUrl: string | null;
    tags: InboxTag[];
  };
  lastMessage: { senderType: string; status: string; contentType: string } | null;
  serviceWindow: ReturnType<typeof computeServiceWindow>;
  pinned: boolean;
  starred: boolean;
}

export interface QuickReply {
  id: string;
  shortcut: string;
  text: string;
  createdBy: string | null;
  createdAt: string;
}

interface InboxSettings {
  prefs?: Record<string, { pinned?: string[]; starred?: string[] }>;
  quickReplies?: QuickReply[];
}

// ── settings helpers ────────────────────────────────────────────────

async function readTenantSettings(tenantId: string): Promise<Record<string, unknown>> {
  // systemDb: Tenant is a global model; scoped by the caller's own tenant id.
  const tenant = await systemDb.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  if (!tenant) throw new NotFoundError('Tenant');
  const settings = tenant.settings;
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
}

async function readInbox(tenantId: string): Promise<InboxSettings> {
  const settings = await readTenantSettings(tenantId);
  const inbox = settings.inbox;
  return inbox && typeof inbox === 'object' && !Array.isArray(inbox) ? (inbox as InboxSettings) : {};
}

async function writeInbox(tenantId: string, mutate: (inbox: InboxSettings) => InboxSettings): Promise<InboxSettings> {
  const settings = await readTenantSettings(tenantId);
  const current = (settings.inbox && typeof settings.inbox === 'object' ? settings.inbox : {}) as InboxSettings;
  const next = mutate(structuredClone(current));
  // systemDb: see readTenantSettings.
  await systemDb.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...settings, inbox: next } as unknown as Prisma.InputJsonValue },
  });
  return next;
}

const MAX_PINNED = 20;

// ── query shape ─────────────────────────────────────────────────────

const listSelect = {
  id: true,
  status: true,
  assignedAgentId: true,
  unreadCount: true,
  lastMessageText: true,
  lastMessageAt: true,
  createdAt: true,
  contact: {
    select: {
      id: true,
      phone: true,
      name: true,
      avatarUrl: true,
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
    },
  },
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { senderType: true, status: true, contentType: true },
  },
} satisfies Prisma.ConversationSelect;

type ListRow = Prisma.ConversationGetPayload<{ select: typeof listSelect }>;

export class InboxService {
  constructor(
    private readonly db: TenantDb,
    private readonly tenantId: string,
    private readonly userId: string,
  ) {}

  private async prefs(): Promise<{ pinned: Set<string>; starred: Set<string> }> {
    const inbox = await readInbox(this.tenantId);
    const mine = inbox.prefs?.[this.userId] ?? {};
    return { pinned: new Set(mine.pinned ?? []), starred: new Set(mine.starred ?? []) };
  }

  private async lastInboundFor(ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: ids }, senderType: 'customer' },
      _max: { createdAt: true },
    });
    const map = new Map<string, Date>();
    for (const row of rows) if (row._max.createdAt) map.set(row.conversationId, row._max.createdAt);
    return map;
  }

  private async shape(rows: ListRow[], prefs: { pinned: Set<string>; starred: Set<string> }): Promise<InboxConversation[]> {
    const inbound = await this.lastInboundFor(rows.map((r) => r.id));
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      assignedAgentId: row.assignedAgentId ?? null,
      unreadCount: row.unreadCount,
      lastMessageText: row.lastMessageText ?? null,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      contact: {
        id: row.contact.id,
        phone: row.contact.phone,
        name: row.contact.name ?? null,
        avatarUrl: row.contact.avatarUrl ?? null,
        tags: row.contact.tags.map((t) => t.tag),
      },
      lastMessage: row.messages[0] ?? null,
      serviceWindow: computeServiceWindow(inbound.get(row.id) ?? null),
      pinned: prefs.pinned.has(row.id),
      starred: prefs.starred.has(row.id),
    }));
  }

  private filterWhere(filter: InboxFilter, starred: Set<string>, search?: string): Prisma.ConversationWhereInput {
    const where: Prisma.ConversationWhereInput = {};
    switch (filter) {
      case 'unread':
        where.unreadCount = { gt: 0 };
        break;
      // "Assigned to me" / "Unassigned" are work queues: resolved chats drop out.
      case 'mine':
        where.assignedAgentId = this.userId;
        where.status = { in: ['open', 'pending'] };
        break;
      case 'unassigned':
        where.assignedAgentId = null;
        where.status = { in: ['open', 'pending'] };
        break;
      case 'open':
        where.status = { in: ['open', 'pending'] };
        break;
      case 'resolved':
        where.status = 'closed';
        break;
      case 'starred':
        where.id = { in: [...starred] };
        break;
    }
    const q = search?.trim();
    if (q) {
      where.OR = [
        { contact: { name: { contains: q } } },
        { contact: { phone: { contains: q } } },
        { lastMessageText: { contains: q } },
      ];
    }
    return where;
  }

  /**
   * One page of the chat list. Pinned chats matching the filter are returned
   * ahead of page 1 (and excluded from the paged query) so they always sit at
   * the top, as in WhatsApp.
   */
  async list(input: { filter: InboxFilter; search?: string; page: number; pageSize: number }) {
    const prefs = await this.prefs();
    const base = this.filterWhere(input.filter, prefs.starred, input.search);
    const pinnedIds = [...prefs.pinned];

    const pagedWhere: Prisma.ConversationWhereInput =
      pinnedIds.length > 0 ? { AND: [base, { id: { notIn: pinnedIds } }] } : base;

    const [pinnedRows, rows, total] = await Promise.all([
      input.page === 1 && pinnedIds.length > 0
        ? this.db.conversation.findMany({
            where: { AND: [base, { id: { in: pinnedIds } }] },
            select: listSelect,
            orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
          })
        : Promise.resolve([] as ListRow[]),
      this.db.conversation.findMany({
        where: pagedWhere,
        select: listSelect,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.db.conversation.count({ where: pagedWhere }),
    ]);

    const items = await this.shape([...pinnedRows, ...rows], prefs);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  async getOne(id: string): Promise<InboxConversation> {
    const prefs = await this.prefs();
    const row = await this.db.conversation.findFirst({ where: { id }, select: listSelect });
    if (!row) throw new NotFoundError('Conversation');
    return (await this.shape([row], prefs))[0];
  }

  async counts(): Promise<Record<InboxFilter, number>> {
    const prefs = await this.prefs();
    const count = (where: Prisma.ConversationWhereInput) => this.db.conversation.count({ where });
    const [all, unread, mine, unassigned, open, resolved, starred] = await Promise.all([
      count({}),
      count({ unreadCount: { gt: 0 } }),
      count({ assignedAgentId: this.userId, status: { in: ['open', 'pending'] } }),
      count({ assignedAgentId: null, status: { in: ['open', 'pending'] } }),
      count({ status: { in: ['open', 'pending'] } }),
      count({ status: 'closed' }),
      prefs.starred.size ? count({ id: { in: [...prefs.starred] } }) : Promise.resolve(0),
    ]);
    return { all, unread, mine, unassigned, open, resolved, starred };
  }

  async setPrefs(conversationId: string, input: { pinned?: boolean; starred?: boolean }) {
    if (!(await this.db.conversation.findFirst({ where: { id: conversationId }, select: { id: true } }))) {
      throw new NotFoundError('Conversation');
    }
    const next = await writeInbox(this.tenantId, (inbox) => {
      const prefs = (inbox.prefs ??= {});
      const mine = (prefs[this.userId] ??= {});
      const toggle = (list: string[] | undefined, on: boolean | undefined) => {
        const set = new Set(list ?? []);
        if (on === true) set.add(conversationId);
        if (on === false) set.delete(conversationId);
        return [...set];
      };
      if (input.pinned !== undefined) {
        const pinned = toggle(mine.pinned, input.pinned);
        if (pinned.length > MAX_PINNED) throw new ValidationError(`You can pin up to ${MAX_PINNED} chats.`);
        mine.pinned = pinned;
      }
      if (input.starred !== undefined) mine.starred = toggle(mine.starred, input.starred);
      return inbox;
    });
    const mine = next.prefs?.[this.userId] ?? {};
    return {
      pinned: (mine.pinned ?? []).includes(conversationId),
      starred: (mine.starred ?? []).includes(conversationId),
    };
  }

  // ── contact drawer ──────────────────────────────────────────────

  async context(conversationId: string) {
    const conversation = await this.db.conversation.findFirst({
      where: { id: conversationId },
      select: {
        id: true,
        status: true,
        assignedAgentId: true,
        createdAt: true,
        bookingStage: true,
        contact: {
          select: {
            id: true,
            phone: true,
            name: true,
            email: true,
            company: true,
            avatarUrl: true,
            createdAt: true,
            tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
          },
        },
      },
    });
    if (!conversation) throw new NotFoundError('Conversation');
    const contactId = conversation.contact.id;

    const [notes, deals, appointments, allTags, messageCount] = await Promise.all([
      this.db.contactNote.findMany({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, noteText: true, createdAt: true, userId: true },
      }),
      this.db.deal.findMany({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          value: true,
          currency: true,
          status: true,
          stage: { select: { id: true, name: true, color: true } },
          pipeline: { select: { id: true, name: true } },
        },
      }),
      this.db.appointment
        .findMany({
          where: { contactId },
          orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'desc' }],
          take: 8,
          select: {
            id: true,
            appointmentDate: true,
            appointmentTime: true,
            status: true,
            reasonForVisit: true,
            doctor: { select: { doctorName: true } },
          },
        })
        .catch(() => []),
      this.db.tag.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, color: true } }),
      this.db.message.count({ where: { conversationId } }),
    ]);

    const authorIds = [...new Set(notes.map((n) => n.userId))];
    const authors = authorIds.length
      ? await this.db.profile.findMany({ where: { userId: { in: authorIds } }, select: { userId: true, fullName: true, email: true } })
      : [];
    const authorName = new Map(authors.map((a) => [a.userId, a.fullName || a.email]));

    return {
      conversation: {
        id: conversation.id,
        status: conversation.status,
        assignedAgentId: conversation.assignedAgentId ?? null,
        createdAt: conversation.createdAt.toISOString(),
        bookingStage: conversation.bookingStage ?? null,
        messageCount,
      },
      contact: {
        ...conversation.contact,
        email: conversation.contact.email ?? null,
        company: conversation.contact.company ?? null,
        createdAt: conversation.contact.createdAt.toISOString(),
        tags: conversation.contact.tags.map((t) => t.tag),
      },
      notes: notes.map((n) => ({
        id: n.id,
        text: n.noteText,
        createdAt: n.createdAt.toISOString(),
        authorId: n.userId,
        authorName: authorName.get(n.userId) ?? null,
      })),
      deals: deals.map((d) => ({ ...d, value: Number(d.value ?? 0) })),
      appointments: appointments.map((a) => ({
        id: a.id,
        date: a.appointmentDate.toISOString().slice(0, 10),
        time: a.appointmentTime,
        status: a.status,
        reason: a.reasonForVisit ?? null,
        doctorName: a.doctor?.doctorName ?? null,
      })),
      availableTags: allTags,
    };
  }

  private async assertContact(contactId: string) {
    if (!(await this.db.contact.findFirst({ where: { id: contactId }, select: { id: true } }))) {
      throw new NotFoundError('Contact');
    }
  }

  async addNote(contactId: string, text: string) {
    await this.assertContact(contactId);
    const note = await this.db.contactNote.create({
      data: scoped({ contactId, userId: this.userId, noteText: text }),
      select: { id: true, noteText: true, createdAt: true, userId: true },
    });
    return { id: note.id, text: note.noteText, createdAt: note.createdAt.toISOString(), authorId: note.userId };
  }

  async deleteNote(contactId: string, noteId: string) {
    const note = await this.db.contactNote.findFirst({ where: { id: noteId, contactId }, select: { id: true } });
    if (!note) throw new NotFoundError('Note');
    await this.db.contactNote.delete({ where: { id: noteId } });
  }

  async addTag(contactId: string, input: { tagId?: string; name?: string; color?: string }) {
    await this.assertContact(contactId);
    let tagId = input.tagId;
    if (!tagId) {
      const name = input.name?.trim();
      if (!name) throw new ValidationError('Provide a tag id or a name.');
      const existing = await this.db.tag.findFirst({ where: { name }, select: { id: true } });
      tagId =
        existing?.id ??
        (
          await this.db.tag.create({
            data: scoped({ name, color: input.color ?? '#25d366', userId: this.userId }),
            select: { id: true },
          })
        ).id;
    } else if (!(await this.db.tag.findFirst({ where: { id: tagId }, select: { id: true } }))) {
      throw new NotFoundError('Tag');
    }
    const already = await this.db.contactTag.findFirst({ where: { contactId, tagId }, select: { id: true } });
    if (!already) await this.db.contactTag.create({ data: { contactId, tagId } });
    const tag = await this.db.tag.findFirst({ where: { id: tagId }, select: { id: true, name: true, color: true } });
    return tag!;
  }

  async removeTag(contactId: string, tagId: string) {
    await this.assertContact(contactId);
    await this.db.contactTag.deleteMany({ where: { contactId, tagId } });
  }

  // ── team & quick replies ────────────────────────────────────────

  async agents() {
    const rows = await this.db.profile.findMany({
      select: { userId: true, fullName: true, email: true, avatarUrl: true, role: true },
      orderBy: { fullName: 'asc' },
    });
    return rows.map((r) => ({
      id: r.userId,
      name: r.fullName || r.email,
      email: r.email,
      avatarUrl: r.avatarUrl ?? null,
      role: r.role ?? null,
      isMe: r.userId === this.userId,
    }));
  }

  async quickReplies(): Promise<QuickReply[]> {
    const inbox = await readInbox(this.tenantId);
    return [...(inbox.quickReplies ?? [])].sort((a, b) => a.shortcut.localeCompare(b.shortcut));
  }

  async addQuickReply(input: { shortcut: string; text: string }): Promise<QuickReply> {
    const shortcut = input.shortcut.trim().replace(/^\//, '').toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(shortcut)) {
      throw new ValidationError('Shortcuts use letters, numbers, - or _ (max 32).');
    }
    const reply: QuickReply = {
      id: randomUUID(),
      shortcut,
      text: input.text.trim(),
      createdBy: this.userId,
      createdAt: new Date().toISOString(),
    };
    await writeInbox(this.tenantId, (inbox) => {
      const list = inbox.quickReplies ?? [];
      if (list.some((q) => q.shortcut === shortcut)) throw new ValidationError(`/${shortcut} already exists.`);
      if (list.length >= 200) throw new ValidationError('Quick reply limit reached (200).');
      inbox.quickReplies = [...list, reply];
      return inbox;
    });
    return reply;
  }

  async deleteQuickReply(id: string) {
    await writeInbox(this.tenantId, (inbox) => {
      inbox.quickReplies = (inbox.quickReplies ?? []).filter((q) => q.id !== id);
      return inbox;
    });
  }
}
