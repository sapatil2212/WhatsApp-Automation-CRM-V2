/**
 * Appointment lifecycle messaging (cross-tenant, run by the server ticker).
 *
 *   confirmation   right after booking (if the booking path didn't send it)
 *   r_1d           ~24h before
 *   r_2h           ~2h before
 *   r_1h           ~1h before
 *   completed      when staff marks the visit completed (thank-you + feedback ask)
 *   no_show        when staff marks it no-show (offer to rebook)
 *   health_2d      2 days after a completed visit ("how are you feeling?")
 *   followup_3d    3 days after a completed visit (follow-up / review booking)
 *
 * Each step is recorded in `Appointment.remindersSent` so it fires once.
 * Times are interpreted in APP_TIMEZONE (default Asia/Kolkata).
 */

import type { Prisma } from '@prisma/client';

import { getLogger, systemDb } from '../kernel';
import { bookingSlugFor } from './booking-slug';
import { doctorTitle, pretty, prettyTime } from './booking-notify';
import { appointmentValues, deliverAppointmentMessage, type NotifyEvent } from './appointment-notify';
import { readReminderSettings } from './utility-template.service';

/** Which template event a lifecycle step uses. */
export function eventForStep(step: LifecycleStep): NotifyEvent {
  if (step === 'confirmation') return 'confirmation';
  if (step === 'completed') return 'completed';
  if (step === 'r_1d' || step === 'r_2h' || step === 'r_1h' || step === 'r_30m') return 'reminder';
  return 'followup';
}

const log = getLogger('appointment-lifecycle');
const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const HOUR = 3_600_000;

export type LifecycleStep = 'confirmation' | 'r_1d' | 'r_2h' | 'r_1h' | 'r_30m' | 'completed' | 'no_show' | 'health_2d' | 'followup_3d';

/** Reminder intervals a tenant can switch on/off (Tenant.settings.appointmentReminders). */
export type ReminderToggles = Partial<Record<'r_1d' | 'r_2h' | 'r_1h' | 'r_30m', boolean>>;
const DEFAULT_TOGGLES: Required<ReminderToggles> = { r_1d: true, r_2h: true, r_1h: true, r_30m: false };

/** Offset (ms) of TZ from UTC at a given instant. */
function tzOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - at.getTime();
}

/** The real instant of an appointment stored as a local date + HH:mm. */
export function appointmentInstant(date: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const naive = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h || 0, m || 0);
  return new Date(naive - tzOffsetMs(new Date(naive)));
}

/** Which step is due now for an appointment (pure — unit tested). */
export function dueStep(input: { status: string; at: Date; createdAt: Date; updatedAt: Date; sent: Record<string, unknown>; now: Date; reminders?: ReminderToggles }): LifecycleStep | null {
  const { status, at, sent, now } = input;
  const until = at.getTime() - now.getTime();
  const has = (k: LifecycleStep) => Boolean(sent[k]);
  const on = { ...DEFAULT_TOGGLES, ...(input.reminders ?? {}) };

  if (status === 'scheduled') {
    if (until <= 0) return null;
    if (!has('confirmation') && now.getTime() - input.createdAt.getTime() < 6 * HOUR) return 'confirmation';
    // Closest reminder first; a later one makes the earlier ones obsolete.
    if (on.r_30m && until <= 0.6 * HOUR) return has('r_30m') ? null : 'r_30m';
    if (on.r_1h && until <= 1.25 * HOUR) return has('r_1h') || has('r_30m') ? null : 'r_1h';
    if (on.r_2h && until <= 2.25 * HOUR && until > 1.25 * HOUR) return has('r_2h') || has('r_1h') || has('r_30m') ? null : 'r_2h';
    if (on.r_1d && until <= 25 * HOUR && until > 3 * HOUR) {
      // Skip the day-before reminder for bookings made less than 24h ahead.
      if (has('r_1d') || at.getTime() - input.createdAt.getTime() < 20 * HOUR) return null;
      return 'r_1d';
    }
    return null;
  }
  if (status === 'no_show') {
    return has('no_show') || now.getTime() - input.updatedAt.getTime() > 72 * HOUR ? null : 'no_show';
  }
  if (status === 'completed') {
    const since = now.getTime() - at.getTime();
    if (!has('completed') && now.getTime() - input.updatedAt.getTime() < 48 * HOUR) return 'completed';
    if (!has('health_2d') && since >= 48 * HOUR && since < 72 * HOUR) return 'health_2d';
    if (!has('followup_3d') && since >= 72 * HOUR && since < 120 * HOUR) return 'followup_3d';
  }
  return null;
}

function messageFor(step: LifecycleStep, a: { patient: string; clinic: string; doctor: string | null; date: Date; time: string; token?: number; link: string }): string {
  const who = a.patient ? `${a.patient.split(/\s+/)[0]} ji` : 'there';
  const when = `${pretty(a.date)} at ${prettyTime(a.time)}`;
  const tok = a.token ? `\n🎟️ Token No: *${a.token}*` : '';
  switch (step) {
    case 'confirmation':
      return `✅ Hello ${who}, your appointment with ${doctorTitle(a.doctor)} at ${a.clinic} is confirmed for ${when}.${tok}\n\nReply *CANCEL* to cancel or *RESCHEDULE* to change.`;
    case 'r_1d':
      return `⏰ Reminder: Hello ${who}, your appointment with ${doctorTitle(a.doctor)} at ${a.clinic} is *tomorrow*, ${when}.${tok}\n\nPlease reply *YES* to confirm or *RESCHEDULE* if you can't make it.`;
    case 'r_2h':
      return `⏰ Hello ${who}, your appointment with ${doctorTitle(a.doctor)} is in about 2 hours (${prettyTime(a.time)}).${tok}\nPlease carry any previous prescriptions or reports.`;
    case 'r_1h':
      return `🚶 Hello ${who}, see you in 1 hour at ${a.clinic} (${prettyTime(a.time)}).${tok}\nPlease arrive 10 minutes early.`;
    case 'r_30m':
      return `🚶 Hello ${who}, your appointment at ${a.clinic} is in 30 minutes (${prettyTime(a.time)}).${tok}\nSee you soon!`;
    case 'completed':
      return `🙏 Thank you for visiting ${a.clinic}, ${who}. We hope your consultation with ${doctorTitle(a.doctor)} went well.\n\nHow was your experience? Reply with a rating from 1 to 5 ⭐`;
    case 'no_show':
      return `Hello ${who}, we missed you at your appointment on ${when}. Would you like to book a new time?${a.link ? `\n\nBook here: ${a.link}` : '\nJust reply here and we will help.'}`;
    case 'health_2d':
      return `💚 Hello ${who}, this is ${a.clinic}. How are you feeling after your visit with ${doctorTitle(a.doctor)}? Reply here if you have any questions or concerns — we're happy to help.`;
    case 'followup_3d':
      return `📋 Hello ${who}, it's time to check in after your visit to ${a.clinic}. If ${doctorTitle(a.doctor)} advised a follow-up, you can book it here${a.link ? `: ${a.link}` : ' — just reply to this message'}.`;
  }
}

/** One pass over due appointments across all tenants. */
export async function runAppointmentLifecycle(now = new Date()): Promise<{ checked: number; sent: number }> {
  const from = new Date(now.getTime() - 6 * 24 * HOUR);
  const to = new Date(now.getTime() + 2 * 24 * HOUR);
  const rows = await systemDb.appointment.findMany({
    where: {
      status: { in: ['scheduled', 'completed', 'no_show'] },
      appointmentDate: { gte: new Date(from.toISOString().slice(0, 10) + 'T00:00:00Z'), lte: new Date(to.toISOString().slice(0, 10) + 'T00:00:00Z') },
    },
    include: {
      contact: { select: { phone: true, name: true } },
      doctor: { select: { doctorName: true, specialization: true } },
      clinic: { select: { id: true, tenantId: true, clinicName: true } },
      detail: { select: { whatsappConsent: true, appointmentRef: true, department: { select: { name: true } } } },
    },
    take: 1000,
  });

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  let sent = 0;
  // Per-tenant reminder intervals (Tenant is global → read by explicit id).
  const tenantIds = [...new Set(rows.map((r) => r.clinic.tenantId))];
  const tenants = tenantIds.length ? await systemDb.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, settings: true } }) : [];
  const reminderSettings = new Map(tenants.map((t) => [t.id, readReminderSettings(t.settings)]));
  for (const a of rows) {
    if (!a.contact?.phone) continue;
    // Online bookings record explicit consent; without it no WhatsApp is sent.
    if (a.detail && !a.detail.whatsappConsent) continue;
    const record = (a.remindersSent as Record<string, unknown> | null) ?? {};
    const at = appointmentInstant(a.appointmentDate, a.appointmentTime);
    const step = dueStep({ status: a.status, at, createdAt: a.createdAt, updatedAt: a.updatedAt, sent: record, now, reminders: reminderSettings.get(a.clinic.tenantId) });
    if (!step) continue;

    // Claim first so two ticks can never double-send.
    const claimed = await systemDb.appointment.updateMany({
      where: { id: a.id, updatedAt: a.updatedAt },
      data: { remindersSent: { ...record, [step]: now.toISOString() } as Prisma.InputJsonObject },
    });
    if (!claimed.count) continue;

    const text = messageFor(step, {
      patient: a.patientName || a.contact.name || '',
      clinic: a.clinic.clinicName,
      doctor: a.doctor?.doctorName ?? null,
      date: a.appointmentDate,
      time: a.appointmentTime,
      token: typeof record.token === 'number' ? record.token : undefined,
      link: site ? `${site}/book/${await bookingSlugFor(a.clinic.id)}` : '',
    });
    const date = a.appointmentDate.toISOString().slice(0, 10);
    // Inside 24h → this text; outside → the tenant's approved utility template.
    const result = await deliverAppointmentMessage({
      tenantId: a.clinic.tenantId,
      appointmentId: a.id,
      contactId: a.contactId,
      phone: a.contact.phone,
      consent: !a.detail || a.detail.whatsappConsent,
      event: eventForStep(step),
      // Includes the slot, so a rescheduled appointment gets fresh reminders
      // and an obsolete one can never fire twice.
      eventKey: `${step}@${date} ${a.appointmentTime}`,
      text,
      scheduledAt: at,
      values: appointmentValues({
        patientName: a.patientName,
        contactName: a.contact.name,
        businessName: a.clinic.clinicName,
        date,
        time: a.appointmentTime,
        doctorName: a.doctor?.doctorName,
        department: a.detail?.department?.name ?? a.doctor?.specialization,
        ref: a.detail?.appointmentRef,
        token: typeof record.token === 'number' ? record.token : undefined,
      }),
    });
    const ok = result.status === 'sent' || result.status === 'duplicate';
    if (ok) {
      sent += 1;
      if (step === 'completed') await systemDb.appointment.update({ where: { id: a.id }, data: { feedbackSent: true } }).catch(() => undefined);
      if (step === 'followup_3d') await systemDb.appointment.update({ where: { id: a.id }, data: { followupSent: true } }).catch(() => undefined);
    } else {
      // Record the failure so the team can see why a reminder didn't arrive.
      await systemDb.appointment.update({ where: { id: a.id }, data: { remindersSent: { ...record, [step]: now.toISOString(), [`${step}_failed`]: result.status } as Prisma.InputJsonObject } }).catch(() => undefined);
    }
  }
  if (sent) log.info('lifecycle messages sent', { checked: rows.length, sent });
  return { checked: rows.length, sent };
}
