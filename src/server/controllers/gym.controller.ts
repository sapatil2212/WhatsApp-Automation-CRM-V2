/**
 * Health & fitness: packages and members.
 *
 *   GET/POST    /api/gym/packages
 *   PATCH/DELETE /api/gym/packages/[id]
 *   GET/POST    /api/gym/members                    list / onboard
 *   GET/PATCH/DELETE /api/gym/members/[id]
 *   POST        /api/gym/members/bulk-delete
 *   POST        /api/gym/members/[id]/memberships   assign / renew a package
 *   PATCH       /api/gym/members/[id]/memberships/[membershipId]
 *   POST        /api/gym/members/[id]/welcome       (re)send the WhatsApp welcome
 *   POST        /api/gym/members/import/extract     AI: document → rows for review
 *   POST        /api/gym/members/import             create the reviewed rows
 */

import { z } from 'zod';

import { hasGeminiKey } from '@/lib/ai/llm';
import { extractMembersFromFile } from '@/lib/ai/member-extract';
import { createHandler, NotFoundError, ValidationError } from '../kernel';
import {
  assignMembership,
  assignSchema,
  bulkIdsSchema,
  createMember,
  createMemberSchema,
  createPackage,
  deleteMembers,
  deletePackage,
  getMember,
  importMembers,
  importSchema,
  listMembers,
  listPackages,
  memberListSchema,
  memberSchema,
  membershipUpdateSchema,
  packageSchema,
  sendWelcome,
  updateMember,
  updateMembership,
  updatePackage,
} from '../services/gym-member.service';

const idParams = z.object({ id: z.string().uuid() });
const membershipParams = z.object({ id: z.string().uuid(), membershipId: z.string().uuid() });
const loose = z.any();
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export const gymController = {
  // packages
  packages: createHandler({ operation: 'gym.packages.list', auth: 'tenant', response: loose, handle: ({ db }) => listPackages(db) }),
  createPackage: createHandler({ operation: 'gym.packages.create', auth: 'tenant', body: packageSchema, response: loose, status: 201, message: 'Package added.', handle: ({ ctx, db, body }) => createPackage(db, ctx, body) }),
  updatePackage: createHandler({ operation: 'gym.packages.update', auth: 'tenant', params: idParams, body: packageSchema, response: loose, message: 'Package saved.', handle: ({ db, params, body }) => updatePackage(db, params.id, body) }),
  deletePackage: createHandler({ operation: 'gym.packages.delete', auth: 'tenant', params: idParams, response: loose, message: 'Package deleted.', handle: ({ db, params }) => deletePackage(db, params.id) }),

  // members
  members: createHandler({ operation: 'gym.members.list', auth: 'tenant', query: memberListSchema, response: loose, handle: ({ db, query }) => listMembers(db, query) }),
  member: createHandler({ operation: 'gym.members.get', auth: 'tenant', params: idParams, response: loose, handle: ({ db, params }) => getMember(db, params.id) }),
  createMember: createHandler({
    operation: 'gym.members.create',
    auth: 'tenant',
    body: createMemberSchema,
    response: loose,
    status: 201,
    handle: ({ ctx, db, body }) => createMember(db, { tenantId: ctx.tenantId, userId: ctx.userId }, body),
  }),
  updateMember: createHandler({ operation: 'gym.members.update', auth: 'tenant', params: idParams, body: memberSchema, response: loose, message: 'Member saved.', handle: ({ db, params, body }) => updateMember(db, params.id, body) }),
  deleteMember: createHandler({
    operation: 'gym.members.delete',
    auth: 'tenant',
    params: idParams,
    response: loose,
    async handle({ db, params }) {
      const res = await deleteMembers(db, [params.id]);
      if (!res.deleted.length) throw new NotFoundError('Member');
      return res;
    },
  }),
  bulkDelete: createHandler({ operation: 'gym.members.bulkDelete', auth: 'tenant', body: bulkIdsSchema, response: loose, handle: ({ db, body }) => deleteMembers(db, body.ids) }),
  assign: createHandler({ operation: 'gym.members.assign', auth: 'tenant', params: idParams, body: assignSchema, response: loose, status: 201, message: 'Package assigned.', handle: ({ ctx, db, params, body }) => assignMembership(db, ctx, params.id, body) }),
  updateMembership: createHandler({ operation: 'gym.memberships.update', auth: 'tenant', params: membershipParams, body: membershipUpdateSchema, response: loose, message: 'Membership saved.', handle: ({ db, params, body }) => updateMembership(db, params.id, params.membershipId, body) }),
  welcome: createHandler({
    operation: 'gym.members.welcome',
    auth: 'tenant',
    params: idParams,
    response: loose,
    rateLimit: { limit: 20, windowMs: 60_000 },
    handle: ({ ctx, db, params }) => sendWelcome(db, ctx.tenantId, params.id, { resend: true }),
  }),

  // import
  extract: createHandler({
    operation: 'gym.members.extract',
    auth: 'tenant',
    response: loose,
    rateLimit: { limit: 6, windowMs: 60_000 },
    async handle({ db, request }) {
      if (!hasGeminiKey()) throw new ValidationError('AI import is unavailable: GEMINI_API_KEY is not configured.');
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) throw new ValidationError('Choose a file to import.');
      if (file.size === 0) throw new ValidationError('The file is empty.');
      if (file.size > MAX_IMPORT_BYTES) throw new ValidationError('Files must be 25 MB or smaller.');
      const { items } = await listPackages(db);
      try {
        return await extractMembersFromFile({
          buffer: Buffer.from(await file.arrayBuffer()),
          fileName: file.name,
          mimeType: file.type,
          packages: items.map((p) => ({ id: p.id, name: p.name, durationDays: p.durationDays })),
        });
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : 'Could not analyse this file.');
      }
    },
  }),
  import: createHandler({
    operation: 'gym.members.import',
    auth: 'tenant',
    body: importSchema,
    response: loose,
    rateLimit: { limit: 5, windowMs: 60_000 },
    handle: ({ ctx, db, body }) => importMembers(db, { tenantId: ctx.tenantId, userId: ctx.userId }, body),
  }),
};
