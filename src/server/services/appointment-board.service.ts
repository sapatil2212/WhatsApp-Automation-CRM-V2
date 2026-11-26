/**
 * Appointments board for the clinic dashboard.
 *
 * One place that reads appointments with everything staff need on screen —
 * patient (name, age, gender, phone, email), appointment ID, token,
 * department, doctor, complaint, source, WhatsApp consent — and performs
 * changes through the same AppointmentService guards as the booking page
 * and the WhatsApp assistant (slot checks, no double booking).
 *
 * Every change emits `appointments:changed` so open dashboards refresh, and
 * patients are messaged on WhatsApp only when they consented (online
 * bookings record consent; older bookings without a record are treated as
 * WhatsApp-initiated).
 */

import { publicSiteUrl } from '../site-origin';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { triggerRealtimeEvent } from '@/lib/realtime';
import { ConflictError, NotFoundError, ValidationError, type TenantDb } from '../kernel';
import { AppointmentService, CLINIC_TIME_ZONE } from './appointment.service';
import { todayIn } from './availability';
import { assignToken, bookingRef, pretty, prettyTime } from './booking-notify';
import { appointmentValues, deliverAppointmentMessage, type NotifyEvent } from './appointment-notify';
import { newAppointmentRef, normalizeBookingPhone } from './public-booking.service';
import { bookAppointmentBodySchema, rescheduleAppointmentBodySchema } from '../validators/clinic.validator';

export const BOARD_TABS = ['upcoming', 'today', 'past', 'cancelled', 'all'] as const;
export type BoardTab = (typeof BOARD_TABS)[number];
const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;

export const boardQuerySchema = z.object({
  tab: z.enum(BOARD_TABS).default('upcoming'),
  status: z.enum(STATUSES).optional(),
  doctorId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

export const boardCreateSchema = z.object({
  name: z.string().trim().min(2, "Enter the patient's name.").max(120),
  phone: z.string().trim().max(20).optional().default(''),
  email: z.string().trim().email('Enter a valid email.').max(191).optional().or(z.literal('')),
  age: z.string().trim().regex(/^\d{0,3}$/, 'Age must be a number.').optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  doctorId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  complaint: z.string().trim().max(1000).optional(),
  whatsappConsent: z.boolean().default(false),
});

export const boardActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), status: z.enum(STATUSES), notify: z.boolean().default(true) }),
  z.object({
    action: z.literal('reschedule'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    doctorId: z.string().uuid().optional(),
    notify: z.boolean().default(true),
  }),
  z.object({ action: z.literal('remind') }),
  z.object({
    action: z.literal('edit'),
    name: z.string().trim().min(2, "Enter the patient's name.").max(120),
    age: z.string().trim().regex(/^\d{0,3}$/, 'Age must be a number.').optional(),
    gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).nullable().optional(),
    email: z.string().trim().email('Enter a valid email.').max(191).optional().or(z.literal('')),
    complaint: z.string().trim().max(1000).optional(),
    departmentId: z.string().uuid().nullable().optional(),
  }),
]);

export const boardBulkDeleteSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

const include = {
  contact: { select: { id: true, name: true, phone: true, email: true } },
  doctor: { select: { id: true, doctorName: true, specialization: true } },
  detail: { include: { department: { select: { id: true, name: true } } } },
} as const;

type Row = {
  id: string;
  appointmentDate: Date;
  appointmentTime: string;
  status: string;
  patientName: string | null;
  patientAge: string | null;
  reasonForVisit: string | null;
  remindersSent: unknown;
  createdAt: Date;
  updatedAt: Date;
  contactId: string;
  contact: { id: string; name: string | null; phone: string; email: string | null } | null;
  doctor: { id: string; doctorName: string; specialization: string | null } | null;
  detail: {
    appointmentRef: string;
    patientEmail: string | null;
    patientGender: string | null;
    patientPhone: string | null;
    whatsappConsent: boolean;
    source: string;
    department: { id: string; name: string } | null;
  } | null;
};

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const drName = (n?: string | null) => (n ? (/^dr\.?\s/i.test(n) ? n : `Dr. ${n}`) : '');

function sentLog(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Patients may be messaged when they consented; legacy rows (no record) came from WhatsApp. */
const canMessage = (r: Row) => Boolean((r.detail?.patientPhone || r.contact?.phone) && (!r.detail || r.detail.whatsappConsent));

/** Sends through the notification engine (24h window → text, else approved template). */
async function notifyPatient(tenantId: string, clinicName: string, r: Row, event: NotifyEvent, eventKey: string, text: string): Promise<boolean> {
  const date = dateOnly(r.appointmentDate);
  const res = await deliverAppointmentMessage({
    tenantId,
    appointmentId: r.id,
    contactId: r.contactId,
    phone: r.detail?.patientPhone || r.contact?.phone,
    consent: !r.detail || r.detail.whatsappConsent,
    event,
    eventKey,
    text,
    values: appointmentValues({
      patientName: r.patientName,
      contactName: r.contact?.name,
      businessName: clinicName,
      date,
      time: r.appointmentTime,
      doctorName: r.doctor?.doctorName,
      department: r.detail?.department?.name ?? r.doctor?.specialization,
      ref: r.detail?.appointmentRef ?? bookingRef(r.id),
      token: ((t) => (typeof t === 'number' ? t : undefined))(sentLog(r.remindersSent).token),
    }),
  });
  return res.status === 'sent';
}

export function toBoardRow(r: Row) {
  const log = sentLog(r.remindersSent);
  return {
    id: r.id,
    ref: r.detail?.appointmentRef ?? bookingRef(r.id),
    token: typeof log.token === 'number' ? log.token : null,
    date: dateOnly(r.appointmentDate),
    time: r.appointmentTime,
    status: r.status,
    patient: {
      contactId: r.contactId,
      name: r.patientName || r.contact?.name || null,
      age: r.patientAge,
      gender: r.detail?.patientGender ?? null,
      phone: r.detail?.patientPhone || r.contact?.phone || null,
      email: r.detail?.patientEmail || r.contact?.email || null,
    },
    doctor: r.doctor ? { id: r.doctor.id, name: r.doctor.doctorName, specialization: r.doctor.specialization } : null,
    department: r.detail?.department?.name ?? r.doctor?.specialization ?? null,
    complaint: r.reasonForVisit,
    source: r.detail?.source ?? (typeof log.source === 'string' ? log.source : 'whatsapp'),
    whatsappConsent: r.detail ? r.detail.whatsappConsent : true,
    canMessage: canMessage(r),
    messages: Object.keys(log).filter((k) => !['token', 'source'].includes(k) && log[k] && log[k] !== 'no_consent'),
    rescheduledFrom: typeof log.rescheduledFrom === 'string' ? log.rescheduledFrom : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type BoardRow = ReturnType<typeof toBoardRow>;

/** Tells open dashboards to refresh. */
export function appointmentsChanged(tenantId: string, info: { id?: string; kind: string }): void {
  try {
    triggerRealtimeEvent(tenantId, 'appointments:changed', { ...info, at: new Date().toISOString() });
  } catch {
    /* best-effort */
  }
}

async function requireClinic(db: TenantDb) {
  const clinic = await db.clinic.findFirst({ select: { id: true, clinicName: true, address: true, city: true } });
  if (!clinic) throw new NotFoundError('Clinic', { details: { hint: 'Complete Business Setup first.' } });
  return clinic;
}

export async function listBoard(db: TenantDb, q: BoardQuery) {
  const clinic = await requireClinic(db);
  const today = todayIn(CLINIC_TIME_ZONE);
  const todayDate = new Date(`${today}T00:00:00Z`);

  const where: Record<string, unknown> = { clinicId: clinic.id };
  const and: Record<string, unknown>[] = [];
  if (q.tab === 'upcoming') and.push({ status: 'scheduled', appointmentDate: { gte: todayDate } });
  if (q.tab === 'today') and.push({ appointmentDate: todayDate });
  if (q.tab === 'past') and.push({ OR: [{ appointmentDate: { lt: todayDate } }, { status: { in: ['completed', 'no_show'] } }], status: { not: 'cancelled' } });
  if (q.tab === 'cancelled') and.push({ status: 'cancelled' });
  if (q.status) and.push({ status: q.status });
  if (q.doctorId) and.push({ doctorId: q.doctorId });
  if (q.from) and.push({ appointmentDate: { gte: new Date(`${q.from}T00:00:00Z`) } });
  if (q.to) and.push({ appointmentDate: { lte: new Date(`${q.to}T00:00:00Z`) } });
  if (q.search) {
    const s = q.search;
    and.push({
      OR: [
        { patientName: { contains: s } },
        { reasonForVisit: { contains: s } },
        { contact: { name: { contains: s } } },
        { contact: { phone: { contains: s.replace(/\D/g, '') || s } } },
        { detail: { appointmentRef: { contains: s.toUpperCase() } } },
      ],
    });
  }
  if (and.length) where.AND = and;

  const ascending = q.tab === 'upcoming' || q.tab === 'today';
  const orderBy = [{ appointmentDate: ascending ? 'asc' : 'desc' }, { appointmentTime: ascending ? 'asc' : 'desc' }] as const;

  const [total, rows, counts, todayCount, upcomingCount, doctors] = await Promise.all([
    db.appointment.count({ where: where as never }),
    db.appointment.findMany({ where: where as never, include, orderBy: orderBy as never, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.appointment.groupBy({ by: ['status'], where: { clinicId: clinic.id }, _count: { _all: true } }),
    db.appointment.count({ where: { clinicId: clinic.id, appointmentDate: todayDate, status: { not: 'cancelled' } } }),
    db.appointment.count({ where: { clinicId: clinic.id, status: 'scheduled', appointmentDate: { gte: todayDate } } }),
    db.doctor.findMany({ where: { clinicId: clinic.id }, select: { id: true, doctorName: true, specialization: true }, orderBy: { doctorName: 'asc' } }),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>;

  return {
    items: (rows as unknown as Row[]).map(toBoardRow),
    pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    stats: {
      today: todayCount,
      upcoming: upcomingCount,
      completed: byStatus.completed ?? 0,
      cancelled: byStatus.cancelled ?? 0,
      noShow: byStatus.no_show ?? 0,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    },
    doctors: doctors.map((d) => ({ id: d.id, name: d.doctorName, specialization: d.specialization })),
    today,
    timeZone: CLINIC_TIME_ZONE,
  };
}

async function loadRow(db: TenantDb, clinicId: string, id: string): Promise<Row> {
  const row = await db.appointment.findFirst({ where: { id, clinicId }, include });
  if (!row) throw new NotFoundError('Appointment');
  return row as unknown as Row;
}

export async function boardDetail(db: TenantDb, id: string) {
  const clinic = await requireClinic(db);
  const row = await loadRow(db, clinic.id, id);
  const [history, intakes, feedback, conversation] = await Promise.all([
    db.appointment.findMany({
      where: { clinicId: clinic.id, contactId: row.contactId, id: { not: id } },
      include,
      orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'desc' }],
      take: 10,
    }),
    db.patientIntake.findMany({ where: { appointmentId: id }, orderBy: { createdAt: 'desc' }, take: 3 }),
    db.patientFeedback.findMany({ where: { appointmentId: id }, orderBy: { createdAt: 'desc' }, take: 3 }),
    db.conversation.findFirst({ where: { contactId: row.contactId }, orderBy: { updatedAt: 'desc' }, select: { id: true } }),
  ]);
  return {
    ...toBoardRow(row),
    log: sentLog(row.remindersSent),
    conversationId: conversation?.id ?? null,
    history: (history as unknown as Row[]).map(toBoardRow),
    intakes: intakes.map((i) => ({ id: i.id, symptoms: i.symptoms, allergies: i.allergies, medications: i.currentMedications, history: i.medicalHistory, urgency: i.urgencyLevel, createdAt: i.createdAt.toISOString() })),
    feedback: feedback.map((f) => ({ id: f.id, rating: f.rating, text: f.feedbackText, createdAt: f.createdAt.toISOString() })),
  };
}

export async function createFromBoard(db: TenantDb, ctx: { tenantId: string; userId: string }, body: z.infer<typeof boardCreateSchema>) {
  const clinic = await requireClinic(db);
  const phone = normalizeBookingPhone(body.phone, '91');
  if (body.phone && !phone) throw new ValidationError('Enter a valid mobile number.');
  if (body.whatsappConsent && !phone) throw new ValidationError('Add a WhatsApp number to send WhatsApp updates.');

  let contactId: string;
  const existing = phone ? await db.contact.findFirst({ where: { phone }, select: { id: true, name: true } }) : null;
  if (existing) {
    contactId = existing.id;
    if (!existing.name) await db.contact.updateMany({ where: { id: existing.id }, data: { name: body.name } });
  } else {
    contactId = (
      await db.contact.create({
        data: { tenantId: ctx.tenantId, userId: ctx.userId, phone: phone ?? '', name: body.name, email: body.email || null } as never,
        select: { id: true },
      })
    ).id;
  }

  const service = AppointmentService.create(db);
  const appt = await service.book(
    bookAppointmentBodySchema.parse({
      contactId,
      doctorId: body.doctorId,
      appointmentDate: body.date,
      appointmentTime: body.time,
      patientName: body.name,
      patientAge: body.age || null,
      reasonForVisit: body.complaint || null,
    }),
  );
  const token = await assignToken(appt.id);
  const ref = await newAppointmentRef(body.date);
  await db.appointmentDetail.create({
    data: {
      appointmentId: appt.id,
      appointmentRef: ref,
      departmentId: body.departmentId ?? null,
      patientEmail: body.email || null,
      patientGender: body.gender ?? null,
      patientPhone: phone,
      whatsappConsent: body.whatsappConsent,
      consentAt: body.whatsappConsent ? new Date() : null,
      source: 'dashboard',
    },
  });

  const row = await loadRow(db, clinic.id, appt.id);
  let whatsappSent = false;
  if (body.whatsappConsent && phone) {
    whatsappSent = await notifyPatient(
      ctx.tenantId,
      clinic.clinicName,
      row,
      'confirmation',
      `confirmation@${body.date} ${body.time}`,
      `Hi ${body.name}! ✅ Your appointment at *${clinic.clinicName}* is confirmed.\n\n🩺 ${drName(row.doctor?.doctorName)}\n📅 ${pretty(body.date)} · ${prettyTime(body.time)}\n🎟️ Token ${token}\n🆔 ${ref}\n\nReply here if you need to change anything.`,
    );
  }
  await db.appointment.updateMany({
    where: { id: appt.id },
    data: { remindersSent: { ...sentLog(row.remindersSent), token, source: 'dashboard', confirmation: whatsappSent ? new Date().toISOString() : body.whatsappConsent ? null : 'no_consent' } },
  });
  appointmentsChanged(ctx.tenantId, { id: appt.id, kind: 'created' });
  return toBoardRow(await loadRow(db, clinic.id, appt.id));
}

function statusMessage(status: string, r: Row, clinicName: string): string | null {
  const name = r.patientName || r.contact?.name || 'there';
  const when = `${pretty(dateOnly(r.appointmentDate))} at ${prettyTime(r.appointmentTime)}`;
  const doc = drName(r.doctor?.doctorName) || 'the doctor';
  switch (status) {
    case 'cancelled':
      return `Hi ${name}, your appointment with ${doc} on ${when} at *${clinicName}* has been cancelled. Reply here anytime to book a new time. 🙏`;
    case 'completed':
      return `Hi ${name}, thank you for visiting ${doc} at *${clinicName}* today. 🙏 Reply here if you have any follow-up questions. Take care!`;
    case 'no_show':
      return `Hi ${name}, we missed you for your appointment with ${doc} on ${when}. Reply here and we'll help you book a new time.`;
    default:
      return null;
  }
}

export async function actOnBoard(db: TenantDb, tenantId: string, id: string, body: z.infer<typeof boardActionSchema>) {
  const clinic = await requireClinic(db);
  const before = await loadRow(db, clinic.id, id);
  const service = AppointmentService.create(db);
  let messaged = false;

  if (body.action === 'status') {
    await service.setStatus(id, { status: body.status });
    // Thank-you (completed) and no-show messages are sent by the reminder
    // engine within a minute; only the cancellation notice is sent here.
    const text = body.status === 'cancelled' ? statusMessage(body.status, before, clinic.clinicName) : null;
    if (body.notify && text && canMessage(before)) {
      messaged = await notifyPatient(tenantId, clinic.clinicName, before, 'cancelled', `cancelled@${dateOnly(before.appointmentDate)} ${before.appointmentTime}`, text);
    }
  } else if (body.action === 'reschedule') {
    if (before.status !== 'scheduled') throw new ConflictError(`A ${before.status} appointment can't be rescheduled.`);
    await service.reschedule(id, rescheduleAppointmentBodySchema.parse({ appointmentDate: body.date, appointmentTime: body.time, doctorId: body.doctorId }));
    const after = await loadRow(db, clinic.id, id);
    // Reset reminders for the new time; remember where it moved from.
    const log = sentLog(after.remindersSent);
    const keep = { token: log.token, source: log.source, confirmation: log.confirmation, rescheduledFrom: `${dateOnly(before.appointmentDate)} ${before.appointmentTime}` };
    await db.appointment.updateMany({ where: { id }, data: { remindersSent: keep } });
    if (body.notify && canMessage(before)) {
      messaged = await notifyPatient(
        tenantId,
        clinic.clinicName,
        after,
        'rescheduled',
        `rescheduled@${body.date} ${body.time}`,
        `Hi ${after.patientName || after.contact?.name || 'there'}, your appointment at *${clinic.clinicName}* has been moved. 📅\n\n🩺 ${drName(after.doctor?.doctorName)}\n📅 ${pretty(body.date)} · ${prettyTime(body.time)}\n🆔 ${after.detail?.appointmentRef ?? bookingRef(id)}\n\nReply here if this time doesn't work for you.`,
      );
    }
  } else if (body.action === 'edit') {
    await db.appointment.updateMany({ where: { id }, data: { patientName: body.name, patientAge: body.age || null, reasonForVisit: body.complaint || null } });
    if (!before.contact?.name) await db.contact.updateMany({ where: { id: before.contactId }, data: { name: body.name } });
    const detailData = {
      patientEmail: body.email || null,
      ...(body.gender !== undefined ? { patientGender: body.gender } : {}),
      ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
    };
    if (before.detail) await db.appointmentDetail.updateMany({ where: { appointmentId: id }, data: detailData });
    else await db.appointmentDetail.create({ data: { appointmentId: id, appointmentRef: bookingRef(id), patientPhone: before.contact?.phone ?? null, whatsappConsent: false, source: 'whatsapp', ...detailData } as never });
  } else {
    if (before.status !== 'scheduled') throw new ConflictError('Reminders can only be sent for scheduled appointments.');
    if (!canMessage(before)) throw new ConflictError("This patient hasn't agreed to WhatsApp messages or has no number.");
    messaged = await notifyPatient(
      tenantId,
      clinic.clinicName,
      before,
      'reminder',
      // Manual reminders may be repeated deliberately; one per minute at most.
      `manual@${new Date().toISOString().slice(0, 16)}`,
      `Hi ${before.patientName || before.contact?.name || 'there'}! ⏰ A reminder of your appointment at *${clinic.clinicName}*:\n\n🩺 ${drName(before.doctor?.doctorName)}\n📅 ${pretty(dateOnly(before.appointmentDate))} · ${prettyTime(before.appointmentTime)}\n🆔 ${before.detail?.appointmentRef ?? bookingRef(id)}\n\nReply here if you need to reschedule.`,
    );
    if (!messaged) throw new ConflictError('The reminder was not delivered. If the patient has not messaged in the last 24 hours, an approved "Appointment reminder" template is required — see Integrations → WhatsApp templates.');
    const log = sentLog(before.remindersSent);
    await db.appointment.updateMany({ where: { id }, data: { remindersSent: { ...log, manual_reminder: new Date().toISOString() } } });
  }

  appointmentsChanged(tenantId, { id, kind: body.action });
  return { row: toBoardRow(await loadRow(db, clinic.id, id)), messaged };
}


/**
 * Permanently deletes appointments and everything recorded for those visits.
 * The database cascades from Appointment to its consultation, prescription,
 * transcripts, details and notification logs; intakes and feedback keep their
 * rows but lose the link (they belong to the patient, see deletePatients).
 */
export async function deleteFromBoard(
  db: TenantDb,
  tenantId: string,
  ids: string[],
): Promise<{ deleted: string[]; blocked: Array<{ id: string; reason: string }>; consultationsDeleted: number }> {
  const clinic = await requireClinic(db);
  const rows = await db.appointment.findMany({ where: { id: { in: ids }, clinicId: clinic.id }, select: { id: true, consultation: { select: { id: true } } } });
  const found = new Set(rows.map((r) => r.id));
  const blocked: Array<{ id: string; reason: string }> = ids.filter((i) => !found.has(i)).map((id) => ({ id, reason: 'Appointment not found.' }));
  const deletable = rows.map((r) => r.id);
  if (deletable.length) {
    await db.appointment.deleteMany({ where: { id: { in: deletable }, clinicId: clinic.id } });
    appointmentsChanged(tenantId, { kind: 'deleted' });
  }
  return { deleted: deletable, blocked, consultationsDeleted: rows.filter((r) => r.consultation).length };
}

// ── consultation queue: manual status ───────────────────────────────

export const QUEUE_STATUSES = ['ready', 'in_progress', 'completed', 'no_show', 'cancelled'] as const;
export const queueStatusSchema = z.object({
  status: z.enum(QUEUE_STATUSES),
  /** Tell the patient on WhatsApp (only if they consented). */
  notify: z.boolean().default(true),
});

/**
 * Changes a patient's status from the consultation queue, from any status
 * except a completed consultation, and tells the patient on WhatsApp.
 *
 *  ready        on the schedule, waiting. From cancelled / no-show this
 *               reinstates the same slot (refused if someone else took it).
 *               Message: "your appointment is back on".
 *  in_progress  starts (or resumes) the consultation. Message: doctor is ready.
 *  completed    closes the visit; an open consultation is closed too (its draft
 *               prescription is not issued). Message: thank-you + feedback ask.
 *  no_show      marks it missed. Message: "we missed you" + rebooking link.
 *  cancelled    cancels; an open consultation is cancelled. Message: cancellation.
 *
 * Every change sends its own message (keyed per change, so changing back and
 * forth is never silently de-duplicated). Messages go through the notification
 * engine (24h window → text, else the approved template) and only to patients
 * who agreed to WhatsApp updates. The scheduled lifecycle engine is told the
 * completed / no-show step was handled so it does not send a second copy.
 */
export async function setQueueStatus(
  db: TenantDb,
  ctx: { tenantId: string; userId: string; role: string },
  id: string,
  body: z.infer<typeof queueStatusSchema>,
): Promise<{ status: (typeof QUEUE_STATUSES)[number]; messaged: boolean; notifiable: boolean }> {
  const clinic = await requireClinic(db);
  const before = await loadRow(db, clinic.id, id);
  const consult = await db.consultation.findFirst({ where: { appointmentId: id }, select: { id: true, status: true, startedAt: true } });
  const service = AppointmentService.create(db);
  const notifiable = canMessage(before);
  const date = dateOnly(before.appointmentDate);
  const slot = `${date} ${before.appointmentTime}`;
  const name = before.patientName || before.contact?.name || 'there';
  const consultOpen = consult?.status === 'in_progress';
  const consultDone = consult?.status === 'completed';
  // One key per change, so ready → cancelled → ready sends every message.
  const changeKey = (kind: string) => `${kind}@${slot}#${new Date().toISOString().slice(0, 16)}`;
  const send = (event: NotifyEvent, kind: string, text: string) =>
    body.notify && notifiable ? notifyPatient(ctx.tenantId, clinic.clinicName, before, event, changeKey(kind), text) : Promise.resolve(false);
  let messaged = false;

  if (consultDone && body.status !== 'completed') {
    throw new ConflictError('This consultation is completed and is part of the medical record, so its status can no longer change.');
  }

  const closeConsultation = async (status: 'completed' | 'cancelled') => {
    if (!consultOpen || !consult) return;
    const now = new Date();
    await db.consultation.updateMany({
      where: { id: consult.id, status: 'in_progress' },
      data: {
        status,
        completedAt: now,
        completedBy: ctx.userId,
        durationSec: Math.max(0, Math.round((now.getTime() - consult.startedAt.getTime()) / 1000)),
      },
    });
  };
  /** Back on the schedule; a cancelled draft consultation is kept for later. */
  const reinstate = async () => {
    if (before.status === 'scheduled') return false;
    await service.reinstate(id);
    // Completed / no-show markers from an earlier pass must not block a new one.
    const fresh = await db.appointment.findFirst({ where: { id }, select: { remindersSent: true } });
    const log = sentLog(fresh?.remindersSent);
    delete log.no_show;
    delete log.completed;
    await db.appointment.updateMany({ where: { id }, data: { remindersSent: log as Prisma.InputJsonObject } });
    return true;
  };
  /** Records the lifecycle step as handled here, so the scheduler sends no duplicate. */
  const markLifecycle = async (step: 'completed' | 'no_show') => {
    const fresh = await db.appointment.findFirst({ where: { id }, select: { remindersSent: true } });
    await db.appointment.updateMany({
      where: { id },
      data: { remindersSent: { ...sentLog(fresh?.remindersSent), [step]: new Date().toISOString(), [`${step}_by`]: body.notify ? 'staff' : 'staff_silent' } },
    });
  };
  const lifecycleText = async (step: 'completed' | 'no_show') => {
    const { messageFor } = await import('./appointment-lifecycle');
    const { bookingSlugFor } = await import('./booking-slug');
    const site = publicSiteUrl();
    const token = sentLog(before.remindersSent).token;
    return messageFor(step, {
      patient: before.patientName || before.contact?.name || '',
      clinic: clinic.clinicName,
      doctor: before.doctor?.doctorName ?? null,
      date: before.appointmentDate,
      time: before.appointmentTime,
      token: typeof token === 'number' ? token : undefined,
      link: site ? `${site}/book/${await bookingSlugFor(clinic.id)}` : '',
    });
  };
  const ref = before.detail?.appointmentRef ?? bookingRef(id);
  const backOnText = `Hi ${name}, your appointment at *${clinic.clinicName}* is back on. ✅\n\n🩺 ${drName(before.doctor?.doctorName) || 'Consultation'}\n📅 ${pretty(date)} · ${prettyTime(before.appointmentTime)}\n🆔 ${ref}\n\nReply here if you need to change it.`;

  switch (body.status) {
    case 'ready': {
      if (consultOpen) throw new ConflictError('The consultation is in progress. Complete or cancel it instead.');
      if (await reinstate()) messaged = await send('reinstated', 'reinstated', backOnText);
      break;
    }
    case 'in_progress': {
      const reinstated = await reinstate();
      const { startConsultation } = await import('./consultation.service');
      await startConsultation(db, ctx as never, id);
      if (!consultOpen) {
        messaged = await send(
          'doctor_ready',
          'called',
          `Hi ${name}, ${drName(before.doctor?.doctorName) || 'the doctor'} is ready to see you now at *${clinic.clinicName}*. 🩺\n\nPlease proceed to the consultation room.${reinstated ? `\n🆔 ${ref}` : ''}`,
        );
      }
      break;
    }
    case 'completed': {
      if (before.status === 'completed') break;
      await reinstate();
      await closeConsultation('completed');
      await service.setStatus(id, { status: 'completed' });
      await markLifecycle('completed');
      messaged = await send('completed', 'completed', await lifecycleText('completed'));
      if (messaged) await db.appointment.updateMany({ where: { id }, data: { feedbackSent: true } });
      break;
    }
    case 'no_show': {
      if (consultOpen) throw new ConflictError('The patient is being seen, so this cannot be marked as a no-show.');
      if (before.status === 'cancelled') await reinstate();
      if (before.status !== 'no_show') await service.setStatus(id, { status: 'no_show' });
      await markLifecycle('no_show');
      messaged = await send('no_show', 'no_show', await lifecycleText('no_show'));
      break;
    }
    case 'cancelled': {
      await closeConsultation('cancelled');
      if (before.status === 'cancelled') break;
      if (before.status === 'completed') throw new ConflictError('A completed appointment cannot be cancelled.');
      await service.setStatus(id, { status: 'cancelled' });
      const text = statusMessage('cancelled', before, clinic.clinicName);
      if (text) messaged = await send('cancelled', 'cancelled', text);
      break;
    }
  }

  appointmentsChanged(ctx.tenantId, { id, kind: `queue_${body.status}` });
  return { status: body.status, messaged, notifiable };
}