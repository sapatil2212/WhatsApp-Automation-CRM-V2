/**
 * Patient medical records: listing, profile, history, prescriptions,
 * documents (stored in the DB, served only through authenticated routes),
 * timeline and communication history. Everything runs on the tenant-scoped
 * client, so one clinic can never read another clinic's patients.
 */

import { z } from 'zod';

import type { Prisma } from '@prisma/client';

import type { ChiefComplaint, Diagnosis, MedicineLine, Vitals } from '@/lib/healthcare/prescription';
import { getLogger, NotFoundError, ValidationError, type AuthContext, type TenantDb } from '../kernel';
import { assertClinical, ensurePatientProfile } from './consultation.service';

const log = getLogger('patient-records');
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asObject = <T extends object>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : ({} as T));
const iso = (d?: Date | null) => d?.toISOString() ?? null;

async function requireClinic(db: TenantDb) {
  const clinic = await db.clinic.findFirst({ select: { id: true, tenantId: true } });
  if (!clinic) throw new NotFoundError('Clinic');
  return clinic;
}

export const patientListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  doctorId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** active = seen or booked in the last 6 months. */
  status: z.enum(['active', 'inactive']).optional(),
  allergies: z.enum(['yes']).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export async function listPatients(db: TenantDb, q: z.infer<typeof patientListSchema>) {
  const clinic = await requireClinic(db);
  const apptFilter: Prisma.AppointmentWhereInput = {
    clinicId: clinic.id,
    ...(q.doctorId ? { doctorId: q.doctorId } : {}),
    ...(q.departmentId ? { detail: { is: { departmentId: q.departmentId } } } : {}),
  };
  const and: Prisma.ContactWhereInput[] = [{ appointments: { some: apptFilter } }];
  if (q.search) {
    const s = q.search;
    and.push({ OR: [{ name: { contains: s } }, { phone: { contains: s.replace(/\D/g, '') || s } }, { patientProfile: { is: { patientCode: { contains: s.toUpperCase() } } } }] });
  }
  if (q.from) and.push({ createdAt: { gte: new Date(`${q.from}T00:00:00Z`) } });
  if (q.to) and.push({ createdAt: { lte: new Date(`${q.to}T23:59:59Z`) } });
  const activeSince = new Date(Date.now() - 180 * 864e5);
  const activeAppt: Prisma.AppointmentWhereInput = { clinicId: clinic.id, appointmentDate: { gte: activeSince } };
  if (q.status === 'active') and.push({ appointments: { some: activeAppt } });
  if (q.status === 'inactive') and.push({ appointments: { none: activeAppt } });
  if (q.allergies === 'yes') and.push({ patientProfile: { is: { allergies: { not: null }, NOT: { allergies: '' } } } });
  if (q.bloodGroup) and.push({ patientProfile: { is: { bloodGroup: q.bloodGroup } } });
  const where: Prisma.ContactWhereInput = { AND: and };
  const [total, rows, newThisMonth, withAllergies, active, upcomingToday] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
        patientProfile: { select: { patientCode: true, gender: true, ageYears: true, bloodGroup: true, allergies: true } },
        appointments: { where: { clinicId: clinic.id }, orderBy: [{ appointmentDate: 'desc' }], take: 1, select: { appointmentDate: true, patientAge: true, patientName: true, doctor: { select: { doctorName: true } }, detail: { select: { patientGender: true } } } },
        consultations: { where: { status: 'completed' }, orderBy: { completedAt: 'desc' }, take: 1, select: { completedAt: true } },
        _count: { select: { consultations: { where: { status: 'completed' } } } },
      },
    }),
    db.contact.count({ where: { appointments: { some: { clinicId: clinic.id } }, createdAt: { gte: new Date(Date.now() - 30 * 864e5) } } }),
    db.patientProfile.count({ where: { allergies: { not: null }, NOT: { allergies: '' } } }),
    db.contact.count({ where: { appointments: { some: activeAppt } } }),
    db.appointment.count({ where: { clinicId: clinic.id, status: 'scheduled', appointmentDate: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') } }),
  ]);
  const sixMonths = activeSince.getTime();
  return {
    items: rows.map((c) => {
      const last = c.appointments[0];
      return {
        contactId: c.id,
        code: c.patientProfile?.patientCode ?? null,
        name: last?.patientName || c.name || 'Patient',
        age: last?.patientAge ?? (c.patientProfile?.ageYears != null ? String(c.patientProfile.ageYears) : null),
        gender: c.patientProfile?.gender ?? last?.detail?.patientGender ?? null,
        phone: c.phone || null,
        bloodGroup: c.patientProfile?.bloodGroup ?? null,
        hasAllergies: Boolean(c.patientProfile?.allergies?.trim()),
        lastConsultation: iso(c.consultations[0]?.completedAt),
        totalConsultations: c._count.consultations,
        doctor: last?.doctor?.doctorName ?? null,
        status: last && last.appointmentDate.getTime() >= sixMonths ? 'active' : 'inactive',
        registeredAt: c.createdAt.toISOString(),
      };
    }),
    pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    stats: { total, newThisMonth, withAllergies, active, todayAppointments: upcomingToday },
  };
}

export async function patientRecord(db: TenantDb, contactId: string) {
  const clinic = await requireClinic(db);
  const contact = await db.contact.findFirst({
    where: { id: contactId, appointments: { some: { clinicId: clinic.id } } },
    select: { id: true, name: true, phone: true, email: true, createdAt: true },
  });
  if (!contact) throw new NotFoundError('Patient');
  const [profile, appointments, consultations, prescriptions, documents, intakes, comms] = await Promise.all([
    db.patientProfile.findFirst({ where: { contactId } }),
    db.appointment.findMany({ where: { contactId, clinicId: clinic.id }, orderBy: [{ appointmentDate: 'desc' }], take: 50, select: { id: true, appointmentDate: true, appointmentTime: true, status: true, createdAt: true, patientAge: true, patientName: true, doctor: { select: { doctorName: true } }, detail: { select: { appointmentRef: true, patientGender: true, whatsappConsent: true } } } }),
    db.consultation.findMany({
      where: { contactId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: { id: true, status: true, startedAt: true, completedAt: true, chiefComplaint: true, diagnoses: true, vitals: true, examination: true, treatmentPlan: true, investigations: true, followUpDate: true, appointmentId: true, doctor: { select: { doctorName: true, specialization: true } } },
    }),
    db.prescription.findMany({
      where: { contactId, status: 'finalized' },
      orderBy: { finalizedAt: 'desc' },
      select: { id: true, prescriptionNo: true, finalizedAt: true, medicines: true, advice: true, deliveryStatus: true, deliveryError: true, sentAt: true, deliveredAt: true, readAt: true, consultationId: true, doctor: { select: { doctorName: true } }, consultation: { select: { diagnoses: true } } },
    }),
    db.patientDocument.findMany({ where: { contactId, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, title: true, fileName: true, mimeType: true, size: true, createdAt: true, consultationId: true } }),
    db.patientIntake.findMany({ where: { contactId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, symptoms: true, allergies: true, currentMedications: true, medicalHistory: true, urgencyLevel: true, createdAt: true } }),
    db.appointmentNotificationLog.findMany({ where: { contactId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, eventType: true, channel: true, status: true, templateName: true, errorMessage: true, createdAt: true, sentAt: true } }),
  ]);
  const consent = appointments.find((a) => a.detail)?.detail?.whatsappConsent ?? true;

  // Timeline built from the records themselves (no separate event table to drift).
  const timeline: Array<{ at: string; kind: string; text: string }> = [{ at: contact.createdAt.toISOString(), kind: 'registered', text: 'Patient registered' }];
  for (const a of appointments) timeline.push({ at: a.createdAt.toISOString(), kind: 'appointment', text: `Appointment booked for ${a.appointmentDate.toISOString().slice(0, 10)} ${a.appointmentTime}${a.doctor ? ` with ${a.doctor.doctorName}` : ''}${a.status === 'cancelled' ? ' (cancelled)' : ''}` });
  for (const c of consultations) {
    timeline.push({ at: c.startedAt.toISOString(), kind: 'consultation', text: `Consultation started${c.doctor ? ` with ${c.doctor.doctorName}` : ''}` });
    const inv = asArray<string>(c.investigations);
    if (inv.length) timeline.push({ at: (c.completedAt ?? c.startedAt).toISOString(), kind: 'investigation', text: `Investigations ordered: ${inv.join(', ')}` });
    if (c.followUpDate) timeline.push({ at: (c.completedAt ?? c.startedAt).toISOString(), kind: 'followup', text: `Follow-up scheduled for ${c.followUpDate.toISOString().slice(0, 10)}` });
  }
  for (const p of prescriptions) {
    if (p.finalizedAt) timeline.push({ at: p.finalizedAt.toISOString(), kind: 'prescription', text: `Prescription ${p.prescriptionNo} generated` });
    if (p.sentAt) timeline.push({ at: p.sentAt.toISOString(), kind: 'prescription_sent', text: `Prescription ${p.prescriptionNo} sent on WhatsApp` });
  }
  for (const d of documents) timeline.push({ at: d.createdAt.toISOString(), kind: 'document', text: `Document uploaded: ${d.title}` });
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  const last = appointments[0];
  return {
    contactId,
    name: appointments[0]?.patientName || contact.name || 'Patient',
    phone: contact.phone || null,
    email: contact.email,
    whatsappConsent: consent,
    registeredAt: contact.createdAt.toISOString(),
    profile: profile
      ? { ...profile, dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? null, createdAt: undefined, updatedAt: profile.updatedAt.toISOString(), deletedAt: undefined }
      : null,
    age: last?.patientAge ?? (profile?.ageYears != null ? String(profile.ageYears) : null),
    gender: profile?.gender ?? last?.detail?.patientGender ?? null,
    consultations: consultations.map((c) => ({
      id: c.id,
      appointmentId: c.appointmentId,
      status: c.status,
      date: (c.completedAt ?? c.startedAt).toISOString(),
      doctor: c.doctor?.doctorName ?? null,
      department: c.doctor?.specialization ?? null,
      complaint: asObject<ChiefComplaint>(c.chiefComplaint).complaint ?? '',
      diagnoses: asArray<Diagnosis>(c.diagnoses).map((d) => (d.code ? `${d.code} ${d.text}` : d.text)),
      vitals: asObject<Vitals>(c.vitals),
      notes: c.examination ?? '',
      treatmentPlan: c.treatmentPlan ?? '',
      investigations: asArray<string>(c.investigations),
      followUpDate: c.followUpDate?.toISOString().slice(0, 10) ?? null,
    })),
    prescriptions: prescriptions.map((p) => ({
      id: p.id,
      number: p.prescriptionNo,
      date: iso(p.finalizedAt),
      doctor: p.doctor?.doctorName ?? null,
      diagnoses: asArray<Diagnosis>(p.consultation.diagnoses).map((d) => d.text),
      medicineCount: asArray<MedicineLine>(p.medicines).length,
      medicines: asArray<MedicineLine>(p.medicines).map((m) => ({ name: m.name, strength: m.strength ?? '', dosage: m.dosage ?? '', frequency: m.frequency ?? '', timing: m.timing ?? '', duration: m.duration ?? '', instructions: m.instructions ?? '' })),
      deliveryStatus: p.deliveryStatus,
      deliveryError: p.deliveryError,
      sentAt: iso(p.sentAt),
      deliveredAt: iso(p.deliveredAt),
      readAt: iso(p.readAt),
    })),
    investigations: consultations.flatMap((c) => asArray<string>(c.investigations).map((t) => ({ test: t, orderedAt: (c.completedAt ?? c.startedAt).toISOString(), doctor: c.doctor?.doctorName ?? null, consultationId: c.id }))),
    appointments: appointments.map((a) => ({
      id: a.id,
      ref: a.detail?.appointmentRef ?? null,
      date: a.appointmentDate.toISOString().slice(0, 10),
      time: a.appointmentTime,
      status: a.status,
      doctor: a.doctor?.doctorName ?? null,
    })),
    nextAppointment: (() => {
      const today = new Date().toISOString().slice(0, 10);
      const next = [...appointments]
        .filter((a) => a.status === 'scheduled' && a.appointmentDate.toISOString().slice(0, 10) >= today)
        .sort((x, y) => `${x.appointmentDate.toISOString()} ${x.appointmentTime}`.localeCompare(`${y.appointmentDate.toISOString()} ${y.appointmentTime}`))[0];
      return next ? { id: next.id, date: next.appointmentDate.toISOString().slice(0, 10), time: next.appointmentTime, doctor: next.doctor?.doctorName ?? null } : null;
    })(),
    /** Problem list: every diagnosis across completed consultations, most recent first. */
    problems: (() => {
      const map = new Map<string, { label: string; count: number; first: string; last: string }>();
      for (const c of consultations) {
        if (c.status !== 'completed') continue;
        const when = (c.completedAt ?? c.startedAt).toISOString();
        for (const d of asArray<Diagnosis>(c.diagnoses)) {
          const label = d.code ? `${d.code} ${d.text}` : d.text;
          if (!label?.trim()) continue;
          const key = (d.code || d.text).toLowerCase();
          const cur = map.get(key);
          if (!cur) map.set(key, { label, count: 1, first: when, last: when });
          else {
            cur.count += 1;
            if (when < cur.first) cur.first = when;
            if (when > cur.last) cur.last = when;
          }
        }
      }
      return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
    })(),    documents: documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
    intakes: intakes.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    communications: comms.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), sentAt: iso(c.sentAt) })),
    timeline,
  };
}

export const profileSchema = z.object({
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ageYears: z.number().int().min(0).max(130).nullable().optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional(),
  allergies: z.string().trim().max(1000).nullable().optional(),
  conditions: z.string().trim().max(2000).nullable().optional(),
  medications: z.string().trim().max(2000).nullable().optional(),
  surgicalHistory: z.string().trim().max(2000).nullable().optional(),
  familyHistory: z.string().trim().max(2000).nullable().optional(),
  emergencyName: z.string().trim().max(120).nullable().optional(),
  emergencyPhone: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export async function updatePatientProfile(db: TenantDb, ctx: AuthContext, contactId: string, body: z.infer<typeof profileSchema>) {
  assertClinical(ctx);
  const clinic = await requireClinic(db);
  const contact = await db.contact.findFirst({ where: { id: contactId, appointments: { some: { clinicId: clinic.id } } }, select: { id: true } });
  if (!contact) throw new NotFoundError('Patient');
  const profile = await ensurePatientProfile(db, clinic.tenantId, clinic.id, contactId);
  const { dateOfBirth, ...rest } = body;
  await db.patientProfile.updateMany({
    where: { id: profile.id },
    data: { ...rest, ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00Z`) : null } : {}) },
  });
  log.info('patient.profile.updated', { contactId, by: ctx.userId });
  return { ok: true };
}

const ALLOWED_DOCS = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
export const documentSchema = z.object({
  kind: z.enum(['prescription', 'lab_report', 'scan', 'discharge', 'medical_report', 'other']).default('other'),
  title: z.string().trim().min(2).max(160),
  fileName: z.string().trim().min(1).max(191),
  mimeType: z.string().refine((m) => ALLOWED_DOCS.includes(m), 'Upload a PDF or an image (PNG, JPG, WebP).'),
  dataBase64: z.string().min(10).max(11_200_000, 'Files must be 8 MB or smaller.'),
  consultationId: z.string().uuid().optional(),
});

export async function uploadPatientDocument(db: TenantDb, ctx: AuthContext, contactId: string, body: z.infer<typeof documentSchema>) {
  assertClinical(ctx);
  const clinic = await requireClinic(db);
  const contact = await db.contact.findFirst({ where: { id: contactId, appointments: { some: { clinicId: clinic.id } } }, select: { id: true } });
  if (!contact) throw new NotFoundError('Patient');
  const bytes = Buffer.from(body.dataBase64, 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new ValidationError('Files must be 8 MB or smaller.');
  // Magic-byte check so a renamed file can't pretend to be a PDF/image.
  const head = bytes.subarray(0, 4).toString('hex');
  const ok =
    (body.mimeType === 'application/pdf' && bytes.subarray(0, 4).toString() === '%PDF') ||
    (body.mimeType === 'image/png' && head === '89504e47') ||
    (body.mimeType === 'image/jpeg' && head.startsWith('ffd8')) ||
    (body.mimeType === 'image/webp' && bytes.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw new ValidationError('The file content does not match its type.');
  const doc = await db.patientDocument.create({
    data: { tenantId: clinic.tenantId, contactId, consultationId: body.consultationId ?? null, kind: body.kind, title: body.title, fileName: body.fileName, mimeType: body.mimeType, size: bytes.length, data: bytes, uploadedBy: ctx.userId } as never,
    select: { id: true },
  });
  log.info('patient.document.uploaded', { contactId, documentId: doc.id, by: ctx.userId });
  return doc;
}

export async function readPatientDocument(db: TenantDb, ctx: AuthContext, documentId: string) {
  const doc = await db.patientDocument.findFirst({ where: { id: documentId, deletedAt: null }, select: { id: true, fileName: true, mimeType: true, data: true, contactId: true } });
  if (!doc) throw new NotFoundError('Document');
  log.info('patient.document.accessed', { documentId, contactId: doc.contactId, by: ctx.userId });
  return doc;
}

export async function deletePatientDocument(db: TenantDb, ctx: AuthContext, documentId: string) {
  assertClinical(ctx);
  const n = await db.patientDocument.updateMany({ where: { id: documentId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!n.count) throw new NotFoundError('Document');
  log.info('patient.document.deleted', { documentId, by: ctx.userId });
}

export async function readPrescriptionPdf(db: TenantDb, ctx: AuthContext, prescriptionId: string) {
  const rx = await db.prescription.findFirst({ where: { id: prescriptionId, status: 'finalized' }, select: { prescriptionNo: true, pdf: true, contactId: true } });
  if (!rx?.pdf) throw new NotFoundError('Prescription');
  log.info('prescription.pdf.accessed', { prescriptionId, contactId: rx.contactId, by: ctx.userId });
  return { fileName: `Prescription-${rx.prescriptionNo}.pdf`, data: new Uint8Array(rx.pdf) };
}
