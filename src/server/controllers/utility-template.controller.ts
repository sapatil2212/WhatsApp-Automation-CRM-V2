/**
 * Appointment utility templates (per tenant).
 *
 *   GET   /api/whatsapp/utility-templates               list (provisions missing ones)
 *   PATCH /api/whatsapp/utility-templates/[id]          edit | enable/disable | reset to library
 *   POST  /api/whatsapp/utility-templates/[id]/submit   submit to Meta (tenant WABA)
 *   DELETE /api/whatsapp/utility-templates/[id]         delete (Meta + local)
 *   POST  /api/whatsapp/utility-templates/bulk          bulk submit / delete
 *   POST  /api/whatsapp/utility-templates/sync          pull status from Meta
 *   PUT   /api/whatsapp/utility-templates/reminders     reminder intervals
 *   GET   /api/whatsapp/utility-templates/logs          recent delivery log
 */

import { z } from 'zod';

import { createHandler } from '../kernel';
import {
  bulkUtilityTemplates,
  deleteUtilityTemplate,
  listUtilityTemplates,
  reminderSettingsSchema,
  resetToLibrary,
  saveReminderSettings,
  setTemplateEnabled,
  submitUtilityTemplate,
  syncUtilityTemplates,
  updateTemplateSchema,
  updateUtilityTemplate,
} from '../services/utility-template.service';

const idParams = z.object({ id: z.string().uuid() });
const loose = z.any();
const patchBody = z.discriminatedUnion('action', [
  updateTemplateSchema.extend({ action: z.literal('update') }),
  z.object({ action: z.literal('enable'), enabled: z.boolean() }),
  z.object({ action: z.literal('reset') }),
]);

export const utilityTemplateController = {
  list: createHandler({
    operation: 'whatsapp.utilityTemplates.list',
    auth: 'tenant',
    response: loose,
    handle: async ({ ctx, db }) => listUtilityTemplates(db, { tenantId: ctx.tenantId, userId: ctx.userId }),
  }),

  patch: createHandler({
    operation: 'whatsapp.utilityTemplates.patch',
    auth: 'tenant',
    params: idParams,
    body: patchBody,
    response: loose,
    async handle({ ctx, db, params, body }) {
      const c = { tenantId: ctx.tenantId, userId: ctx.userId };
      if (body.action === 'enable') return setTemplateEnabled(db, params.id, body.enabled);
      if (body.action === 'reset') return resetToLibrary(db, c, params.id);
      const { action: _action, ...rest } = body;
      void _action;
      return updateUtilityTemplate(db, c, params.id, rest);
    },
  }),

  remove: createHandler({
    operation: 'whatsapp.utilityTemplates.delete',
    auth: 'tenant',
    params: idParams,
    response: loose,
    message: 'Template deleted.',
    async handle({ db, params }) {
      await deleteUtilityTemplate(db, params.id);
      return { deleted: true };
    },
  }),

  bulk: createHandler({
    operation: 'whatsapp.utilityTemplates.bulk',
    auth: 'tenant',
    body: z.object({ action: z.enum(['submit', 'delete']), ids: z.array(z.string().uuid()).min(1).max(50) }),
    response: loose,
    rateLimit: { limit: 10, windowMs: 60_000 },
    handle: async ({ ctx, db, body }) => bulkUtilityTemplates(db, { tenantId: ctx.tenantId, userId: ctx.userId }, body.action, body.ids),
  }),

  submit: createHandler({
    operation: 'whatsapp.utilityTemplates.submit',
    auth: 'tenant',
    params: idParams,
    response: loose,
    message: 'Submitted to Meta for review.',
    rateLimit: { limit: 20, windowMs: 60_000 },
    handle: async ({ ctx, db, params }) => submitUtilityTemplate(db, { tenantId: ctx.tenantId, userId: ctx.userId }, params.id),
  }),

  sync: createHandler({
    operation: 'whatsapp.utilityTemplates.sync',
    auth: 'tenant',
    response: loose,
    rateLimit: { limit: 10, windowMs: 60_000 },
    handle: async ({ db }) => syncUtilityTemplates(db),
  }),

  reminders: createHandler({
    operation: 'whatsapp.utilityTemplates.reminders',
    auth: 'tenant',
    body: reminderSettingsSchema,
    response: loose,
    message: 'Reminder schedule saved.',
    handle: async ({ ctx, body }) => saveReminderSettings(ctx.tenantId, body),
  }),

  logs: createHandler({
    operation: 'whatsapp.utilityTemplates.logs',
    auth: 'tenant',
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
    response: loose,
    async handle({ db, query }) {
      const rows = await db.appointmentNotificationLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        select: {
          id: true, eventType: true, eventKey: true, channel: true, templateName: true, templateVersion: true, status: true,
          errorMessage: true, attempts: true, sentAt: true, createdAt: true, phoneNumber: true,
          appointment: { select: { id: true, patientName: true, appointmentDate: true, appointmentTime: true } },
        },
      });
      return rows.map((r) => ({
        ...r,
        appointment: r.appointment ? { ...r.appointment, appointmentDate: r.appointment.appointmentDate.toISOString().slice(0, 10) } : null,
      }));
    },
  }),
};
