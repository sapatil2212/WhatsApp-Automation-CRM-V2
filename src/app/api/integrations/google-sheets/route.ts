import { z } from 'zod';

import { createHandler, systemDb, ValidationError } from '@/server/kernel';
import { pushToGoogleSheet } from '@/server/services/booking-notify';

/**
 * Google Sheets integration (Apps Script web app).
 *
 *   GET    → current connection
 *   PUT    → save / clear the web-app URL
 *   POST   → { action: "test" | "backfill" } — send a test row, or push the
 *            last 30 days of appointments / bookings / leads
 */

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec\/?$/;

export const GET = createHandler({
  operation: 'integrations.sheets.get',
  auth: 'tenant',
  response: z.any(),
  async handle({ ctx }) {
    const cfg = await systemDb.tenantConfiguration.findUnique({ where: { tenantId: ctx.tenantId }, select: { googleSheetsWebhookUrl: true, updatedAt: true } });
    return { url: cfg?.googleSheetsWebhookUrl ?? null, connected: Boolean(cfg?.googleSheetsWebhookUrl), updatedAt: cfg?.updatedAt ?? null };
  },
});

export const PUT = createHandler({
  operation: 'integrations.sheets.save',
  auth: 'tenant',
  body: z.object({ url: z.string().trim().max(500).nullable() }),
  response: z.any(),
  async handle({ ctx, body }) {
    const url = body.url?.trim() || null;
    if (url && !URL_RE.test(url)) {
      throw new ValidationError('Paste the Web app URL from Apps Script — it looks like https://script.google.com/macros/s/…/exec');
    }
    if (url) {
      const ok = await pushToGoogleSheetDirect(url, { type: 'test', message: 'ChatNexGen connected successfully ✅' });
      if (!ok) throw new ValidationError('Could not reach this Apps Script. Check that it is deployed as a Web app with access "Anyone".');
    }
    await systemDb.tenantConfiguration.upsert({
      where: { tenantId: ctx.tenantId },
      create: { tenantId: ctx.tenantId, googleSheetsWebhookUrl: url },
      update: { googleSheetsWebhookUrl: url },
    });
    return { url, connected: Boolean(url) };
  },
});

async function pushToGoogleSheetDirect(url: string, row: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...row, syncedAt: new Date().toISOString() }),
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text().catch(() => '');
    return res.ok && !/error/i.test(text.slice(0, 200));
  } catch {
    return false;
  }
}

export const POST = createHandler({
  operation: 'integrations.sheets.action',
  auth: 'tenant',
  body: z.object({ action: z.enum(['test', 'backfill']) }),
  response: z.any(),
  rateLimit: { limit: 6, windowMs: 60_000 },
  async handle({ ctx, body }) {
    const tenantId = ctx.tenantId;
    if (body.action === 'test') {
      const ok = await pushToGoogleSheet(tenantId, { type: 'test', message: 'Test row from ChatNexGen' });
      if (!ok) throw new ValidationError('Test failed. Re-check the Web app URL and deployment access.');
      return { sent: 1 };
    }

    const since = new Date(Date.now() - 30 * 86_400_000);
    let sent = 0;
    const appts = await systemDb.appointment.findMany({
      where: { clinic: { tenantId }, createdAt: { gte: since } },
      include: { doctor: { select: { doctorName: true, specialization: true } }, contact: { select: { phone: true } } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    for (const a of appts) {
      const r = (a.remindersSent as Record<string, unknown> | null) ?? {};
      if (await pushToGoogleSheet(tenantId, {
        type: 'appointment', ref: a.id.replace(/-/g, '').slice(0, 8).toUpperCase(), token: r.token ?? '', name: a.patientName ?? '', age: a.patientAge ?? '',
        phone: a.contact?.phone ?? '', doctor: a.doctor?.doctorName ?? '', department: a.doctor?.specialization ?? '',
        date: a.appointmentDate.toISOString().slice(0, 10), time: a.appointmentTime, status: a.status, reason: a.reasonForVisit ?? '', source: r.source ?? '',
      })) sent += 1;
    }
    const enquiries = await systemDb.businessEnquiry.findMany({
      where: { business: { tenantId }, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    for (const e of enquiries) {
      if (await pushToGoogleSheet(tenantId, {
        type: 'booking', ref: e.id.replace(/-/g, '').slice(0, 8).toUpperCase(), name: e.contactName ?? '', phone: e.contactPhone ?? '',
        service: e.enquiryType ?? '', date: e.preferredDate?.toISOString().slice(0, 10) ?? '', time: e.preferredTime ?? '', status: e.status, notes: e.notes ?? '', source: e.source,
      })) sent += 1;
    }
    const leads = await systemDb.contact.findMany({ where: { tenantId, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, take: 1000, select: { name: true, phone: true, email: true, company: true, createdAt: true } });
    for (const l of leads) {
      if (await pushToGoogleSheet(tenantId, { type: 'lead', name: l.name ?? '', phone: l.phone, email: l.email ?? '', company: l.company ?? '', createdAt: l.createdAt.toISOString() })) sent += 1;
    }
    return { sent };
  },
});
