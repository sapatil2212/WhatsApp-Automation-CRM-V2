/**
 * Emergency closures & doctor leaves → affected patients.
 *
 * Called after Business Setup saves clinic exceptions or doctor leaves. Any
 * scheduled appointment that now falls on a blocked date is cancelled and
 * the patient gets a WhatsApp message with the reason and the booking link,
 * once (tracked in `remindersSent.closureNotified`).
 */

import { blockingExceptions } from '@/lib/healthcare/exceptions';
import { getLogger, systemDb } from '../kernel';
import { bookingSlugFor } from './booking-slug';
import { doctorTitle, notifyTenant, pretty, prettyTime } from './booking-notify';
import { appointmentValues, deliverAppointmentMessage } from './appointment-notify';

const log = getLogger('closure-notify');

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

export async function notifyAffectedAppointments(input: { clinicId: string; doctorId?: string }): Promise<number> {
  const clinic = await systemDb.clinic.findUnique({
    where: { id: input.clinicId },
    select: { id: true, tenantId: true, clinicName: true, dateExceptions: true, phone: true },
  });
  if (!clinic) return 0;
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

  const doctors = await systemDb.doctor.findMany({
    where: { clinicId: clinic.id, ...(input.doctorId ? { id: input.doctorId } : {}) },
    select: { id: true, doctorName: true, dateExceptions: true },
  });

  // date → reason, per scope
  const clinicBlocked = new Map(blockingExceptions(clinic.dateExceptions).filter((e) => new Date(`${e.date}T00:00:00Z`) >= today).map((e) => [e.date, e.reason]));
  const doctorBlocked = new Map(doctors.map((d) => [d.id, new Map(blockingExceptions(d.dateExceptions).map((e) => [e.date, e.reason]))]));

  const dates = new Set<string>([...clinicBlocked.keys(), ...[...doctorBlocked.values()].flatMap((m) => [...m.keys()])]);
  if (!dates.size) return 0;

  const appts = await systemDb.appointment.findMany({
    where: {
      clinicId: clinic.id,
      status: 'scheduled',
      appointmentDate: { in: [...dates].map((d) => new Date(`${d}T00:00:00Z`)) },
    },
    include: { contact: { select: { phone: true, name: true } }, doctor: { select: { doctorName: true, specialization: true } }, detail: { select: { whatsappConsent: true, appointmentRef: true } } },
  });

  const link = siteUrl() ? `${siteUrl()}/book/${await bookingSlugFor(clinic.id)}` : '';
  let notified = 0;
  for (const a of appts) {
    const date = a.appointmentDate.toISOString().slice(0, 10);
    const reason = clinicBlocked.get(date) ?? (a.doctorId ? doctorBlocked.get(a.doctorId)?.get(date) : undefined);
    if (!reason) continue;
    const sent = (a.remindersSent as Record<string, unknown> | null) ?? {};
    if (sent.closureNotified) continue;

    const closedWhole = clinicBlocked.has(date);
    const text = [
      `⚠️ *Appointment update — ${clinic.clinicName}*`,
      ``,
      closedWhole
        ? `We're sorry, the clinic will be closed on ${pretty(date)} (${reason}).`
        : `We're sorry, ${doctorTitle(a.doctor?.doctorName)} is unavailable on ${pretty(date)} (${reason}).`,
      `Your appointment at ${prettyTime(a.appointmentTime)} has been cancelled.`,
      ``,
      link ? `Please choose a new slot here: ${link}` : 'Reply to this message and we will help you choose a new slot.',
      `We apologise for the inconvenience.`,
    ].join('\n');

    await systemDb.appointment.update({
      where: { id: a.id },
      data: { status: 'cancelled', remindersSent: { ...sent, closureNotified: new Date().toISOString(), closureReason: reason } },
    });
    if (a.contact?.phone) {
      const res = await deliverAppointmentMessage({
        tenantId: clinic.tenantId,
        appointmentId: a.id,
        contactId: a.contactId,
        phone: a.contact.phone,
        consent: !a.detail || a.detail.whatsappConsent,
        event: 'cancelled',
        eventKey: `cancelled@${date} ${a.appointmentTime}`,
        text,
        values: appointmentValues({ patientName: a.patientName, contactName: a.contact.name, businessName: clinic.clinicName, date, time: a.appointmentTime, doctorName: a.doctor?.doctorName, department: a.doctor?.specialization, ref: a.detail?.appointmentRef }),
      });
      if (res.status === 'sent') notified += 1;
    }
  }
  if (appts.length) {
    notifyTenant(clinic.tenantId, {
      type: 'booking',
      title: 'Closure applied',
      body: `${appts.length} affected appointment(s) cancelled, ${notified} patient(s) notified on WhatsApp.`,
      href: '/healthcare/appointments',
    });
    log.info('closure notifications', { clinicId: clinic.id, affected: appts.length, notified });
  }
  return notified;
}
