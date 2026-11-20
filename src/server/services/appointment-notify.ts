/**
 * Appointment notification delivery (one entry point for every sender).
 *
 *   1. Idempotency — claims `AppointmentNotificationLog(appointmentId, eventKey)`
 *      first; a second attempt for the same key is a no-op.
 *   2. Consent + valid phone — otherwise logged as skipped.
 *   3. 24-hour customer-service window — open → the existing free-form
 *      text; closed → the tenant's newest APPROVED + enabled utility
 *      template for the event, through the tenant's own WABA.
 *   4. No approved template outside the window → nothing is sent; the
 *      attempt is logged and the tenant gets an actionable notification.
 *   5. Temporary Meta/network failures are retried with backoff.
 *
 * Never sends one tenant's template through another tenant's WABA: the
 * transport and the template rows are both resolved by `tenantId`.
 */

import type { Prisma } from '@prisma/client';

import { EVENT_LABEL, mapVariables, type TemplateEvent, type VariableSource } from '@/lib/whatsapp/appointment-template-library';
import { getLogger, systemDb, tenantDb } from '../kernel';
import { notifyTenant, sendTenantText } from './booking-notify';
import { pickActive, readVariables } from './utility-template.service';
import { WhatsappTransport } from './whatsapp-transport';

const log = getLogger('appointment-notify');
const WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [800, 2500];

/** Engine events; 'followup' has no utility template (only sent inside the window). */
export type NotifyEvent = TemplateEvent | 'followup';

export interface DeliverInput {
  tenantId: string;
  appointmentId: string;
  contactId: string | null;
  phone: string | null | undefined;
  consent: boolean;
  event: NotifyEvent;
  /** Unique per appointment + occurrence, e.g. "r_1d@2026-11-20 10:30". */
  eventKey: string;
  /** Free-form text used inside the 24h window. */
  text: string;
  /** Values for the template variables. */
  values: Partial<Record<VariableSource, string | null>>;
  scheduledAt?: Date;
  /** Internal: test hooks. */
  deps?: Partial<DeliverDeps>;
}

export type DeliverStatus = 'sent' | 'failed' | 'blocked_no_template' | 'skipped_no_consent' | 'skipped_window' | 'duplicate';
export interface DeliverResult {
  status: DeliverStatus;
  channel: 'text' | 'template' | 'none';
  messageId?: string;
  error?: string;
}

export interface DeliverDeps {
  windowOpen(tenantId: string, contactId: string | null, phone: string): Promise<boolean>;
  sendText(tenantId: string, phone: string, text: string, contactId: string | null): Promise<boolean>;
  findTemplates(tenantId: string, event: TemplateEvent): Promise<Array<{ id: string; name: string; language: string; status: string; isEnabled: boolean; version: number; eventType: string | null; variables: unknown; bodyText: string }>>;
  sendTemplate(tenantId: string, input: { to: string; templateName: string; language: string; params: string[] }): Promise<{ whatsappMessageId: string }>;
  claim(input: DeliverInput): Promise<{ id: string } | null>;
  finish(id: string, data: Record<string, unknown>): Promise<void>;
  recordInInbox(tenantId: string, contactId: string | null, text: string, templateName: string, messageId: string): Promise<void>;
  alertTenant(tenantId: string, event: TemplateEvent): void;
  sleep(ms: number): Promise<void>;
}

// ── defaults (DB + Meta) ─────────────────────────────────────────────

async function windowOpen(tenantId: string, contactId: string | null): Promise<boolean> {
  if (!contactId) return false;
  const last = await systemDb.message.findFirst({
    where: { senderType: 'customer', conversation: { tenantId, contactId } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  // A small safety margin so a send near the edge doesn't hit #131047.
  return Boolean(last && Date.now() - last.createdAt.getTime() < WINDOW_MS - 5 * 60 * 1000);
}

async function claim(input: DeliverInput): Promise<{ id: string } | null> {
  try {
    return await systemDb.appointmentNotificationLog.create({
      data: {
        tenantId: input.tenantId,
        appointmentId: input.appointmentId,
        contactId: input.contactId,
        eventType: input.event,
        eventKey: input.eventKey.slice(0, 120),
        phoneNumber: input.phone?.slice(0, 32) ?? null,
        status: 'pending',
        scheduledAt: input.scheduledAt ?? null,
      },
      select: { id: true },
    });
  } catch (error) {
    // Unique (appointmentId, eventKey): already handled. Re-try only a
    // previous attempt that failed for a temporary reason.
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const prev = await systemDb.appointmentNotificationLog.findUnique({
      where: { appointmentId_eventKey: { appointmentId: input.appointmentId, eventKey: input.eventKey.slice(0, 120) } },
      select: { id: true, status: true, attempts: true },
    });
    if (prev && prev.status === 'failed' && prev.attempts < 3) return { id: prev.id };
    return null;
  }
}

const lastAlert = new Map<string, number>();
function alertTenant(tenantId: string, event: TemplateEvent) {
  const key = `${tenantId}:${event}`;
  const now = Date.now();
  if ((lastAlert.get(key) ?? 0) > now - 6 * 60 * 60 * 1000) return; // at most every 6h per event
  lastAlert.set(key, now);
  notifyTenant(tenantId, {
    type: 'template',
    title: `WhatsApp "${EVENT_LABEL[event]}" not delivered`,
    body: 'The customer is outside the 24-hour window and this message needs an approved utility template. Submit it for Meta approval.',
    href: '/connections/whatsapp-templates',
  });
}

const defaults: DeliverDeps = {
  windowOpen: (tenantId, contactId) => windowOpen(tenantId, contactId),
  sendText: (tenantId, phone, text, contactId) => sendTenantText(tenantId, phone, text, contactId ?? undefined),
  findTemplates: (tenantId, event) =>
    systemDb.messageTemplate.findMany({
      where: { tenantId, eventType: event },
      select: { id: true, name: true, language: true, status: true, isEnabled: true, version: true, eventType: true, variables: true, bodyText: true },
    }),
  async sendTemplate(tenantId, input) {
    const transport = await WhatsappTransport.forTenant(tenantDb(tenantId));
    if (!transport) throw new Error('WhatsApp is not connected for this workspace.');
    return transport.sendTemplate(input);
  },
  claim,
  async finish(id, data) {
    await systemDb.appointmentNotificationLog.update({ where: { id }, data: data as Prisma.AppointmentNotificationLogUpdateInput });
  },
  async recordInInbox(tenantId, contactId, text, templateName, messageId) {
    if (!contactId) return;
    const conversation = await systemDb.conversation.findFirst({ where: { tenantId, contactId }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
    if (!conversation) return;
    await systemDb.message.create({
      data: { conversationId: conversation.id, senderType: 'bot', contentType: 'template', templateName, contentText: text, status: 'sent', messageId },
    });
    await systemDb.conversation.update({ where: { id: conversation.id }, data: { lastMessageText: text.slice(0, 500), lastMessageAt: new Date() } });
  },
  alertTenant,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

// ── engine ───────────────────────────────────────────────────────────

/** Errors worth retrying: network, timeouts, Meta throttling / temporary codes. */
export function isTransient(message: string): boolean {
  return /timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|\b50[0234]\b|temporar|try again|rate limit|throttl|#?(130429|131000|131016|80007)\b|\(#(1|2|4|17|341)\)/i.test(message);
}

function render(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
}

export async function deliverAppointmentMessage(input: DeliverInput): Promise<DeliverResult> {
  const d: DeliverDeps = { ...defaults, ...input.deps };
  const claimRow = await d.claim(input);
  if (!claimRow) return { status: 'duplicate', channel: 'none' };
  const finish = (status: DeliverStatus, data: Record<string, unknown> = {}) =>
    d.finish(claimRow.id, { status, ...data }).catch((e) => log.warn('notification log update failed', { err: e }));

  const phone = (input.phone ?? '').replace(/[^\d]/g, '');
  if (!input.consent || phone.length < 10) {
    await finish('skipped_no_consent', { errorMessage: !input.consent ? 'No WhatsApp consent.' : 'No valid phone number.' });
    return { status: 'skipped_no_consent', channel: 'none' };
  }

  // Inside the 24-hour window: the existing free-form path.
  const open = await d.windowOpen(input.tenantId, input.contactId, phone).catch(() => false);
  if (open) {
    const ok = await d.sendText(input.tenantId, phone, input.text, input.contactId);
    if (ok) {
      await finish('sent', { channel: 'text', sentAt: new Date(), attempts: { increment: 1 } });
      return { status: 'sent', channel: 'text' };
    }
    // The window may have just closed — fall through to the template path.
  }

  if (input.event === 'followup') {
    await finish('skipped_window', { errorMessage: 'Outside the 24-hour window; follow-ups have no utility template.' });
    return { status: 'skipped_window', channel: 'none' };
  }

  const event = input.event;
  // Healthcare confirmations with a token prefer the token template, and
  // fall back to the standard confirmation if that one isn't approved.
  const candidates: TemplateEvent[] = event === 'confirmation' && input.values.token_number ? ['token_confirmation', 'confirmation'] : [event];
  let template: Awaited<ReturnType<DeliverDeps['findTemplates']>>[number] | null = null;
  for (const e of candidates) {
    template = pickActive(await d.findTemplates(input.tenantId, e), e);
    if (template) break;
  }
  if (!template) {
    await finish('blocked_no_template', { errorMessage: `No approved "${EVENT_LABEL[event]}" template; free-form messages are not allowed outside the 24-hour window.` });
    d.alertTenant(input.tenantId, event);
    return { status: 'blocked_no_template', channel: 'none' };
  }

  const params = mapVariables(readVariables(template.variables), input.values);
  let lastError = '';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { whatsappMessageId } = await d.sendTemplate(input.tenantId, { to: phone, templateName: template.name, language: template.language, params });
      await finish('sent', {
        channel: 'template',
        templateId: template.id,
        templateName: template.name,
        templateVersion: template.version,
        messageId: whatsappMessageId,
        sentAt: new Date(),
        attempts: { increment: attempt + 1 },
        errorMessage: null,
      });
      await d.recordInInbox(input.tenantId, input.contactId, render(template.bodyText, params), template.name, whatsappMessageId).catch(() => undefined);
      return { status: 'sent', channel: 'template', messageId: whatsappMessageId };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (!isTransient(lastError) || attempt === RETRY_DELAYS_MS.length) break;
      await d.sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  await finish('failed', { channel: 'template', templateId: template.id, templateName: template.name, templateVersion: template.version, errorMessage: lastError.slice(0, 2000), attempts: { increment: 1 } });
  log.warn('appointment template send failed', { tenantId: input.tenantId, event, err: lastError });
  return { status: 'failed', channel: 'template', error: lastError };
}

/** Standard variable values for an appointment. */
export function appointmentValues(a: {
  patientName?: string | null;
  contactName?: string | null;
  businessName: string;
  date: string;
  time: string;
  doctorName?: string | null;
  department?: string | null;
  serviceName?: string | null;
  ref?: string | null;
  token?: number | string | null;
}): Partial<Record<VariableSource, string>> {
  const d = new Date(`${a.date}T00:00:00Z`);
  const [h, m] = a.time.split(':').map(Number);
  const time = Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` : a.time;
  const doctor = a.doctorName ? (/^dr\.?\s/i.test(a.doctorName) ? a.doctorName : `Dr. ${a.doctorName}`) : null;
  return {
    customer_name: a.patientName || a.contactName || 'there',
    business_name: a.businessName,
    appointment_date: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    appointment_time: time,
    service_name: a.serviceName || (doctor ? `${doctor}${a.department ? ` (${a.department})` : ''}` : a.department || 'Appointment'),
    appointment_ref: a.ref ?? undefined,
    token_number: a.token !== null && a.token !== undefined && String(a.token) !== '' ? String(a.token) : undefined,
  };
}
