/**
 * Drip sequences.
 *
 *   GET    /api/sequences              list with enrolment counts
 *   POST   /api/sequences              create
 *   PATCH  /api/sequences/[id]         rename / pause / resume / edit steps
 *   DELETE /api/sequences/[id]         delete (enrolments go with it)
 *   POST   /api/sequences/[id]/enroll  enrol contactIds and/or everyone with a tag
 *   POST   /api/sequences/cron         ticker (cron secret)
 */

import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import { createHandler, NotFoundError, ValidationError } from '../kernel';
import { enrollContacts, runDrips, stepsSchema, type DripStep } from '../services/drip.service';

const loose = z.any();
const idParams = z.object({ id: z.string().min(1) });

/** Every template step must reference one of the tenant's approved templates. */
async function assertTemplates(db: { messageTemplate: { findMany: (a: unknown) => Promise<Array<{ name: string; status: string }>> } }, steps: DripStep[]) {
  const names = [...new Set(steps.flatMap((s) => (s.kind === 'template' ? [s.templateName] : [])))];
  if (!names.length) return;
  const rows = await db.messageTemplate.findMany({ where: { name: { in: names } }, select: { name: true, status: true } });
  for (const n of names) {
    const row = rows.find((r) => r.name === n);
    if (!row) throw new ValidationError(`Template "${n}" does not exist.`);
    if (row.status.toLowerCase() !== 'approved') throw new ValidationError(`Template "${n}" is not approved by Meta yet (status: ${row.status}).`);
  }
}

export const dripController = {
  list: createHandler({
    operation: 'sequences.list',
    auth: 'tenant',
    response: loose,
    handle: async ({ db }) => {
      const rows = await db.dripSequence.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
      const counts = await db.dripEnrollment.groupBy({ by: ['sequenceId', 'status'], _count: { _all: true } });
      return rows.map((r) => {
        const c = (s: string) => counts.find((x) => x.sequenceId === r.id && x.status === s)?._count._all ?? 0;
        return { id: r.id, name: r.name, status: r.status, stopOnReply: r.stopOnReply, steps: r.steps, createdAt: r.createdAt, active: c('active'), completed: c('completed'), stopped: c('stopped') };
      });
    },
  }),

  create: createHandler({
    operation: 'sequences.create',
    auth: 'tenant',
    body: z.object({ name: z.string().trim().min(1).max(120), stopOnReply: z.boolean().default(true), steps: stepsSchema }),
    response: loose,
    message: 'Sequence created.',
    handle: async ({ db, body }) => {
      await assertTemplates(db as never, body.steps);
      return db.dripSequence.create({ data: { name: body.name, stopOnReply: body.stopOnReply, steps: body.steps as unknown as Prisma.InputJsonValue } as never });
    },
  }),

  update: createHandler({
    operation: 'sequences.update',
    auth: 'tenant',
    params: idParams,
    body: z.object({ name: z.string().trim().min(1).max(120).optional(), status: z.enum(['active', 'paused']).optional(), stopOnReply: z.boolean().optional(), steps: stepsSchema.optional() }),
    response: loose,
    message: 'Sequence saved.',
    handle: async ({ db, params, body }) => {
      if (body.steps) await assertTemplates(db as never, body.steps);
      const { steps, ...rest } = body;
      const res = await db.dripSequence.updateMany({ where: { id: params.id }, data: { ...rest, ...(steps ? { steps: steps as unknown as Prisma.InputJsonValue } : {}) } });
      if (!res.count) throw new NotFoundError('Sequence');
      return { id: params.id };
    },
  }),

  remove: createHandler({
    operation: 'sequences.delete',
    auth: 'tenant',
    params: idParams,
    response: loose,
    message: 'Sequence deleted.',
    handle: async ({ db, params }) => {
      const res = await db.dripSequence.deleteMany({ where: { id: params.id } });
      if (!res.count) throw new NotFoundError('Sequence');
      return { deleted: true };
    },
  }),

  enroll: createHandler({
    operation: 'sequences.enroll',
    auth: 'tenant',
    params: idParams,
    body: z.object({ contactIds: z.array(z.string()).max(2000).default([]), tagId: z.string().optional() }).refine((b) => b.contactIds.length > 0 || b.tagId, { message: 'Choose contacts or a tag.' }),
    response: loose,
    handle: async ({ ctx, db, params, body }) => {
      const ids = new Set(body.contactIds);
      if (body.tagId) {
        const tagged = await db.contactTag.findMany({ where: { tagId: body.tagId }, select: { contactId: true }, take: 2000 });
        tagged.forEach((t: { contactId: string }) => ids.add(t.contactId));
      }
      return enrollContacts(ctx.tenantId, params.id, [...ids]);
    },
  }),

  cron: createHandler({
    operation: 'sequences.cron',
    auth: 'cron',
    response: loose,
    handle: async () => runDrips(),
  }),
};
