/**
 * Smart consultation: queue, workspace, autosave, AI dictation, finalize.
 *
 * Clinical-safety rules enforced server-side (not just in the UI):
 *  - AI output is a *suggestion*: stored with the verbatim transcript,
 *    every medicine/diagnosis from AI or a template is `verified: false`,
 *    and finalize refuses while anything is unverified.
 *  - The doctor's signature is drawn only on finalize, after explicit
 *    approval, by a user allowed to sign.
 *  - A finalized prescription is immutable: its snapshot + PDF + SHA-256
 *    are frozen; later branding changes never alter it.
 */

import { publicSiteUrl } from '../site-origin';
import crypto from 'node:crypto';
import { z } from 'zod';

import type { Prisma } from '@prisma/client';

import { callLLM, parseJSONFromLLM } from '@/lib/ai/llm';
import {
  autoQuantity,
  bmi,
  checkFinalize,
  flagAgainstTranscript,
  newId,
  prescriptionNumber,
  spokenNumbers,
  type Advice,
  type ChiefComplaint,
  type Diagnosis,
  type MedicineLine,
  type Vitals,
} from '@/lib/healthcare/prescription';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type AuthContext, type TenantDb } from '../kernel';
import { CLINIC_TIME_ZONE } from './appointment.service';
import { appointmentsChanged } from './appointment-board.service';
import { todayIn } from './availability';
import { bookingRef } from './booking-notify';
import { renderPrescriptionPdf, type RxImages, type RxSnapshot } from './prescription-pdf';

// ── access control ───────────────────────────────────────────────────

/** Front-desk roles may see the queue but not write clinical records or sign. */
const NON_CLINICAL = new Set(['receptionist', 'support']);
const CANNOT_SIGN = new Set(['receptionist', 'support', 'staff']);

export function assertClinical(ctx: Pick<AuthContext, 'role'>) {
  if (NON_CLINICAL.has(ctx.role)) throw new ForbiddenError('Only doctors and clinical staff can edit consultations.');
}
export function assertCanSign(ctx: Pick<AuthContext, 'role'>) {
  if (CANNOT_SIGN.has(ctx.role)) throw new ForbiddenError('Only a doctor (or clinic admin) can finalize and sign prescriptions.');
}

// ── schemas ──────────────────────────────────────────────────────────

const medicineSchema = z.object({
  id: z.string().max(40),
  name: z.string().trim().max(160).default(''),
  genericName: z.string().trim().max(160).optional(),
  brandName: z.string().trim().max(160).optional(),
  strength: z.string().trim().max(60).optional(),
  dosage: z.string().trim().max(60).optional(),
  route: z.string().trim().max(40).optional(),
  frequency: z.string().trim().max(80).optional(),
  timing: z.string().trim().max(60).optional(),
  duration: z.string().trim().max(60).optional(),
  quantity: z.string().trim().max(60).optional(),
  instructions: z.string().trim().max(500).optional(),
  source: z.enum(['ai', 'manual', 'catalog', 'template']).default('manual'),
  verified: z.boolean().default(false),
  flags: z.array(z.string().max(300)).max(20).default([]),
});
const diagnosisSchema = z.object({
  id: z.string().max(40),
  text: z.string().trim().max(300),
  code: z.string().trim().max(20).optional(),
  source: z.enum(['ai', 'manual', 'catalog', 'template']).default('manual'),
  verified: z.boolean().default(false),
});
const text = (n: number) => z.string().trim().max(n).optional();

export const autosaveSchema = z.object({
  revision: z.number().int().min(0),
  chiefComplaint: z.object({ complaint: text(500), symptoms: text(1000), duration: text(120), severity: text(60), notes: text(2000) }).partial().optional(),
  vitals: z.object({ bp: text(20), pulse: text(10), temperature: text(20), spo2: text(10), respiratoryRate: text(10), heightCm: text(10), weightKg: text(10), bmi: text(10) }).partial().optional(),
  history: z.object({ past: text(3000), surgical: text(2000), family: text(2000), allergies: text(1000), medications: text(2000), previousDiagnoses: text(2000) }).partial().optional(),
  examination: text(5000),
  diagnoses: z.array(diagnosisSchema).max(20).optional(),
  investigations: z.array(z.string().trim().max(200)).max(30).optional(),
  treatmentPlan: text(5000),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  medicines: z.array(medicineSchema).max(40).optional(),
  advice: z.object({ diet: text(1000), lifestyle: text(1000), precautions: text(1000), followUp: text(500), investigations: text(1000), general: text(2000) }).partial().optional(),
});
export type AutosaveBody = z.infer<typeof autosaveSchema>;

export const queueQuerySchema = z.object({
  tab: z.enum(['today', 'upcoming', 'waiting', 'in_progress', 'completed', 'all']).default('today'),
  doctorId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

// ── helpers ──────────────────────────────────────────────────────────

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asObject = <T extends object>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : ({} as T));
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const drTitle = (n?: string | null) => (n ? (/^dr\.?\s/i.test(n) ? n : `Dr. ${n}`) : '');

async function requireClinic(db: TenantDb) {
  const clinic = await db.clinic.findFirst({ select: { id: true, tenantId: true, clinicName: true, address: true, city: true, state: true, pincode: true, phone: true, email: true, website: true } });
  if (!clinic) throw new NotFoundError('Clinic', { details: { hint: 'Complete Business Setup first.' } });
  return clinic;
}

/** Creates the patient's medical profile on first use, with a per-tenant code. */
export async function ensurePatientProfile(db: TenantDb, tenantId: string, clinicId: string, contactId: string, seed: { gender?: string | null; age?: string | null } = {}) {
  const existing = await db.patientProfile.findFirst({ where: { contactId } });
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await db.patientProfile.count();
    const patientCode = `P-${String(count + 1 + attempt).padStart(6, '0')}`;
    try {
      return await db.patientProfile.create({
        data: {
          tenantId,
          clinicId,
          contactId,
          patientCode,
          gender: seed.gender ?? null,
          ageYears: seed.age && /^\d{1,3}$/.test(seed.age) ? Number(seed.age) : null,
        } as never,
      });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      const again = await db.patientProfile.findFirst({ where: { contactId } });
      if (again) return again;
    }
  }
  throw new ConflictError('Could not allocate a patient ID. Please retry.');
}

type ConsultStatus = 'waiting' | 'ready' | 'in_progress' | 'completed' | 'no_show' | 'cancelled';
function statusOf(a: { status: string; appointmentDate: Date; consultation: { status: string } | null }, today: string): ConsultStatus {
  if (a.status === 'cancelled') return 'cancelled';
  // A cancelled draft on a reinstated appointment: the patient is back in the queue.
  if (a.consultation?.status === 'completed') return 'completed';
  if (a.consultation?.status === 'in_progress') return 'in_progress';
  // Set manually from the queue or the appointments board, without a consultation.
  if (a.status === 'completed') return 'completed';
  if (a.status === 'no_show') return 'no_show';
  return dateOnly(a.appointmentDate) <= today ? 'ready' : 'waiting';
}

// ── queue ────────────────────────────────────────────────────────────

export async function consultationQueue(db: TenantDb, q: z.infer<typeof queueQuerySchema>) {
  const clinic = await requireClinic(db);
  const today = todayIn(CLINIC_TIME_ZONE);
  const todayDate = new Date(`${today}T00:00:00Z`);
  const and: Prisma.AppointmentWhereInput[] = [{ clinicId: clinic.id }];
  if (q.tab === 'today') and.push({ appointmentDate: todayDate, status: { not: 'cancelled' } });
  if (q.tab === 'upcoming') and.push({ appointmentDate: { gt: todayDate }, status: 'scheduled' });
  if (q.tab === 'waiting') and.push({ appointmentDate: { lte: todayDate }, status: 'scheduled', OR: [{ consultation: { is: null } }, { consultation: { is: { status: 'cancelled' } } }] });
  if (q.tab === 'in_progress') and.push({ consultation: { is: { status: 'in_progress' } } });
  if (q.tab === 'completed') and.push({ consultation: { is: { status: 'completed' } } });
  if (q.doctorId) and.push({ doctorId: q.doctorId });
  if (q.departmentId) and.push({ detail: { is: { departmentId: q.departmentId } } });
  if (q.from) and.push({ appointmentDate: { gte: new Date(`${q.from}T00:00:00Z`) } });
  if (q.to) and.push({ appointmentDate: { lte: new Date(`${q.to}T00:00:00Z`) } });
  if (q.search) {
    const s = q.search;
    and.push({
      OR: [
        { patientName: { contains: s } },
        { contact: { name: { contains: s } } },
        { contact: { phone: { contains: s.replace(/\D/g, '') || s } } },
        { contact: { patientProfile: { is: { patientCode: { contains: s.toUpperCase() } } } } },
        { detail: { is: { appointmentRef: { contains: s.toUpperCase() } } } },
      ],
    });
  }
  const where: Prisma.AppointmentWhereInput = { AND: and };
  const asc = q.tab !== 'completed' && q.tab !== 'all';
  const [total, rows, doctors, departments, todayRows, followUps] = await Promise.all([
    db.appointment.count({ where }),
    db.appointment.findMany({
      where,
      orderBy: [{ appointmentDate: asc ? 'asc' : 'desc' }, { appointmentTime: asc ? 'asc' : 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        contact: { select: { id: true, name: true, phone: true, patientProfile: { select: { patientCode: true, gender: true, ageYears: true } } } },
        doctor: { select: { id: true, doctorName: true, specialization: true } },
        detail: { select: { appointmentRef: true, patientGender: true, department: { select: { name: true } } } },
        consultation: { select: { id: true, status: true, startedAt: true, completedAt: true, durationSec: true, prescription: { select: { status: true, deliveryStatus: true, prescriptionNo: true } } } },
      },
    }),
    db.doctor.findMany({ where: { clinicId: clinic.id }, select: { id: true, doctorName: true }, orderBy: { doctorName: 'asc' } }),
    db.clinicDepartment.findMany({ where: { clinicId: clinic.id, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.appointment.findMany({ where: { clinicId: clinic.id, appointmentDate: todayDate, status: { not: 'cancelled' } }, select: { status: true, appointmentDate: true, consultation: { select: { status: true, durationSec: true } } } }),
    db.consultation.findMany({
      where: { status: 'completed', followUpDate: { gte: new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 864e5), lte: new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 864e5) } },
      select: { id: true, followUpDate: true, contactId: true, completedAt: true, contact: { select: { name: true, phone: true } }, doctor: { select: { doctorName: true } } },
      orderBy: { followUpDate: 'asc' },
      take: 20,
    }),
  ]);

  // A follow-up is "due" unless the patient already booked after the consultation.
  const later = followUps.length
    ? await db.appointment.findMany({ where: { contactId: { in: followUps.map((f) => f.contactId) }, status: 'scheduled', appointmentDate: { gte: todayDate } }, select: { contactId: true } })
    : [];
  const booked = new Set(later.map((l) => l.contactId));

  const pendingReview = await db.prescription.count({ where: { status: 'draft', consultation: { status: 'in_progress' } } });
  const durations = todayRows.map((r) => r.consultation?.durationSec).filter((d): d is number => typeof d === 'number');

  return {
    items: rows.map((a) => {
      const age = a.patientAge ?? (a.contact?.patientProfile?.ageYears != null ? String(a.contact.patientProfile.ageYears) : null);
      return {
        appointmentId: a.id,
        ref: a.detail?.appointmentRef ?? bookingRef(a.id),
        patient: {
          contactId: a.contactId,
          name: a.patientName || a.contact?.name || 'Patient',
          code: a.contact?.patientProfile?.patientCode ?? null,
          age,
          gender: a.detail?.patientGender ?? a.contact?.patientProfile?.gender ?? null,
          phone: a.contact?.phone ?? null,
        },
        doctor: a.doctor ? { id: a.doctor.id, name: a.doctor.doctorName } : null,
        department: a.detail?.department?.name ?? a.doctor?.specialization ?? null,
        date: dateOnly(a.appointmentDate),
        time: a.appointmentTime,
        type: a.reasonForVisit?.toLowerCase().includes('follow') ? 'Follow-up' : 'Consultation',
        status: statusOf(a, today),
        consultationId: a.consultation?.id ?? null,
        prescription: a.consultation?.prescription ?? null,
      };
    }),
    pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    stats: {
      today: todayRows.length,
      pending: todayRows.filter((r) => r.status === 'scheduled' && r.consultation?.status !== 'completed').length,
      inProgress: todayRows.filter((r) => r.consultation?.status === 'in_progress').length,
      completed: todayRows.filter((r) => r.consultation?.status === 'completed').length,
      pendingReview,
      avgMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60) : null,
    },
    followUps: followUps
      .filter((f) => !booked.has(f.contactId))
      .map((f) => ({ consultationId: f.id, contactId: f.contactId, name: f.contact?.name ?? 'Patient', phone: f.contact?.phone ?? null, doctor: f.doctor?.doctorName ?? null, date: f.followUpDate ? dateOnly(f.followUpDate) : null, overdue: Boolean(f.followUpDate && dateOnly(f.followUpDate) < today) })),
    doctors: doctors.map((d) => ({ id: d.id, name: d.doctorName })),
    departments,
    today,
  };
}

// ── start + workspace ────────────────────────────────────────────────

export async function startConsultation(db: TenantDb, ctx: AuthContext, appointmentId: string) {
  assertClinical(ctx);
  const clinic = await requireClinic(db);
  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, clinicId: clinic.id },
    include: { consultation: { select: { id: true, status: true } }, detail: { select: { patientGender: true } } },
  });
  if (!appt) throw new NotFoundError('Appointment');
  if (appt.consultation?.status === 'cancelled' && appt.status !== 'cancelled') {
    // Reinstated appointment: resume the earlier draft instead of losing its notes.
    await db.consultation.updateMany({ where: { id: appt.consultation.id, status: 'cancelled' }, data: { status: 'in_progress', completedAt: null, completedBy: null, durationSec: null } });
    appointmentsChanged(clinic.tenantId, { id: appointmentId, kind: 'consultation_started' });
    return { consultationId: appt.consultation.id, created: false };
  }
  if (appt.consultation) return { consultationId: appt.consultation.id, created: false };
  if (appt.status === 'cancelled') throw new ConflictError('This appointment was cancelled.');

  await ensurePatientProfile(db, clinic.tenantId, clinic.id, appt.contactId, { gender: appt.detail?.patientGender, age: appt.patientAge });
  // Last recorded height carries over (dated in the UI); vitals are never copied silently otherwise.
  const prev = await db.consultation.findFirst({ where: { contactId: appt.contactId, status: 'completed' }, orderBy: { completedAt: 'desc' }, select: { vitals: true } });
  const prevVitals = asObject<Vitals>(prev?.vitals);

  try {
    const created = await db.consultation.create({
      data: {
        tenantId: clinic.tenantId,
        clinicId: clinic.id,
        appointmentId,
        contactId: appt.contactId,
        doctorId: appt.doctorId,
        status: 'in_progress',
        startedBy: ctx.userId,
        chiefComplaint: { complaint: appt.reasonForVisit ?? '' } as Prisma.InputJsonValue,
        vitals: (prevVitals.heightCm ? { heightCm: prevVitals.heightCm } : {}) as Prisma.InputJsonValue,
        prescription: {
          create: {
            tenantId: clinic.tenantId,
            clinicId: clinic.id,
            contactId: appt.contactId,
            doctorId: appt.doctorId,
            prescriptionNo: `DRAFT-${crypto.randomBytes(6).toString('hex')}`,
            status: 'draft',
            medicines: [] as Prisma.InputJsonValue,
            advice: {} as Prisma.InputJsonValue,
          },
        },
      } as never,
      select: { id: true },
    });
    appointmentsChanged(clinic.tenantId, { id: appointmentId, kind: 'consultation_started' });
    return { consultationId: created.id, created: true };
  } catch (e) {
    // Two clicks at once: return the one that won.
    if ((e as { code?: string }).code === 'P2002') {
      const c = await db.consultation.findFirst({ where: { appointmentId }, select: { id: true } });
      if (c) return { consultationId: c.id, created: false };
    }
    throw e;
  }
}

export async function consultationWorkspace(db: TenantDb, consultationId: string) {
  const c = await db.consultation.findFirst({
    where: { id: consultationId },
    include: {
      appointment: { select: { id: true, appointmentDate: true, appointmentTime: true, patientName: true, patientAge: true, reasonForVisit: true, status: true, detail: { select: { appointmentRef: true, patientGender: true, whatsappConsent: true, patientPhone: true, department: { select: { name: true } } } } } },
      contact: { select: { id: true, name: true, phone: true, email: true } },
      doctor: { select: { id: true, doctorName: true, qualification: true, specialization: true, detail: { select: { registrationNumber: true, signatureMime: true } } } },
      prescription: { select: { id: true, prescriptionNo: true, status: true, medicines: true, advice: true, finalizedAt: true, deliveryStatus: true, deliveryError: true, sentAt: true, deliveredAt: true, readAt: true } },
      transcripts: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, source: true, originalText: true, editedText: true, createdAt: true, audioSeconds: true } },
    },
  });
  if (!c) throw new NotFoundError('Consultation');
  const [profile, history, templates] = await Promise.all([
    db.patientProfile.findFirst({ where: { contactId: c.contactId } }),
    db.consultation.findMany({
      where: { contactId: c.contactId, id: { not: c.id }, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 10,
      select: { id: true, completedAt: true, chiefComplaint: true, diagnoses: true, vitals: true, doctor: { select: { doctorName: true } }, prescription: { select: { id: true, prescriptionNo: true, medicines: true, finalizedAt: true } } },
    }),
    db.prescriptionTemplate.findMany({ where: { OR: [{ doctorId: c.doctorId }, { doctorId: null }] }, orderBy: { name: 'asc' }, select: { id: true, name: true, medicines: true, advice: true } }),
  ]);

  const detail = c.appointment.detail;
  const consent = !detail || detail.whatsappConsent;
  const medicines = asArray<MedicineLine>(c.prescription?.medicines);
  const diagnoses = asArray<Diagnosis>(c.diagnoses);
  const alerts: Array<{ level: 'danger' | 'warning' | 'info'; text: string }> = [];
  if (profile?.allergies?.trim()) alerts.push({ level: 'danger', text: `Allergies: ${profile.allergies}` });
  if (!profile?.allergies?.trim()) alerts.push({ level: 'info', text: 'Allergies not recorded — ask and note them.' });
  if (!c.contact?.phone) alerts.push({ level: 'warning', text: 'No phone number on file — the prescription cannot be sent on WhatsApp.' });
  else if (!consent) alerts.push({ level: 'warning', text: 'Patient has not agreed to WhatsApp updates — the prescription will not be sent automatically.' });
  if (detail?.patientPhone && c.contact?.phone && detail.patientPhone.replace(/\D/g, '') !== c.contact.phone.replace(/\D/g, '')) alerts.push({ level: 'warning', text: 'Booking phone differs from the patient record — verify before sending.' });
  const unverified = medicines.filter((m) => !m.verified).length + diagnoses.filter((d) => !d.verified).length;
  if (unverified) alerts.push({ level: 'warning', text: `${unverified} AI/template field(s) still need your confirmation.` });
  if (!c.doctor) alerts.push({ level: 'warning', text: 'No doctor assigned to this appointment.' });

  return {
    id: c.id,
    status: c.status,
    revision: c.revision,
    startedAt: c.startedAt.toISOString(),
    completedAt: c.completedAt?.toISOString() ?? null,
    appointment: {
      id: c.appointment.id,
      ref: detail?.appointmentRef ?? bookingRef(c.appointment.id),
      date: dateOnly(c.appointment.appointmentDate),
      time: c.appointment.appointmentTime,
      department: detail?.department?.name ?? c.doctor?.specialization ?? null,
    },
    patient: {
      contactId: c.contactId,
      name: c.appointment.patientName || c.contact?.name || 'Patient',
      code: profile?.patientCode ?? null,
      age: c.appointment.patientAge ?? (profile?.ageYears != null ? String(profile.ageYears) : null),
      gender: detail?.patientGender ?? profile?.gender ?? null,
      phone: c.contact?.phone ?? null,
      email: c.contact?.email ?? null,
      bloodGroup: profile?.bloodGroup ?? null,
      allergies: profile?.allergies ?? null,
      conditions: profile?.conditions ?? null,
      medications: profile?.medications ?? null,
      whatsappConsent: consent,
    },
    doctor: c.doctor ? { id: c.doctor.id, name: c.doctor.doctorName, qualification: c.doctor.qualification, specialization: c.doctor.specialization, registrationNo: c.doctor.detail?.registrationNumber ?? null, hasSignature: Boolean(c.doctor.detail?.signatureMime) } : null,
    chiefComplaint: asObject<ChiefComplaint>(c.chiefComplaint),
    vitals: asObject<Vitals>(c.vitals),
    history: asObject<Record<string, string>>(c.history),
    examination: c.examination ?? '',
    diagnoses,
    investigations: asArray<string>(c.investigations),
    treatmentPlan: c.treatmentPlan ?? '',
    followUpDate: c.followUpDate ? dateOnly(c.followUpDate) : null,
    prescription: c.prescription
      ? { ...c.prescription, medicines, advice: asObject<Advice>(c.prescription.advice), finalizedAt: c.prescription.finalizedAt?.toISOString() ?? null, number: c.prescription.status === 'finalized' ? c.prescription.prescriptionNo : null }
      : null,
    transcripts: c.transcripts.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    previous: history.map((h) => ({
      id: h.id,
      date: h.completedAt?.toISOString() ?? null,
      doctor: h.doctor?.doctorName ?? null,
      complaint: asObject<ChiefComplaint>(h.chiefComplaint).complaint ?? '',
      diagnoses: asArray<Diagnosis>(h.diagnoses).map((d) => d.text),
      vitals: asObject<Vitals>(h.vitals),
      prescription: h.prescription ? { id: h.prescription.id, number: h.prescription.prescriptionNo, medicines: asArray<MedicineLine>(h.prescription.medicines).map((m) => [m.name, m.strength].filter(Boolean).join(' ')), date: h.prescription.finalizedAt?.toISOString() ?? null } : null,
    })),
    templates: templates.map((t) => ({ id: t.id, name: t.name, medicines: asArray<MedicineLine>(t.medicines), advice: asObject<Advice>(t.advice) })),
    alerts,
  };
}

// ── autosave ─────────────────────────────────────────────────────────

export async function autosaveConsultation(db: TenantDb, ctx: AuthContext, consultationId: string, body: AutosaveBody) {
  assertClinical(ctx);
  const c = await db.consultation.findFirst({ where: { id: consultationId }, select: { id: true, status: true, revision: true, prescription: { select: { id: true, status: true } } } });
  if (!c) throw new NotFoundError('Consultation');
  if (c.status !== 'in_progress' || c.prescription?.status === 'finalized') throw new ConflictError('This consultation is finalized and can no longer be edited.');
  if (body.revision !== c.revision) throw new ConflictError('This consultation was changed in another window. Reload to get the latest version.', { details: { revision: c.revision } });

  const vitals = body.vitals ? { ...body.vitals, bmi: bmi(body.vitals.heightCm, body.vitals.weightKg) ?? body.vitals.bmi } : undefined;
  const medicines = body.medicines?.map((m) => ({ ...m, quantity: m.quantity || autoQuantity(m) || '' }));

  const updated = await db.consultation.updateMany({
    where: { id: consultationId, revision: c.revision },
    data: {
      revision: { increment: 1 },
      ...(body.chiefComplaint ? { chiefComplaint: body.chiefComplaint as Prisma.InputJsonValue } : {}),
      ...(vitals ? { vitals: vitals as Prisma.InputJsonValue } : {}),
      ...(body.history ? { history: body.history as Prisma.InputJsonValue } : {}),
      ...(body.examination !== undefined ? { examination: body.examination } : {}),
      ...(body.diagnoses ? { diagnoses: body.diagnoses as unknown as Prisma.InputJsonValue } : {}),
      ...(body.investigations ? { investigations: body.investigations as Prisma.InputJsonValue } : {}),
      ...(body.treatmentPlan !== undefined ? { treatmentPlan: body.treatmentPlan } : {}),
      ...(body.followUpDate !== undefined ? { followUpDate: body.followUpDate ? new Date(`${body.followUpDate}T00:00:00Z`) : null } : {}),
    },
  });
  if (!updated.count) throw new ConflictError('This consultation was changed in another window. Reload to get the latest version.');
  if (c.prescription && (medicines || body.advice)) {
    await db.prescription.updateMany({
      where: { id: c.prescription.id, status: 'draft' },
      data: { ...(medicines ? { medicines: medicines as unknown as Prisma.InputJsonValue } : {}), ...(body.advice ? { advice: body.advice as Prisma.InputJsonValue } : {}) },
    });
  }
  return { revision: c.revision + 1, savedAt: new Date().toISOString(), medicines, bmi: vitals?.bmi ?? null };
}

// ── AI dictation ─────────────────────────────────────────────────────

/** Verbatim speech-to-text of a dictation clip (Gemini audio input). */
export async function transcribeAudio(input: { audioBase64: string; mimeType: string }): Promise<{ text: string; model: string }> {
  if (input.audioBase64.length > 14_000_000) throw new ValidationError('Recording is too long. Please dictate in shorter parts (up to ~8 minutes).');
  const res = await callLLM(
    `Transcribe this doctor's clinical dictation VERBATIM.
Rules:
- Write exactly what is said, in the language spoken. The doctor may speak Hindi, Marathi, English or a mix; write non-English speech in its own script and drug names in Roman letters.
- Do not summarise, correct, translate drug names, or add anything.
- Keep medicine names, numbers, units and frequencies exactly as spoken.
- If a word is unclear, write it as [unclear: best guess].
- Output plain text only.`,
    { attachments: [{ mimeType: input.mimeType.split(';')[0], data: input.audioBase64 }], maxTokens: 2500, temperature: 0, geminiOnly: true },
  );
  if (!res.success || !res.text.trim()) throw new ValidationError('Could not transcribe the recording. Please try again or type the dictation.');
  return { text: res.text.trim(), model: 'gemini' };
}

const extractionSchema = z.object({
  chiefComplaint: z.object({ complaint: z.string().optional(), symptoms: z.string().optional(), duration: z.string().optional(), severity: z.string().optional() }).partial().optional(),
  vitals: z.record(z.string(), z.unknown()).optional(),
  diagnoses: z.array(z.object({ text: z.string(), code: z.string().optional() })).optional(),
  medicines: z
    .array(
      z.object({
        name: z.string().default(''),
        genericName: z.string().optional(),
        brandName: z.string().optional(),
        strength: z.string().optional(),
        dosage: z.string().optional(),
        route: z.string().optional(),
        frequency: z.string().optional(),
        timing: z.string().optional(),
        duration: z.string().optional(),
        quantity: z.string().optional(),
        instructions: z.string().optional(),
        unclear: z.boolean().optional(),
      }),
    )
    .optional(),
  investigations: z.array(z.string()).optional(),
  advice: z.object({ diet: z.string().optional(), lifestyle: z.string().optional(), precautions: z.string().optional(), followUp: z.string().optional(), general: z.string().optional() }).partial().optional(),
  followUpInDays: z.number().int().min(0).max(365).nullable().optional(),
  treatmentPlan: z.string().optional(),
  examination: z.string().optional(),
});

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');


/** Prompt for structuring a dictation (exported for tests). */
export function buildExtractionPrompt(transcript: string): string {
  return `You structure a doctor's dictated clinical note into JSON for a prescription form.
STRICT RULES:
- Use ONLY what the doctor said. Never add, infer, suggest or "complete" a medicine, dose, strength, frequency, duration, route or diagnosis that was not stated.
- Keep medicine names exactly as spoken. Do NOT correct spellings or swap brands/generics. If a name or value sounds unclear, keep it and set "unclear": true.
- Leave a field empty when it was not stated. Do not compute quantities unless the doctor said them.
- The dictation may be in any language (Hindi, Marathi, Hinglish, etc.). Write every field value in English, but keep drug names as spoken, in Roman letters.
- Frequency in plain words as said (e.g. "Twice daily", "1-0-1", "SOS"). Timing like "After food" only if said.
Return JSON:
{"chiefComplaint":{"complaint":"","symptoms":"","duration":"","severity":""},
 "vitals":{"bp":"","pulse":"","temperature":"","spo2":"","respiratoryRate":"","heightCm":"","weightKg":""},
 "diagnoses":[{"text":"","code":""}],
 "medicines":[{"name":"","genericName":"","brandName":"","strength":"","dosage":"","route":"","frequency":"","timing":"","duration":"","quantity":"","instructions":"","unclear":false}],
 "investigations":[""],
 "advice":{"diet":"","lifestyle":"","precautions":"","followUp":"","general":""},
 "followUpInDays":null,
 "treatmentPlan":"",
 "examination":""}
(examination: only findings the doctor actually dictated.)
Dictation:
"""${transcript.slice(0, 8000)}"""`;
}

/**
 * Presentation-only tidy of a dictated line (after the safety flags were
 * computed against the original words): spoken numbers become digits,
 * timing that repeats the frequency is dropped, and solid/liquid oral forms
 * get route "Oral". Nothing clinical is added, and the line stays
 * unverified until the doctor confirms it.
 */
function tidyLine(m: MedicineLine): MedicineLine {
  const dosage = spokenNumbers(m.dosage);
  const timing = m.timing && m.frequency && m.frequency.toLowerCase().includes(m.timing.toLowerCase()) ? undefined : m.timing;
  const oral = !m.route && /\b(tab|tablet|tablets|cap|capsule|capsules|syrup|suspension|sachet|drops?)\b|\bml\b/i.test(`${dosage ?? ''} ${m.name}`) && !/eye|ear|nasal/i.test(`${m.name} ${m.instructions ?? ''}`);
  return { ...m, dosage, duration: spokenNumbers(m.duration), quantity: spokenNumbers(m.quantity), timing, route: m.route || (oral ? 'Oral' : undefined) };
}

/** Parses the model output into UNVERIFIED suggestions, flagged against the transcript. */
export function parseExtraction(raw: string, transcript: string, opts?: { draft?: boolean; allergies?: string | null }) {
  const json = parseJSONFromLLM<unknown>(raw);
  if (!json || typeof json !== 'object') return null;
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) return null;
  const out = parsed.data;

  // Draft mode (suggested from a chief complaint): nothing was dictated, so flag every line for review instead of comparing with a transcript.
  const flagFn = (lines: MedicineLine[], t: string): MedicineLine[] =>
    opts?.draft
      ? lines.map((l) => {
          const flags = [...l.flags, 'AI draft from the chief complaint — check the drug, dose and patient suitability before confirming.'];
          const allergyWords = (opts.allergies ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
          const label = `${l.name} ${l.genericName ?? ''}`.toLowerCase();
          if (allergyWords.some((w) => label.includes(w))) flags.push('Possible match with the patient\'s recorded allergies — do not prescribe unless you have checked.');
          return { ...l, source: 'ai' as const, verified: false, flags: [...new Set(flags)] };
        })
      : flagAgainstTranscript(lines, t);
  const medicines = flagFn(
    (out.medicines ?? [])
      .filter((m) => m.name || m.strength || m.frequency)
      .map((m) => ({
        id: newId(),
        name: m.name.trim(),
        genericName: m.genericName?.trim() || undefined,
        brandName: m.brandName?.trim() || undefined,
        strength: m.strength?.trim() || undefined,
        dosage: m.dosage?.trim() || undefined,
        route: m.route?.trim() || undefined,
        frequency: m.frequency?.trim() || undefined,
        timing: m.timing?.trim() || undefined,
        duration: m.duration?.trim() || undefined,
        quantity: m.quantity?.trim() || undefined,
        instructions: m.instructions?.trim() || undefined,
        source: 'ai' as const,
        verified: false,
        flags: m.unclear ? ['Unclear in the recording — verify.'] : [],
      })),
    transcript,
  ).map(tidyLine);
  const vitals = Object.fromEntries(Object.entries(out.vitals ?? {}).map(([k, v]) => [k, str(v)]).filter(([, v]) => v));
  const suggestion = {
    chiefComplaint: Object.fromEntries(Object.entries(out.chiefComplaint ?? {}).filter(([, v]) => v)),
    vitals,
    diagnoses: (out.diagnoses ?? []).filter((d) => d.text?.trim()).map((d) => ({ id: newId('d'), text: d.text.trim(), code: d.code?.trim() || undefined, source: 'ai' as const, verified: false })),
    medicines,
    investigations: (out.investigations ?? []).map((s) => s.trim()).filter(Boolean),
    advice: Object.fromEntries(Object.entries(out.advice ?? {}).filter(([, v]) => v)),
    followUpInDays: out.followUpInDays ?? null,
    treatmentPlan: out.treatmentPlan?.trim() || '',
    examination: out.examination?.trim() || '',
  };
  return suggestion;
}

/**
 * Structures a (doctor-edited) transcript into prescription fields. Every
 * value is a suggestion for review; nothing is applied to the record here.
 */
export async function extractFromTranscript(db: TenantDb, ctx: AuthContext, consultationId: string, input: { originalText: string; editedText?: string; source: 'voice' | 'typed'; audioSeconds?: number }) {
  assertClinical(ctx);
  const c = await db.consultation.findFirst({ where: { id: consultationId }, select: { id: true, tenantId: true, status: true } });
  if (!c) throw new NotFoundError('Consultation');
  if (c.status !== 'in_progress') throw new ConflictError('This consultation is finalized.');
  const transcript = (input.editedText ?? input.originalText).trim();
  if (transcript.length < 5) throw new ValidationError('The dictation is empty.');

  const res = await callLLM(buildExtractionPrompt(transcript), { jsonMode: true, maxTokens: 2500, temperature: 0, taskCriticality: 'critical' });
  if (!res.success) throw new ValidationError('The AI assistant is unavailable right now. You can still fill the prescription manually.');
  const suggestion = parseExtraction(res.text, transcript);
  if (!suggestion) throw new ValidationError('The AI could not structure this dictation. Please edit the text and try again.');

  const saved = await db.consultationTranscript.create({
    data: {
      tenantId: c.tenantId,
      consultationId,
      source: input.source,
      originalText: input.originalText.slice(0, 60000),
      editedText: input.editedText && input.editedText !== input.originalText ? input.editedText.slice(0, 60000) : null,
      aiOutput: suggestion as unknown as Prisma.InputJsonValue,
      model: 'gemini',
      audioSeconds: input.audioSeconds ?? null,
      createdBy: ctx.userId,
    } as never,
    select: { id: true },
  });
  return { transcriptId: saved.id, suggestion };
}

/** Prompt for drafting a prescription from the chief complaint alone (exported for tests). */
export function buildComplaintPrompt(input: { complaint: string; symptoms?: string; duration?: string; severity?: string; age?: string | null; gender?: string | null; allergies?: string | null; conditions?: string | null; medications?: string | null }): string {
  return `You help a licensed doctor DRAFT a prescription from a chief complaint. The doctor reviews and edits every line; nothing is applied automatically.
Patient: age ${input.age || 'unknown'}, sex ${input.gender || 'unknown'}.
Known allergies: ${input.allergies?.trim() || 'NOT RECORDED'}.
Known conditions: ${input.conditions?.trim() || 'none recorded'}.
Current medications: ${input.medications?.trim() || 'none recorded'}.
RULES:
- Use ONLY the complaint details given below. Never invent a symptom, fever, infection or any condition that the doctor did not state. If the text is not a real medical complaint (for example a test word, placeholder, random text or a single unclear word), return exactly {"insufficient": true} and nothing else.
- Draft a conservative, first-line regimen commonly used for this complaint, suitable for the patient's age and sex. Use generic names with standard strengths, doses, frequency and duration.
- NEVER include a drug the patient is allergic to, or one that conflicts with their conditions or current medications. If allergies are not recorded, choose broadly safe options and mention in advice.precautions that allergies must be checked.
- Prefer symptomatic care. Add an antibiotic only when the complaint clearly points to a bacterial infection. No controlled or sedative drugs.
- 0 to 4 medicines. If the complaint is vague, or describes an emergency or red-flag symptoms (chest pain, breathlessness, severe bleeding, stroke signs, etc.), return NO medicines and explain in treatmentPlan that the patient needs examination or urgent care.
- Diagnoses are provisional (add an ICD-10 code only if confident). Suggest investigations only when clearly useful. Do not invent vitals.
- Keep advice short and practical. Write everything in English.
Return JSON:
{"chiefComplaint":{"complaint":"","symptoms":"","duration":"","severity":""},
 "diagnoses":[{"text":"","code":""}],
 "medicines":[{"name":"","genericName":"","strength":"","dosage":"","route":"","frequency":"","timing":"","duration":"","quantity":"","instructions":""}],
 "investigations":[""],
 "advice":{"diet":"","lifestyle":"","precautions":"","followUp":"","general":""},
 "followUpInDays":null,
 "treatmentPlan":"",
 "examination":""}
- chiefComplaint: copy the complaint, and fill symptoms, duration and severity ONLY from what the doctor wrote. Leave a value empty when it was not stated.
- examination: do NOT invent findings. Write a short checklist of what to examine for this complaint, starting with "Suggested focused examination (record actual findings): ", for example the throat, chest and abdomen as relevant.
- treatmentPlan: a short plan in 2 to 3 sentences. advice: fill diet, lifestyle, precautions, followUp and general; use investigations only for notes that do not fit elsewhere.
Chief complaint (doctor's words):
"""${input.complaint.slice(0, 1000)}"""
Symptoms: ${input.symptoms?.trim() || 'not given'}
Duration: ${input.duration?.trim() || 'not given'}
Severity: ${input.severity?.trim() || 'not given'}`;
}

/**
 * Drafts the whole prescription from the chief complaint. The result is
 * only a suggestion: every line comes back unverified and flagged, and the
 * doctor must confirm each one before the prescription can be finalized.
 */
export async function suggestFromComplaint(db: TenantDb, ctx: AuthContext, consultationId: string, input: { complaint: string; symptoms?: string; duration?: string; severity?: string }) {
  assertClinical(ctx);
  const c = await db.consultation.findFirst({
    where: { id: consultationId },
    select: { id: true, tenantId: true, status: true, contactId: true, appointment: { select: { patientAge: true, detail: { select: { patientGender: true } } } } },
  });
  if (!c) throw new NotFoundError('Consultation');
  if (c.status !== 'in_progress') throw new ConflictError('This consultation is finalized.');
  const complaint = input.complaint.trim();
  if (complaint.length < 3) throw new ValidationError('Enter the chief complaint first.');

  const profile = await db.patientProfile.findFirst({ where: { contactId: c.contactId } });
  const res = await callLLM(
    buildComplaintPrompt({ complaint, symptoms: input.symptoms, duration: input.duration, severity: input.severity, age: c.appointment?.patientAge ? String(c.appointment.patientAge) : null, gender: c.appointment?.detail?.patientGender ?? null, allergies: profile?.allergies, conditions: profile?.conditions, medications: profile?.medications }),
    { jsonMode: true, maxTokens: 2500, temperature: 0.2, taskCriticality: 'critical' },
  );
  if (!res.success) throw new ValidationError('The AI assistant is unavailable right now. You can still fill the prescription manually.');
  const raw = parseJSONFromLLM<{ insufficient?: boolean }>(res.text);
  if (raw?.insufficient) throw new ValidationError('That does not look like a medical complaint. Describe the symptoms (for example: fever and sore throat for 3 days) and try again.');
  const suggestion = parseExtraction(res.text, complaint, { draft: true, allergies: profile?.allergies });
  if (!suggestion) throw new ValidationError('The AI could not draft a prescription for this complaint. Please add more detail and try again.');
  if (!suggestion.chiefComplaint.complaint) (suggestion.chiefComplaint as Record<string, string>).complaint = complaint;

  const saved = await db.consultationTranscript.create({
    data: {
      tenantId: c.tenantId,
      consultationId,
      source: 'typed',
      originalText: `[AI draft from chief complaint] ${complaint}`.slice(0, 60000),
      editedText: null,
      aiOutput: suggestion as unknown as Prisma.InputJsonValue,
      model: 'gemini',
      audioSeconds: null,
      createdBy: ctx.userId,
    } as never,
    select: { id: true },
  });
  return { transcriptId: saved.id, suggestion };
}
// ── PDF + finalize ───────────────────────────────────────────────────

async function buildSnapshot(db: TenantDb, consultationId: string, prescriptionNo: string, verifyUrl: string | null) {
  const clinic = await requireClinic(db);
  const ws = await consultationWorkspace(db, consultationId);
  const settings = await db.prescriptionSettings.findFirst({ where: { clinicId: clinic.id } });
  const doctorDetail = ws.doctor ? await db.doctorDetail.findFirst({ where: { doctorId: ws.doctor.id }, select: { designation: true, signature: true, signatureMime: true } }) : null;
  const snapshot: RxSnapshot = {
    prescriptionNo,
    date: todayIn(CLINIC_TIME_ZONE),
    generatedAt: new Date().toISOString(),
    clinic: {
      name: settings?.clinicName || clinic.clinicName,
      address: settings?.address || [clinic.address, clinic.city, clinic.state, clinic.pincode].filter(Boolean).join(', ') || null,
      phone: settings?.phone || clinic.phone,
      email: settings?.email || clinic.email,
      website: settings?.website || clinic.website,
      registrationNo: settings?.registrationNo ?? null,
      footerText: settings?.footerText ?? null,
      accentColor: settings?.accentColor ?? null,
    },
    doctor: {
      name: drTitle(ws.doctor?.name) || 'Doctor',
      qualification: ws.doctor?.qualification ?? null,
      specialization: ws.doctor?.specialization ?? null,
      registrationNo: ws.doctor?.registrationNo ?? null,
      // Avoid "Dentist | Dentist" when the department is the specialization.
      department: ws.appointment.department && ws.appointment.department.toLowerCase() !== (ws.doctor?.specialization ?? '').toLowerCase() ? ws.appointment.department : null,
      designation: doctorDetail?.designation ?? null,
    },
    patient: { name: ws.patient.name, patientCode: ws.patient.code, age: ws.patient.age, gender: ws.patient.gender ? ws.patient.gender.replace(/_/g, ' ') : null, phone: ws.patient.phone ? `+${ws.patient.phone.replace(/\D/g, '')}` : null },
    clinical: {
      chiefComplaint: [ws.chiefComplaint.complaint, ws.chiefComplaint.duration && `for ${ws.chiefComplaint.duration}`, ws.chiefComplaint.severity && `(${ws.chiefComplaint.severity})`].filter(Boolean).join(' ') || null,
      vitals: ws.vitals,
      diagnoses: ws.diagnoses.map((d) => {
        const t = d.text.charAt(0).toUpperCase() + d.text.slice(1);
        return d.code ? `${d.code} - ${t}` : t;
      }),
      findings: ws.examination || null,
      investigations: ws.investigations,
    },
    medicines: (ws.prescription?.medicines ?? []).map((m) => ({ name: m.name, genericName: m.genericName, strength: m.strength, dosage: m.dosage, route: m.route, frequency: m.frequency, timing: m.timing, duration: m.duration, quantity: m.quantity, instructions: m.instructions })),
    advice: { ...(ws.prescription?.advice ?? {}), ...(ws.treatmentPlan ? { general: [ws.prescription?.advice?.general, ws.treatmentPlan].filter(Boolean).join('\n') } : {}) },
    followUpDate: ws.followUpDate,
    verifyUrl,
  };
  const images: RxImages = {
    logo: settings?.logo ? { bytes: new Uint8Array(settings.logo), mime: settings.logoMime ?? 'image/png' } : null,
    stamp: settings?.stamp ? { bytes: new Uint8Array(settings.stamp), mime: settings.stampMime ?? 'image/png' } : null,
    signature: doctorDetail?.signature ? { bytes: new Uint8Array(doctorDetail.signature), mime: doctorDetail.signatureMime ?? 'image/png' } : null,
  };
  return { snapshot, images, ws, clinic };
}

/** Draft preview PDF (watermarked, never signed). */
export async function previewPdf(db: TenantDb, consultationId: string): Promise<Uint8Array> {
  const rx = await db.prescription.findFirst({ where: { consultationId }, select: { status: true, pdf: true } });
  if (rx?.status === 'finalized' && rx.pdf) return new Uint8Array(rx.pdf);
  const { snapshot, images } = await buildSnapshot(db, consultationId, 'DRAFT', null);
  return renderPrescriptionPdf(snapshot, { ...images, signature: null }, { final: false });
}

function siteUrl(): string {
  return publicSiteUrl();
}

export async function finalizeConsultation(db: TenantDb, ctx: AuthContext, consultationId: string, body: { doctorApproved: boolean; revision: number }, opts: { origin?: string } = {}) {
  assertCanSign(ctx);
  const c = await db.consultation.findFirst({ where: { id: consultationId }, select: { id: true, status: true, revision: true, startedAt: true, appointmentId: true, tenantId: true, contactId: true, prescription: { select: { id: true, status: true, prescriptionNo: true, verifyToken: true } } } });
  if (!c?.prescription) throw new NotFoundError('Consultation');
  if (c.prescription.status === 'finalized') throw new ConflictError('This prescription is already finalized.');
  // An amended prescription keeps its number and QR link; a first-time one gets new ones.
  const keptNo = c.prescription.prescriptionNo && !c.prescription.prescriptionNo.startsWith('DRAFT-') ? c.prescription.prescriptionNo : null;
  if (body.revision !== c.revision) throw new ConflictError('Unsaved changes: wait for autosave to finish, then finalize.', { details: { revision: c.revision } });

  const ws = await consultationWorkspace(db, consultationId);
  const check = checkFinalize({
    medicines: ws.prescription?.medicines ?? [],
    diagnoses: ws.diagnoses,
    chiefComplaint: ws.chiefComplaint,
    doctorApproved: body.doctorApproved,
    hasDoctor: Boolean(ws.doctor),
  });
  if (!check.ok) throw new ValidationError(check.issues[0], { details: { issues: check.issues } });

  // Per-tenant daily sequence; the unique index guards against races.
  const day = todayIn(CLINIC_TIME_ZONE);
  const verifyToken = (keptNo && c.prescription.verifyToken) || crypto.randomBytes(16).toString('hex');
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = keptNo ? 0 : await db.prescription.count({ where: { status: 'finalized', prescriptionNo: { startsWith: prescriptionNumber(day, 0).slice(0, 10) } } });
    const number = keptNo ?? prescriptionNumber(day, count + 1 + attempt);
    // The domain the doctor is using (resolved by the controller), else the configured site URL, for the QR link.
    const base = (opts.origin ?? '').replace(/\/$/, '') || siteUrl();
    const verifyUrl = base ? `${base}/verify/rx/${verifyToken}` : null;
    const { snapshot, images } = await buildSnapshot(db, consultationId, number, verifyUrl);
    const pdf = await renderPrescriptionPdf(snapshot, images, { final: true });
    const sha = crypto.createHash('sha256').update(pdf).digest('hex');
    const now = new Date();
    try {
      await db.$transaction(async (tx) => {
        const locked = await tx.prescription.updateMany({
          where: { id: c.prescription!.id, status: 'draft' },
          data: {
            status: 'finalized',
            prescriptionNo: number,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            pdf: Buffer.from(pdf),
            pdfSha256: sha,
            verifyToken,
            finalizedAt: now,
            finalizedBy: ctx.userId,
            deliveryStatus: 'pending',
          },
        });
        if (!locked.count) throw new ConflictError('This prescription was finalized by someone else.');
        await tx.consultation.updateMany({
          where: { id: consultationId },
          data: { status: 'completed', completedAt: now, completedBy: ctx.userId, durationSec: Math.max(0, Math.round((now.getTime() - c.startedAt.getTime()) / 1000)) },
        });
        await tx.appointment.updateMany({ where: { id: c.appointmentId, status: 'scheduled' }, data: { status: 'completed' } });
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') continue; // number taken — next sequence
      throw e;
    }
    // Remember custom medicines in the clinic catalog (never auto-selected).
    await rememberMedicines(db, c.tenantId, ws.prescription?.medicines ?? []).catch(() => undefined);
    appointmentsChanged(c.tenantId, { id: c.appointmentId, kind: 'consultation_completed' });
    return { prescriptionId: c.prescription.id, prescriptionNo: number, sha256: sha };
  }
  throw new ConflictError('Could not allocate a prescription number. Please retry.');
}

/**
 * Permanently deletes a consultation together with its visit: the
 * appointment row is removed and the database cascades to the consultation,
 * prescription (draft or finalized), transcripts, appointment details and
 * notification logs. Intakes and feedback stay with the patient.
 */
export async function discardConsultation(db: TenantDb, ctx: AuthContext, consultationId: string) {
  assertCanSign(ctx);
  const c = await db.consultation.findFirst({ where: { id: consultationId }, select: { id: true, appointmentId: true, tenantId: true } });
  if (!c) throw new NotFoundError('Consultation');
  const removed = await db.appointment.deleteMany({ where: { id: c.appointmentId } });
  // Appointment already gone: remove the orphan consultation directly.
  if (!removed.count) await db.consultation.deleteMany({ where: { id: consultationId } });
  appointmentsChanged(c.tenantId, { id: c.appointmentId, kind: 'deleted' });
  return { deleted: true, appointmentId: c.appointmentId };
}
/**
 * Re-opens a finalized prescription so the doctor can correct it. The record goes back to a
 * draft (same prescription number and QR link). Finalizing again re-signs it, builds a new PDF
 * and sends the corrected copy to the patient.
 */
export async function reopenConsultation(db: TenantDb, ctx: AuthContext, consultationId: string) {
  assertCanSign(ctx);
  const c = await db.consultation.findFirst({ where: { id: consultationId }, select: { id: true, appointmentId: true, tenantId: true, prescription: { select: { id: true, status: true } } } });
  if (!c?.prescription) throw new NotFoundError('Consultation');
  if (c.prescription.status !== 'finalized') throw new ConflictError('This prescription is not finalized, so it can already be edited.');
  await db.$transaction(async (tx) => {
    const moved = await tx.prescription.updateMany({
      where: { id: c.prescription!.id, status: 'finalized' },
      data: { status: 'draft', pdf: null, pdfSha256: null, finalizedAt: null, finalizedBy: null, deliveryStatus: 'not_sent', deliveryError: null, deliveryAttempts: 0, whatsappMessageId: null, mediaId: null, sentAt: null, deliveredAt: null, readAt: null },
    });
    if (!moved.count) throw new ConflictError('This prescription was already re-opened.');
    await tx.consultation.updateMany({
      where: { id: consultationId },
      data: { status: 'in_progress', completedAt: null, completedBy: null, durationSec: null, revision: { increment: 1 } },
    });
  });
  appointmentsChanged(c.tenantId, { id: c.appointmentId, kind: 'consultation_reopened' });
  return { consultationId, prescriptionId: c.prescription.id };
}

async function rememberMedicines(db: TenantDb, tenantId: string, medicines: MedicineLine[]) {
  for (const m of medicines) {
    const name = m.name.trim();
    if (!name) continue;
    const exists = await db.medicineCatalog.findFirst({ where: { name, strength: m.strength || null }, select: { id: true } });
    if (!exists) await db.medicineCatalog.create({ data: { tenantId, name, genericName: m.genericName || null, brandName: m.brandName || null, strength: m.strength || null } as never });
  }
}

// ── catalog & templates ──────────────────────────────────────────────

export async function searchMedicines(db: TenantDb, q: string) {
  const s = q.trim();
  return db.medicineCatalog.findMany({
    where: { isActive: true, ...(s ? { OR: [{ name: { contains: s } }, { genericName: { contains: s } }, { brandName: { contains: s } }] } : {}) },
    orderBy: { name: 'asc' },
    take: 20,
    select: { id: true, name: true, genericName: true, brandName: true, strength: true, form: true, units: true },
  });
}

export const catalogSchema = z.object({
  name: z.string().trim().min(2).max(160),
  genericName: z.string().trim().max(160).optional(),
  brandName: z.string().trim().max(160).optional(),
  strength: z.string().trim().max(60).optional(),
  form: z.string().trim().max(40).optional(),
  manufacturer: z.string().trim().max(160).optional(),
  units: z.string().trim().max(60).optional(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  doctorId: z.string().uuid().nullable().optional(),
  medicines: z.array(medicineSchema).max(40).default([]),
  advice: autosaveSchema.shape.advice.default({}),
});
