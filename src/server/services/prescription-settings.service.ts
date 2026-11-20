/**
 * One-time prescription branding (clinic header, logo, stamp, footer) and
 * per-doctor details (designation, registration number, signature).
 * Images are stored in the DB and only served through authenticated routes.
 * Finalized prescriptions keep their own frozen snapshot + PDF, so edits here
 * never change a prescription that was already signed.
 */

import { z } from 'zod';

import { ForbiddenError, getLogger, NotFoundError, ValidationError, type AuthContext, type TenantDb } from '../kernel';

const log = getLogger('prescription-settings');
const ADMIN_BLOCKED = new Set(['receptionist', 'support']);
const assertAdmin = (ctx: AuthContext) => {
  if (ADMIN_BLOCKED.has(ctx.role)) throw new ForbiddenError('You do not have permission to change prescription branding.');
};

async function requireClinic(db: TenantDb) {
  const clinic = await db.clinic.findFirst({ select: { id: true, tenantId: true, clinicName: true, address: true, city: true, state: true, pincode: true, phone: true, email: true, website: true } });
  if (!clinic) throw new NotFoundError('Clinic', { details: { hint: 'Complete Business Setup first.' } });
  return clinic;
}

export const settingsSchema = z.object({
  clinicName: z.string().trim().max(160).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(191).nullable().optional().or(z.literal('')),
  website: z.string().trim().max(191).nullable().optional(),
  registrationNo: z.string().trim().max(80).nullable().optional(),
  headerStyle: z.enum(['classic', 'minimal']).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  footerText: z.string().trim().max(500).nullable().optional(),
});

const IMAGE_MIME = ['image/png', 'image/jpeg'];
export const imageSchema = z.object({
  mimeType: z.string().refine((m) => IMAGE_MIME.includes(m), 'Use a PNG or JPG image.'),
  dataBase64: z.string().min(10).max(1_400_000, 'Images must be 1 MB or smaller.'),
});

function decodeImage(body: z.infer<typeof imageSchema>): Buffer {
  const bytes = Buffer.from(body.dataBase64, 'base64');
  const head = bytes.subarray(0, 4).toString('hex');
  const ok = (body.mimeType === 'image/png' && head === '89504e47') || (body.mimeType === 'image/jpeg' && head.startsWith('ffd8'));
  if (!ok || bytes.length > 1024 * 1024) throw new ValidationError('Upload a PNG or JPG image up to 1 MB.');
  return bytes;
}

export async function getPrescriptionSettings(db: TenantDb) {
  const clinic = await requireClinic(db);
  const [s, doctors] = await Promise.all([
    db.prescriptionSettings.findFirst({ where: { clinicId: clinic.id } }),
    db.doctor.findMany({
      where: { clinicId: clinic.id },
      orderBy: { doctorName: 'asc' },
      select: {
        id: true, doctorName: true, qualification: true, specialization: true,
        detail: { select: { registrationNumber: true, designation: true, signatureMime: true, signatureUpdatedAt: true, signatureUpdatedBy: true } },
        departments: { select: { department: { select: { name: true } } } },
      },
    }),
  ]);
  return {
    clinic: {
      clinicName: s?.clinicName ?? clinic.clinicName,
      address: s?.address ?? ([clinic.address, clinic.city, clinic.state, clinic.pincode].filter(Boolean).join(', ') || null),
      phone: s?.phone ?? clinic.phone,
      email: s?.email ?? clinic.email,
      website: s?.website ?? clinic.website,
      registrationNo: s?.registrationNo ?? null,
      headerStyle: s?.headerStyle ?? 'classic',
      accentColor: s?.accentColor ?? '#0f766e',
      footerText: s?.footerText ?? null,
      hasLogo: Boolean(s?.logo),
      hasStamp: Boolean(s?.stamp),
      updatedAt: s?.updatedAt?.toISOString() ?? null,
      updatedBy: s?.updatedBy ?? null,
    },
    doctors: doctors.map((d) => ({
      id: d.id,
      name: d.doctorName,
      qualification: d.qualification,
      specialization: d.specialization,
      departments: d.departments.map((x) => x.department.name),
      registrationNo: d.detail?.registrationNumber ?? null,
      designation: d.detail?.designation ?? null,
      hasSignature: Boolean(d.detail?.signatureMime),
      signatureUpdatedAt: d.detail?.signatureUpdatedAt?.toISOString() ?? null,
    })),
  };
}

async function upsert(db: TenantDb, ctx: AuthContext, data: Record<string, unknown>) {
  const clinic = await requireClinic(db);
  const existing = await db.prescriptionSettings.findFirst({ where: { clinicId: clinic.id }, select: { id: true } });
  if (existing) await db.prescriptionSettings.updateMany({ where: { id: existing.id }, data: { ...data, updatedBy: ctx.userId } });
  else await db.prescriptionSettings.create({ data: { tenantId: clinic.tenantId, clinicId: clinic.id, ...data, updatedBy: ctx.userId } as never });
}

export async function savePrescriptionSettings(db: TenantDb, ctx: AuthContext, body: z.infer<typeof settingsSchema>) {
  assertAdmin(ctx);
  await upsert(db, ctx, { ...body, email: body.email || null });
  log.info('prescription.settings.updated', { by: ctx.userId });
  return getPrescriptionSettings(db);
}

export async function setBrandImage(db: TenantDb, ctx: AuthContext, kind: 'logo' | 'stamp', body: z.infer<typeof imageSchema> | null) {
  assertAdmin(ctx);
  const bytes = body ? decodeImage(body) : null;
  await upsert(db, ctx, kind === 'logo' ? { logo: bytes, logoMime: body?.mimeType ?? null } : { stamp: bytes, stampMime: body?.mimeType ?? null });
  log.info(`prescription.${kind}.${bytes ? 'uploaded' : 'removed'}`, { by: ctx.userId });
  return { ok: true };
}

export async function readBrandImage(db: TenantDb, kind: 'logo' | 'stamp') {
  const clinic = await requireClinic(db);
  const s = await db.prescriptionSettings.findFirst({ where: { clinicId: clinic.id }, select: { logo: true, logoMime: true, stamp: true, stampMime: true } });
  const data = kind === 'logo' ? s?.logo : s?.stamp;
  if (!data) throw new NotFoundError('Image');
  return { data: new Uint8Array(data), mimeType: (kind === 'logo' ? s?.logoMime : s?.stampMime) ?? 'image/png' };
}

export const doctorBrandSchema = z.object({
  designation: z.string().trim().max(80).nullable().optional(),
  registrationNo: z.string().trim().max(80).nullable().optional(),
  signature: imageSchema.nullable().optional(),
});

export async function saveDoctorBranding(db: TenantDb, ctx: AuthContext, doctorId: string, body: z.infer<typeof doctorBrandSchema>) {
  assertAdmin(ctx);
  const clinic = await requireClinic(db);
  const doctor = await db.doctor.findFirst({ where: { id: doctorId, clinicId: clinic.id }, select: { id: true } });
  if (!doctor) throw new NotFoundError('Doctor');
  const data: Record<string, unknown> = {};
  if (body.designation !== undefined) data.designation = body.designation;
  if (body.registrationNo !== undefined) data.registrationNumber = body.registrationNo;
  if (body.signature !== undefined) {
    data.signature = body.signature ? decodeImage(body.signature) : null;
    data.signatureMime = body.signature?.mimeType ?? null;
    data.signatureUpdatedBy = ctx.userId;
    data.signatureUpdatedAt = new Date();
  }
  await db.doctorDetail.upsert({ where: { doctorId }, create: { doctorId, ...data }, update: data });
  if (body.signature !== undefined) log.info('doctor.signature.changed', { doctorId, by: ctx.userId, removed: body.signature === null });
  return { ok: true };
}

export async function readDoctorSignature(db: TenantDb, doctorId: string) {
  const clinic = await requireClinic(db);
  const d = await db.doctorDetail.findFirst({ where: { doctorId, doctor: { clinicId: clinic.id } }, select: { signature: true, signatureMime: true } });
  if (!d?.signature) throw new NotFoundError('Signature');
  return { data: new Uint8Array(d.signature), mimeType: d.signatureMime ?? 'image/png' };
}
