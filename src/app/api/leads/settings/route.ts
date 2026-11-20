import { z } from 'zod';

import { createHandler, systemDb } from '@/server/kernel';
import { isEnabled } from '@/server/services/lead-nurture';
import type { Prisma } from '@prisma/client';

const loose = z.object({ enabled: z.boolean() });

/** Sales follow-up on/off (Tenant.settings.leadNurture.enabled; default on). */
export const GET = createHandler({
  operation: 'leads.settings.get',
  auth: 'tenant',
  response: loose,
  handle: async ({ ctx }) => {
    const t = await systemDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
    return { enabled: isEnabled(t?.settings) };
  },
});

export const PUT = createHandler({
  operation: 'leads.settings.update',
  auth: 'tenant',
  body: loose,
  response: loose,
  message: 'Follow-up settings saved.',
  handle: async ({ ctx, body }) => {
    // Tenant is global: update only the caller's own row, by id.
    const t = await systemDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
    const current = t?.settings && typeof t.settings === 'object' ? (t.settings as Record<string, unknown>) : {};
    await systemDb.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...current, leadNurture: { enabled: body.enabled } } as Prisma.InputJsonValue } });
    return { enabled: body.enabled };
  },
});
