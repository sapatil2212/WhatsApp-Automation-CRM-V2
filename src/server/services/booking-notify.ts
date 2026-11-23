/**
 * Booking side-effects shared by the public booking page, the WhatsApp AI
 * and the appointment lifecycle engine:
 *
 *  - clinic queue numbers (slot position in the doctor's day)
 *  - WhatsApp messages to the customer, also logged in the inbox
 *  - Google Sheets push (Apps Script web-app URL from Integrations)
 *  - realtime notifications to the tenant's dashboard
 *
 * Runs with `systemDb` scoped explicitly by tenantId: callers are public or
 * background contexts where no session exists.
 */

import { getLogger, systemDb, tenantDb } from '../kernel';
import { WhatsappTransport } from './whatsapp-transport';
import { triggerRealtimeEvent } from '@/lib/realtime';

const log = getLogger('booking-notify');

export function pretty(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function prettyTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

export function doctorTitle(name?: string | null): string {
  if (!name) return 'our doctor';
  return /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
}

/**
 * Clinic queue number: the slot's position in the doctor's schedule for that
 * day, so the 14th of 14 slots is #14 whatever order patients booked in.
 *
 * Stored on `remindersSent.token` (kept as the storage key so existing rows,
 * the dashboard and sheets keep working) together with the slot it was
 * computed for, so a reschedule gets a new number. Falls back to booking
 * order when the time is not on the doctor's grid (e.g. booked under an older
 * schedule or added manually off-grid).
 */
export async function assignToken(appointmentId: string): Promise<number> {
  const appt = await systemDb.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      doctorId: true,
      clinicId: true,
      appointmentDate: true,
      appointmentTime: true,
      createdAt: true,
      remindersSent: true,
      clinic: { select: { tenantId: true } },
    },
  });
  if (!appt) return 0;
  const existing = (appt.remindersSent as Record<string, unknown> | null) ?? {};
  const date = appt.appointmentDate.toISOString().slice(0, 10);
  const slotKey = `${date} ${appt.appointmentTime}`;
  if (typeof existing.token === 'number' && existing.tokenSlot === slotKey) return existing.token;

  let token: number | null = null;
  if (appt.doctorId && appt.clinic?.tenantId) {
    try {
      const { AppointmentService } = await import('./appointment.service');
      token = await AppointmentService.create(tenantDb(appt.clinic.tenantId)).slotNumber(appt.doctorId, date, appt.appointmentTime);
    } catch (error) {
      log.warn('queue number from schedule failed; using booking order', { appointmentId, err: error });
    }
  }
  if (token === null) {
    token = await systemDb.appointment.count({
      where: {
        clinicId: appt.clinicId,
        doctorId: appt.doctorId,
        appointmentDate: appt.appointmentDate,
        status: { not: 'cancelled' },
        createdAt: { lte: appt.createdAt },
      },
    });
  }

  await systemDb.appointment.update({
    where: { id: appointmentId },
    data: { remindersSent: { ...existing, token, tokenSlot: slotKey } },
  });
  return token;
}

/**
 * Sends a WhatsApp text and records it in the contact's conversation so the
 * team sees it in the inbox. Returns false when it could not be delivered
 * (WhatsApp not connected, or outside Meta's 24-hour window).
 */
export async function sendTenantText(tenantId: string, to: string, text: string, contactId?: string): Promise<boolean> {
  try {
    const transport = await WhatsappTransport.forTenant(tenantDb(tenantId));
    if (!transport) {
      log.warn('whatsapp not connected; message not sent', { tenantId });
      return false;
    }
    const { whatsappMessageId } = await transport.sendText({ to, text });
    if (contactId) {
      const conversation = await systemDb.conversation.findFirst({
        where: { tenantId, contactId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (conversation) {
        await systemDb.message.create({
          data: { conversationId: conversation.id, senderType: 'bot', contentType: 'text', contentText: text, status: 'sent', messageId: whatsappMessageId },
        });
        await systemDb.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageText: text.slice(0, 500), lastMessageAt: new Date() },
        });
      }
    }
    return true;
  } catch (error) {
    // Meta error 131047: outside the 24h customer-service window. Free-form
    // text is refused there; an approved utility template is required.
    log.warn('whatsapp text failed', { tenantId, err: error });
    return false;
  }
}

/** POSTs a row to the tenant's Google Sheets Apps Script web app, if configured. */
export async function pushToGoogleSheet(tenantId: string, row: Record<string, unknown>): Promise<boolean> {
  try {
    const config = await systemDb.tenantConfiguration.findUnique({
      where: { tenantId },
      select: { googleSheetsWebhookUrl: true },
    });
    const url = config?.googleSheetsWebhookUrl;
    if (!url || !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return false;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...row, syncedAt: new Date().toISOString() }),
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch (error) {
    log.warn('google sheet push failed', { tenantId, err: error });
    return false;
  }
}

export type TenantNotification = {
  type: 'booking' | 'message' | 'lead' | 'campaign' | 'template' | 'system';
  title: string;
  body?: string;
  href?: string;
};

export function notifyTenant(tenantId: string, n: TenantNotification): void {
  try {
    triggerRealtimeEvent(tenantId, 'notification', { ...n, at: new Date().toISOString() });
  } catch {
    /* realtime is best-effort */
  }
}

/** Confirmation text for a clinic appointment. */
export function appointmentConfirmationText(input: {
  clinicName: string;
  patientName: string | null;
  doctorName: string | null;
  department: string | null;
  date: Date | string;
  time: string;
  token: number;
  address?: string | null;
  bookingRef: string;
}): string {
  return [
    `✅ *Appointment confirmed*`,
    ``,
    `🏥 ${input.clinicName}`,
    input.patientName ? `👤 ${input.patientName}` : null,
    `🩺 ${doctorTitle(input.doctorName)}${input.department ? ` · ${input.department}` : ''}`,
    `📅 ${pretty(input.date)}`,
    `⏰ ${prettyTime(input.time)}`,
    `🎟️ Clinic Queue No: *${input.token}*`,
    input.address ? `📍 ${input.address}` : null,
    ``,
    `Ref: ${input.bookingRef}`,
    `Please arrive 10 minutes early. Reply *CANCEL* to cancel or *RESCHEDULE* to change the time.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function bookingRef(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}
