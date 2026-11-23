/**
 * Contacts endpoints.
 *
 *   GET    /api/contacts                 list (search, tag filter, sort, paging)
 *   POST   /api/contacts                 create
 *   GET    /api/contacts/stats           header metrics
 *   GET    /api/contacts/[id]            detail
 *   PATCH  /api/contacts/[id]            update
 *   DELETE /api/contacts/[id]            delete
 *   POST   /api/contacts/bulk            bulk delete / add tags / remove tags
 *   POST   /api/contacts/import          import reviewed rows
 *   POST   /api/contacts/ai-extract      AI: read a document/image → candidate contacts
 *   GET    /api/tags, POST /api/tags     tag list / create
 *   PATCH  /api/tags/[id], DELETE        rename / recolour / delete a tag
 */

import { z } from 'zod';

import { extractContactsFromFile } from '@/lib/ai/contact-extract';
import { hasGeminiKey } from '@/lib/ai/llm';
import { ConflictError, createHandler, getLogger, result, ValidationError, type TenantDb } from '../kernel';
import { ContactService } from '../services/contact.service';
import { TagService } from '../services/tag.service';
import { idSchema } from '../validators/common.validator';
import {
  createContactBodySchema,
  createTagBodySchema,
  importContactsBodySchema,
  listContactsQuerySchema,
  updateContactBodySchema,
  updateTagBodySchema,
} from '../validators/contact.validator';
import { paged } from './controller-kit';

const log = getLogger('contacts.controller');
const loose = z.any();
const paramsSchema = z.object({ id: idSchema });

const bulkBodySchema = z.object({
  action: z.enum(['delete', 'addTags', 'removeTags']),
  ids: z.array(idSchema).min(1).max(1000),
  tagIds: z.array(idSchema).max(50).default([]),
});

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Deleting a contact must not fail because it once received a campaign:
 * campaign recipient rows reference the contact without a cascade. The
 * campaign's aggregate counters live on the campaign row, so they survive.
 */
async function deleteContacts(db: TenantDb, ids: string[]): Promise<number> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.broadcastRecipient.deleteMany({ where: { contactId: { in: ids } } });
      const res = await tx.contact.deleteMany({ where: { id: { in: ids } } });
      return res.count;
    });
  } catch (error) {
    log.warn('contact delete blocked', { err: error });
    throw new ConflictError(
      'Some contacts are linked to records that block deletion (for example deals or appointments). Remove those first.',
    );
  }
}

export const contactController = {
  list: createHandler({
    operation: 'contacts.list',
    auth: 'tenant',
    query: listContactsQuerySchema,
    response: loose,
    handle: async ({ ctx, db, query }) => paged(await ContactService.create(db, ctx.userId).list(query), 'Contacts retrieved.'),
  }),

  create: createHandler({
    operation: 'contacts.create',
    auth: 'tenant',
    body: createContactBodySchema,
    response: loose,
    status: 201,
    handle: async ({ ctx, db, body }) => ContactService.create(db, ctx.userId).create(body),
  }),

  stats: createHandler({
    operation: 'contacts.stats',
    auth: 'tenant',
    response: loose,
    async handle({ db }) {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      const [total, newThisWeek, untagged, withEmail] = await Promise.all([
        db.contact.count(),
        db.contact.count({ where: { createdAt: { gte: weekAgo } } }),
        db.contact.count({ where: { tags: { none: {} } } }),
        db.contact.count({ where: { email: { not: null }, NOT: { email: '' } } }),
      ]);
      return { total, newThisWeek, untagged, withEmail, aiAvailable: hasGeminiKey() };
    },
  }),

  get: createHandler({
    operation: 'contacts.get',
    auth: 'tenant',
    params: paramsSchema,
    response: loose,
    handle: async ({ ctx, db, params }) => ContactService.create(db, ctx.userId).getDetail(params.id),
  }),

  update: createHandler({
    operation: 'contacts.update',
    auth: 'tenant',
    params: paramsSchema,
    body: updateContactBodySchema,
    response: loose,
    handle: async ({ ctx, db, params, body }) => ContactService.create(db, ctx.userId).update(params.id, body),
  }),

  remove: createHandler({
    operation: 'contacts.delete',
    auth: 'tenant',
    params: paramsSchema,
    response: loose,
    async handle({ db, params }) {
      const count = await deleteContacts(db, [params.id]);
      if (!count) throw new ValidationError('Contact not found.');
      return result({ deleted: true }, { message: 'Contact deleted.' });
    },
  }),

  bulk: createHandler({
    operation: 'contacts.bulk',
    auth: 'tenant',
    body: bulkBodySchema,
    response: loose,
    async handle({ db, body }) {
      const ids = [...new Set(body.ids)];
      if (body.action === 'delete') {
        return { affected: await deleteContacts(db, ids) };
      }
      if (!body.tagIds.length) throw new ValidationError('Choose at least one tag.');
      const ownedTags = await db.tag.count({ where: { id: { in: body.tagIds } } });
      if (ownedTags !== new Set(body.tagIds).size) throw new ValidationError('One or more tags were not found.');
      const ownedIds = (await db.contact.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((c) => c.id);

      if (body.action === 'removeTags') {
        const res = await db.contactTag.deleteMany({ where: { contactId: { in: ownedIds }, tagId: { in: body.tagIds } } });
        return { affected: res.count };
      }
      const existing = await db.contactTag.findMany({
        where: { contactId: { in: ownedIds }, tagId: { in: body.tagIds } },
        select: { contactId: true, tagId: true },
      });
      const have = new Set(existing.map((r) => `${r.contactId}:${r.tagId}`));
      const data = ownedIds.flatMap((contactId) =>
        body.tagIds.filter((tagId) => !have.has(`${contactId}:${tagId}`)).map((tagId) => ({ contactId, tagId })),
      );
      if (data.length) await db.contactTag.createMany({ data });
      return { affected: data.length };
    },
  }),

  import: createHandler({
    operation: 'contacts.import',
    auth: 'tenant',
    body: importContactsBodySchema,
    response: loose,
    rateLimit: { limit: 10, windowMs: 60_000 },
    handle: async ({ ctx, db, body }) => ContactService.create(db, ctx.userId).import(body),
  }),

  aiExtract: createHandler({
    operation: 'contacts.aiExtract',
    auth: 'tenant',
    response: loose,
    rateLimit: { limit: 8, windowMs: 60_000 },
    async handle({ request }) {
      const form = await request.formData();
      const file = form.get('file');
      const isSheet = file instanceof File && /\.(csv|xlsx|xls|ods|tsv)$/i.test(file.name);
      if (!hasGeminiKey() && !isSheet) {
        throw new ValidationError('AI import is unavailable (GEMINI_API_KEY is not configured). Upload a CSV or Excel file instead.');
      }
      const countryCode = String(form.get('defaultCountryCode') ?? '').replace(/\D/g, '').slice(0, 4) || undefined;
      if (!(file instanceof File)) throw new ValidationError('Choose a file to analyse.');
      if (file.size === 0) throw new ValidationError('The file is empty.');
      if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError('Files must be 20 MB or smaller.');
      try {
        return await extractContactsFromFile({
          buffer: Buffer.from(await file.arrayBuffer()),
          fileName: file.name,
          mimeType: file.type,
          defaultCountryCode: countryCode,
        });
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : 'Could not analyse this file.');
      }
    },
  }),

  listTags: createHandler({
    operation: 'tags.list',
    auth: 'tenant',
    response: loose,
    async handle({ db }) {
      const tags = await db.tag.findMany({
        select: { id: true, name: true, color: true, _count: { select: { contacts: true } } },
        orderBy: { name: 'asc' },
      });
      return tags.map((t) => ({ id: t.id, name: t.name, color: t.color, contactCount: t._count.contacts }));
    },
  }),

  createTag: createHandler({
    operation: 'tags.create',
    auth: 'tenant',
    body: createTagBodySchema,
    response: loose,
    status: 201,
    handle: async ({ ctx, db, body }) => TagService.create(db, ctx.userId).create(body),
  }),

  updateTag: createHandler({
    operation: 'tags.update',
    auth: 'tenant',
    params: paramsSchema,
    body: updateTagBodySchema,
    response: loose,
    handle: async ({ ctx, db, params, body }) => TagService.create(db, ctx.userId).update(params.id, body),
  }),

  deleteTag: createHandler({
    operation: 'tags.delete',
    auth: 'tenant',
    params: paramsSchema,
    response: loose,
    async handle({ ctx, db, params }) {
      await TagService.create(db, ctx.userId).delete(params.id);
      return { deleted: true };
    },
  }),
};
