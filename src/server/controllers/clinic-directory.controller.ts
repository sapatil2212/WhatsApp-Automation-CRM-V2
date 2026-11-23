/**
 * Clinic departments & doctors directory.
 *
 *   GET/POST          /api/healthcare/departments
 *   PATCH/DELETE      /api/healthcare/departments/[id]
 *   GET/POST          /api/healthcare/doctors
 *   GET/PATCH/DELETE  /api/healthcare/doctors/[id]
 *
 * Everything runs on the tenant-scoped client (`db`), so a clinic can only
 * ever read or change its own departments, doctors and schedules.
 */

import { z } from 'zod';

import {
  fromLegacy,
  isWeeklySchedule,
  legacyFields,
  normalizeSchedule,
  SESSION_KEYS,
  summarize,
  validateSchedule,
  WEEKDAYS,
  type WeeklySchedule,
} from '@/lib/healthcare/schedule';
import { invalidateClinicCacheForTenant } from '@/lib/healthcare/clinic-cache';
import { blockingExceptions } from '@/lib/healthcare/exceptions';
import { notifyAffectedAppointments } from '@/server/services/closure-notify';
import { ConflictError, createHandler, logger, NotFoundError, result, serializeError, ValidationError, type TenantDb } from '../kernel';

const idParams = z.object({ id: z.string().uuid() });
const loose = z.any();

async function requireClinic(db: TenantDb): Promise<{ id: string }> {
  const clinic = await db.clinic.findFirst({ select: { id: true } });
  if (!clinic) throw new NotFoundError('Clinic', { details: { hint: 'Save Step 1 (Clinic Information) first.' } });
  return clinic;
}

// ── departments ─────────────────────────────────────────────────────

const departmentBody = z.object({
  name: z.string().trim().min(2, 'Department name is too short.').max(120),
  description: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().default(true),
});

function toDepartment(d: { id: string; name: string; description: string | null; isActive: boolean; sortOrder: number; _count?: { doctors: number } }) {
  return { id: d.id, name: d.name, description: d.description, isActive: d.isActive, sortOrder: d.sortOrder, doctorCount: d._count?.doctors ?? 0 };
}

// ── doctors ─────────────────────────────────────────────────────────

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const breakSchema = z.object({ id: z.string().max(40), name: z.string().trim().max(40).default('Break'), start: z.string().regex(timeRe), end: z.string().regex(timeRe) });
const sessionSchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(timeRe),
  end: z.string().regex(timeRe),
  slotMinutes: z.coerce.number().int().min(5).max(240),
  breaks: z.array(breakSchema).max(12).default([]),
});
const daySchema = z.object({ enabled: z.boolean(), sessions: z.object({ morning: sessionSchema, afternoon: sessionSchema, evening: sessionSchema }) });
const scheduleSchema = z.object({
  version: z.literal(2),
  days: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, daySchema])) as Record<(typeof WEEKDAYS)[number], typeof daySchema>),
});

const doctorBody = z.object({
  name: z.string().trim().min(2, "Enter the doctor's full name.").max(120),
  photoUrl: z.string().trim().url().max(500).nullish().or(z.literal('')),
  qualification: z.string().trim().max(200).nullish(),
  specialization: z.string().trim().max(120).nullish(),
  experience: z.string().trim().max(60).nullish(),
  phone: z.string().trim().max(32).nullish(),
  email: z.string().trim().email('Enter a valid email address.').max(191).nullish().or(z.literal('')),
  registrationNumber: z.string().trim().max(80).nullish(),
  bio: z.string().trim().max(2000).nullish(),
  languages: z.string().trim().max(200).nullish(),
  consultationFee: z.coerce.number().min(0).max(1_000_000).default(0),
  departmentIds: z.array(z.string().uuid()).max(20).default([]),
  schedule: scheduleSchema,
  /** Leave / unavailable dates. Omit to keep the stored list unchanged. */
  leaves: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'), reason: z.string().trim().max(200).default('On leave') }))
    .max(366)
    .optional(),
});

const doctorInclude = {
  detail: true,
  departments: { include: { department: { select: { id: true, name: true } } } },
} as const;

type DoctorRow = Awaited<ReturnType<TenantDb['doctor']['findFirst']>> & {
  detail?: { email: string | null; phone: string | null; registrationNumber: string | null; bio: string | null } | null;
  departments?: Array<{ department: { id: string; name: string } }>;
};

function toDoctor(d: NonNullable<DoctorRow>) {
  const schedule = fromLegacy({
    weeklySlots: d.weeklySlots,
    availableDays: d.availableDays,
    availableStartTime: d.availableStartTime,
    availableEndTime: d.availableEndTime,
  });
  const sum = summarize(schedule);
  return {
    id: d.id,
    name: d.doctorName,
    photoUrl: d.profilePhoto,
    qualification: d.qualification,
    specialization: d.specialization,
    experience: d.experience,
    languages: d.languagesSpoken,
    consultationFee: Number(d.consultationFee ?? 0),
    phone: d.detail?.phone ?? null,
    email: d.detail?.email ?? null,
    registrationNumber: d.detail?.registrationNumber ?? null,
    bio: d.detail?.bio ?? null,
    departments: (d.departments ?? []).map((x) => x.department),
    schedule,
    leaves: blockingExceptions(d.dateExceptions),
    scheduleSummary: { workingDays: sum.workingDays, slotsPerWeek: sum.slotsPerWeek, breakMinutesPerWeek: sum.breakMinutesPerWeek, activeDays: sum.activeDays },
  };
}

async function saveDoctor(db: TenantDb, clinicId: string, body: z.infer<typeof doctorBody>, doctorId?: string) {
  const schedule = normalizeSchedule(body.schedule as WeeklySchedule);
  const issues = validateSchedule(schedule);
  if (issues.length) throw new ValidationError(`${issues[0].day}: ${issues[0].message}`, { details: { issues } });

  const departments = body.departmentIds.length
    ? await db.clinicDepartment.findMany({ where: { id: { in: body.departmentIds }, clinicId }, select: { id: true, name: true } })
    : [];
  if (departments.length !== new Set(body.departmentIds).size) throw new ValidationError('One or more departments were not found.');

  const legacy = legacyFields(schedule);
  const data = {
    doctorName: body.name,
    profilePhoto: body.photoUrl || null,
    qualification: body.qualification || null,
    // Specialization defaults to the primary department so older views and
    // the AI assistant keep showing something meaningful.
    specialization: body.specialization || departments[0]?.name || null,
    experience: body.experience || null,
    languagesSpoken: body.languages || null,
    consultationFee: body.consultationFee,
    weeklySlots: schedule as unknown as object,
    availableDays: legacy.availableDays,
    availableStartTime: legacy.availableStartTime,
    availableEndTime: legacy.availableEndTime,
    ...(body.leaves
      ? { dateExceptions: [...new Map(body.leaves.map((l) => [l.date, { date: l.date, is_available: false, reason: l.reason || 'On leave' }])).values()] }
      : {}),
  };

  return db.$transaction(async (tx) => {
    let id = doctorId;
    if (id) {
      const updated = await tx.doctor.updateMany({ where: { id, clinicId }, data });
      if (!updated.count) throw new NotFoundError('Doctor');
    } else {
      const created = await tx.doctor.create({ data: { ...data, clinicId }, select: { id: true } });
      id = created.id;
    }
    await tx.doctorDetail.upsert({
      where: { doctorId: id },
      create: { doctorId: id, email: body.email || null, phone: body.phone || null, registrationNumber: body.registrationNumber || null, bio: body.bio || null },
      update: { email: body.email || null, phone: body.phone || null, registrationNumber: body.registrationNumber || null, bio: body.bio || null },
    });
    await tx.doctorDepartment.deleteMany({ where: { doctorId: id } });
    if (departments.length) await tx.doctorDepartment.createMany({ data: departments.map((dep) => ({ doctorId: id!, departmentId: dep.id })) });
    return id!;
  });
}

export const clinicDirectoryController = {
  listDepartments: createHandler({
    operation: 'clinic.departments.list',
    auth: 'tenant',
    response: loose,
    async handle({ db }) {
      const clinic = await db.clinic.findFirst({ select: { id: true } });
      if (!clinic) return [];
      const rows = await db.clinicDepartment.findMany({
        where: { clinicId: clinic.id },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { doctors: true } } },
      });
      return rows.map(toDepartment);
    },
  }),

  createDepartment: createHandler({
    operation: 'clinic.departments.create',
    auth: 'tenant',
    body: departmentBody,
    response: loose,
    status: 201,
    async handle({ ctx, db, body }) {
      const clinic = await requireClinic(db);
      const exists = await db.clinicDepartment.findFirst({ where: { clinicId: clinic.id, name: body.name }, select: { id: true } });
      if (exists) throw new ConflictError(`A department named "${body.name}" already exists.`);
      const count = await db.clinicDepartment.count({ where: { clinicId: clinic.id } });
      const row = await db.clinicDepartment.create({
        data: { clinicId: clinic.id, name: body.name, description: body.description || null, isActive: body.isActive, sortOrder: count },
        include: { _count: { select: { doctors: true } } },
      });
      invalidateClinicCacheForTenant(ctx.tenantId);
      return toDepartment(row);
    },
  }),

  updateDepartment: createHandler({
    operation: 'clinic.departments.update',
    auth: 'tenant',
    params: idParams,
    body: departmentBody.partial(),
    response: loose,
    async handle({ ctx, db, params, body }) {
      const clinic = await requireClinic(db);
      if (body.name) {
        const clash = await db.clinicDepartment.findFirst({ where: { clinicId: clinic.id, name: body.name, NOT: { id: params.id } }, select: { id: true } });
        if (clash) throw new ConflictError(`A department named "${body.name}" already exists.`);
      }
      const updated = await db.clinicDepartment.updateMany({
        where: { id: params.id, clinicId: clinic.id },
        data: { ...(body.name ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description || null } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) },
      });
      if (!updated.count) throw new NotFoundError('Department');
      invalidateClinicCacheForTenant(ctx.tenantId);
      const row = await db.clinicDepartment.findFirstOrThrow({ where: { id: params.id }, include: { _count: { select: { doctors: true } } } });
      return toDepartment(row);
    },
  }),

  deleteDepartment: createHandler({
    operation: 'clinic.departments.delete',
    auth: 'tenant',
    params: idParams,
    response: loose,
    async handle({ ctx, db, params }) {
      const clinic = await requireClinic(db);
      const deleted = await db.clinicDepartment.deleteMany({ where: { id: params.id, clinicId: clinic.id } });
      if (!deleted.count) throw new NotFoundError('Department');
      invalidateClinicCacheForTenant(ctx.tenantId);
      return result({ deleted: true }, { message: 'Department deleted. Doctors were unassigned from it.' });
    },
  }),

  listDoctors: createHandler({
    operation: 'clinic.doctors.list',
    auth: 'tenant',
    response: loose,
    async handle({ db }) {
      const clinic = await db.clinic.findFirst({ select: { id: true } });
      if (!clinic) return [];
      const rows = await db.doctor.findMany({ where: { clinicId: clinic.id }, include: doctorInclude, orderBy: { doctorName: 'asc' } });
      return rows.map((r) => toDoctor(r as never));
    },
  }),

  getDoctor: createHandler({
    operation: 'clinic.doctors.get',
    auth: 'tenant',
    params: idParams,
    response: loose,
    async handle({ db, params }) {
      const row = await db.doctor.findFirst({ where: { id: params.id }, include: doctorInclude });
      if (!row) throw new NotFoundError('Doctor');
      return toDoctor(row as never);
    },
  }),

  createDoctor: createHandler({
    operation: 'clinic.doctors.create',
    auth: 'tenant',
    body: doctorBody,
    response: loose,
    status: 201,
    async handle({ ctx, db, body }) {
      const clinic = await requireClinic(db);
      const id = await saveDoctor(db, clinic.id, body);
      invalidateClinicCacheForTenant(ctx.tenantId);
      void notifyAffectedAppointments({ clinicId: clinic.id, doctorId: id }).catch((e) => logger.warn('clinic.doctors.leave_notify_failed', { error: serializeError(e) }));
      return toDoctor((await db.doctor.findFirst({ where: { id }, include: doctorInclude })) as never);
    },
  }),

  updateDoctor: createHandler({
    operation: 'clinic.doctors.update',
    auth: 'tenant',
    params: idParams,
    body: doctorBody,
    response: loose,
    async handle({ ctx, db, params, body }) {
      const clinic = await requireClinic(db);
      await saveDoctor(db, clinic.id, body, params.id);
      invalidateClinicCacheForTenant(ctx.tenantId);
      if (body.leaves) void notifyAffectedAppointments({ clinicId: clinic.id, doctorId: params.id }).catch((e) => logger.warn('clinic.doctors.leave_notify_failed', { error: serializeError(e) }));
      return toDoctor((await db.doctor.findFirst({ where: { id: params.id }, include: doctorInclude })) as never);
    },
  }),

  deleteDoctor: createHandler({
    operation: 'clinic.doctors.delete',
    auth: 'tenant',
    params: idParams,
    response: loose,
    async handle({ ctx, db, params }) {
      const clinic = await requireClinic(db);
      const upcoming = await db.appointment.count({ where: { doctorId: params.id, status: 'scheduled', appointmentDate: { gte: new Date(new Date().toISOString().slice(0, 10)) } } });
      if (upcoming) throw new ConflictError(`This doctor has ${upcoming} upcoming appointment(s). Reschedule or cancel them first.`);
      const deleted = await db.doctor.deleteMany({ where: { id: params.id, clinicId: clinic.id } });
      if (!deleted.count) throw new NotFoundError('Doctor');
      invalidateClinicCacheForTenant(ctx.tenantId);
      return result({ deleted: true }, { message: 'Doctor removed.' });
    },
  }),
};

// Re-exported for tests.
export { doctorBody, scheduleSchema, isWeeklySchedule, SESSION_KEYS };
