/**
 * Team-inbox endpoints (`/api/inbox/*`).
 *
 * Read model + agent tooling for the WhatsApp-Web-style inbox. Sending,
 * status, assignment and read receipts stay on `/api/conversations/*` and
 * `/api/whatsapp/*`; this controller never talks to Meta.
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { NotFoundError, ValidationError, createHandler, createRawHandler, result, type TenantDb } from '../kernel';
import { INBOX_FILTERS, InboxService, type InboxConversation, type QuickReply } from '../services/inbox.service';
import { idSchema } from '../validators/common.validator';
import { paged } from './controller-kit';

const service = (db: TenantDb, tenantId: string, userId: string) => new InboxService(db, tenantId, userId);

const conversationParams = z.object({ id: idSchema });
const contactParams = z.object({ contactId: idSchema });

const listQuery = z.object({
  filter: z.enum(INBOX_FILTERS).default('all'),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const anyRow = <T>() => z.custom<T>((value) => value !== null && typeof value === 'object');

// ── media storage ───────────────────────────────────────────────────

/**
 * Agent attachments are stored on local disk and served from
 * `/api/inbox/media/<uuid>.<ext>`. That URL must be publicly reachable
 * because Meta fetches the file itself; the random name is the capability.
 */
const MEDIA_DIR = path.join(process.cwd(), 'storage', 'inbox-media');
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
};

function kindForMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/') && mime !== 'image/gif') return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  return new URL(request.url).origin;
}

export const inboxController = {
  list: createHandler({
    operation: 'inbox.list',
    auth: 'tenant',
    query: listQuery,
    response: z.array(anyRow<InboxConversation>()),
    handle: async ({ ctx, db, query }) =>
      paged(await service(db, ctx.tenantId, ctx.userId).list(query), 'Conversations retrieved.'),
  }),

  get: createHandler({
    operation: 'inbox.get',
    auth: 'tenant',
    params: conversationParams,
    response: anyRow<InboxConversation>(),
    handle: async ({ ctx, db, params }) => service(db, ctx.tenantId, ctx.userId).getOne(params.id),
  }),

  counts: createHandler({
    operation: 'inbox.counts',
    auth: 'tenant',
    response: z.record(z.string(), z.number()),
    handle: async ({ ctx, db }) => service(db, ctx.tenantId, ctx.userId).counts(),
  }),

  setPrefs: createHandler({
    operation: 'inbox.prefs',
    auth: 'tenant',
    params: conversationParams,
    body: z
      .object({ pinned: z.boolean().optional(), starred: z.boolean().optional() })
      .refine((v) => v.pinned !== undefined || v.starred !== undefined, { message: 'Nothing to update.' }),
    response: z.object({ pinned: z.boolean(), starred: z.boolean() }),
    handle: async ({ ctx, db, params, body }) => service(db, ctx.tenantId, ctx.userId).setPrefs(params.id, body),
  }),

  context: createHandler({
    operation: 'inbox.context',
    auth: 'tenant',
    params: conversationParams,
    response: anyRow<Record<string, unknown>>(),
    handle: async ({ ctx, db, params }) => service(db, ctx.tenantId, ctx.userId).context(params.id),
  }),

  addNote: createHandler({
    operation: 'inbox.notes.add',
    auth: 'tenant',
    params: contactParams,
    body: z.object({ text: z.string().trim().min(1, 'Note text is required.').max(5000) }),
    response: anyRow<Record<string, unknown>>(),
    status: 201,
    message: 'Note added.',
    handle: async ({ ctx, db, params, body }) => service(db, ctx.tenantId, ctx.userId).addNote(params.contactId, body.text),
  }),

  deleteNote: createHandler({
    operation: 'inbox.notes.delete',
    auth: 'tenant',
    params: contactParams,
    query: z.object({ noteId: idSchema }),
    response: z.object({ deleted: z.literal(true) }),
    handle: async ({ ctx, db, params, query }) => {
      await service(db, ctx.tenantId, ctx.userId).deleteNote(params.contactId, query.noteId);
      return result({ deleted: true } as const, { message: 'Note deleted.' });
    },
  }),

  addTag: createHandler({
    operation: 'inbox.tags.add',
    auth: 'tenant',
    params: contactParams,
    body: z.object({
      tagId: idSchema.optional(),
      name: z.string().trim().max(50).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    }),
    response: z.object({ id: z.string(), name: z.string(), color: z.string() }),
    handle: async ({ ctx, db, params, body }) => service(db, ctx.tenantId, ctx.userId).addTag(params.contactId, body),
  }),

  removeTag: createHandler({
    operation: 'inbox.tags.remove',
    auth: 'tenant',
    params: contactParams,
    query: z.object({ tagId: idSchema }),
    response: z.object({ deleted: z.literal(true) }),
    handle: async ({ ctx, db, params, query }) => {
      await service(db, ctx.tenantId, ctx.userId).removeTag(params.contactId, query.tagId);
      return result({ deleted: true } as const, { message: 'Label removed.' });
    },
  }),

  agents: createHandler({
    operation: 'inbox.agents',
    auth: 'tenant',
    response: z.array(anyRow<Record<string, unknown>>()),
    handle: async ({ ctx, db }) => service(db, ctx.tenantId, ctx.userId).agents(),
  }),

  listQuickReplies: createHandler({
    operation: 'inbox.quickReplies.list',
    auth: 'tenant',
    response: z.array(anyRow<QuickReply>()),
    handle: async ({ ctx, db }) => service(db, ctx.tenantId, ctx.userId).quickReplies(),
  }),

  addQuickReply: createHandler({
    operation: 'inbox.quickReplies.add',
    auth: 'tenant',
    body: z.object({
      shortcut: z.string().trim().min(1).max(33),
      text: z.string().trim().min(1, 'Reply text is required.').max(4096),
    }),
    response: anyRow<QuickReply>(),
    status: 201,
    message: 'Quick reply saved.',
    handle: async ({ ctx, db, body }) => service(db, ctx.tenantId, ctx.userId).addQuickReply(body),
  }),

  deleteQuickReply: createHandler({
    operation: 'inbox.quickReplies.delete',
    auth: 'tenant',
    query: z.object({ id: z.string().uuid() }),
    response: z.object({ deleted: z.literal(true) }),
    handle: async ({ ctx, db, query }) => {
      await service(db, ctx.tenantId, ctx.userId).deleteQuickReply(query.id);
      return result({ deleted: true } as const, { message: 'Quick reply deleted.' });
    },
  }),

  uploadMedia: createRawHandler({
    operation: 'inbox.media.upload',
    auth: 'tenant',
    handle: async ({ request }) => {
      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!file || typeof file === 'string') throw new ValidationError('Attach a file to upload.');
      if (file.size > MAX_MEDIA_BYTES) throw new ValidationError('Files are limited to 16 MB.');
      const original = (file as File).name || 'file';
      const ext = (original.split('.').pop() || '').toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) throw new ValidationError('This file type is not supported by WhatsApp.');
      const name = `${randomUUID()}.${ext}`;
      await mkdir(MEDIA_DIR, { recursive: true });
      await writeFile(path.join(MEDIA_DIR, name), Buffer.from(await file.arrayBuffer()));
      return NextResponse.json(
        {
          success: true,
          message: 'Uploaded.',
          data: {
            url: `${publicOrigin(request)}/api/inbox/media/${name}`,
            kind: kindForMime(mime),
            mime,
            filename: original.slice(0, 200),
            size: file.size,
          },
          error: null,
        },
        { status: 201 },
      );
    },
  }),

  serveMedia: createRawHandler({
    operation: 'inbox.media.serve',
    auth: 'public',
    handle: async ({ request }) => {
      const name = decodeURIComponent(new URL(request.url).pathname.split('/').pop() || '');
      if (!/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(name)) throw new NotFoundError('File');
      const full = path.join(MEDIA_DIR, name);
      const info = await stat(full).catch(() => null);
      if (!info?.isFile()) throw new NotFoundError('File');
      const ext = name.split('.').pop()!;
      const body = await readFile(full);
      return new NextResponse(new Uint8Array(body), {
        status: 200,
        headers: {
          'content-type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
          'content-length': String(info.size),
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
        },
      });
    },
  }),
};
