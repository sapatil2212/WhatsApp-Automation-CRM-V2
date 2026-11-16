/**
 * Healthcare vertical persistence.
 *
 * `Clinic` carries its own `tenantId`; everything beneath it is guarded through
 * the `clinic` relation. That is what closes the hole where `appointment`,
 * `doctor`, `clinicService`, `clinicFAQ` and `aISettings` were all absent from
 * the compat endpoint's `isolatedModels`, so any authenticated user could read
 * another clinic's patient rows by passing an id.
 *
 * `AISettings` is `@unique` on `clinicId`, which is why saving settings always
 * failed before: the client sent `upsert(..., { onConflict: 'clinic_id' })`,
 * the compat endpoint ignored `onConflict` and called `create`, and the row
 * already existed from setup — so every save returned P2002.
 */

import type { Prisma } from '@prisma/client';

import { scoped, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const clinicSelect = {
  id: true,
  clinicName: true,
  clinicType: true,
  clinicDescription: true,
  phone: true,
  whatsappNumber: true,
  email: true,
  website: true,
  address: true,
  city: true,
  state: true,
  pincode: true,
  googleMapLink: true,
  instagramUrl: true,
  facebookUrl: true,
  aiKnowledgeBase: true,
  dateExceptions: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClinicSelect;

const timingSelect = {
  id: true,
  dayName: true,
  isClosed: true,
  openingTime: true,
  closingTime: true,
  lunchBreakStart: true,
  lunchBreakEnd: true,
} satisfies Prisma.ClinicTimingSelect;

const doctorSelect = {
  id: true,
  doctorName: true,
  specialization: true,
  qualification: true,
  experience: true,
  availableDays: true,
  availableStartTime: true,
  availableEndTime: true,
  consultationFee: true,
  languagesSpoken: true,
  profilePhoto: true,
  weeklySlots: true,
  dateExceptions: true,
} satisfies Prisma.DoctorSelect;

const serviceSelect = {
  id: true,
  serviceName: true,
  description: true,
  startingPrice: true,
  duration: true,
  isActive: true,
} satisfies Prisma.ClinicServiceSelect;

const faqSelect = {
  id: true,
  question: true,
  answer: true,
  keywords: true,
} satisfies Prisma.ClinicFAQSelect;

const aiSettingsSelect = {
  aiEnabled: true,
  aiTone: true,
  supportedLanguages: true,
  greetingMessage: true,
  afterHoursMessage: true,
  escalationKeywords: true,
  emergencyKeywords: true,
  humanHandoverEnabled: true,
  inboundRoutingMode: true,
} satisfies Prisma.AISettingsSelect;

export type ClinicRow = Prisma.ClinicGetPayload<{ select: typeof clinicSelect }>;
export type ClinicTimingRow = Prisma.ClinicTimingGetPayload<{ select: typeof timingSelect }>;
export type DoctorRow = Prisma.DoctorGetPayload<{ select: typeof doctorSelect }>;
export type ClinicServiceRow = Prisma.ClinicServiceGetPayload<{ select: typeof serviceSelect }>;
export type ClinicFaqRow = Prisma.ClinicFAQGetPayload<{ select: typeof faqSelect }>;
export type AiSettingsRow = Prisma.AISettingsGetPayload<{ select: typeof aiSettingsSelect }>;

export class ClinicRepository extends BaseRepository {
  protected readonly resourceName = 'Clinic';

  constructor(db: TenantDb) {
    super(db);
  }

  /** `Clinic.userId` is `@unique`, so a tenant holds at most one per user. */
  async find(): Promise<ClinicRow | null> {
    return this.db.clinic.findFirst({ select: clinicSelect });
  }

  async require(): Promise<ClinicRow> {
    return this.requireFound(await this.find());
  }

  async upsert(input: {
    userId: string;
    data: Omit<Prisma.ClinicUpdateManyMutationInput, 'tenantId' | 'userId'>;
  }): Promise<ClinicRow> {
    const existing = await this.db.clinic.findFirst({ select: { id: true } });
    if (existing) {
      await this.db.clinic.updateMany({ where: { id: existing.id }, data: input.data });
      return this.require();
    }
    return this.db.clinic.create({
      data: scoped({
        userId: input.userId,
        clinicName: String(input.data.clinicName ?? 'My Clinic'),
        ...input.data,
      } as Prisma.ClinicUncheckedCreateInput),
      select: clinicSelect,
    });
  }

  // ── timings ───────────────────────────────────────────────────────

  async listTimings(clinicId: string): Promise<ClinicTimingRow[]> {
    return this.db.clinicTiming.findMany({ where: { clinicId }, select: timingSelect });
  }

  /** Whole-week replacement, atomically. */
  async replaceTimings(
    clinicId: string,
    timings: Array<{
      dayName: string;
      isClosed: boolean;
      openingTime: string | null;
      closingTime: string | null;
      lunchBreakStart: string | null;
      lunchBreakEnd: string | null;
    }>,
  ): Promise<ClinicTimingRow[]> {
    await this.db.$transaction(async (tx) => {
      await tx.clinicTiming.deleteMany({ where: { clinicId } });
      await tx.clinicTiming.createMany({ data: timings.map((timing) => ({ clinicId, ...timing })) });
    });
    return this.listTimings(clinicId);
  }

  // ── doctors ───────────────────────────────────────────────────────

  async listDoctors(clinicId: string): Promise<DoctorRow[]> {
    return this.db.doctor.findMany({
      where: { clinicId },
      select: doctorSelect,
      orderBy: { doctorName: 'asc' },
    });
  }

  async findDoctor(clinicId: string, doctorId: string): Promise<DoctorRow | null> {
    return this.db.doctor.findFirst({ where: { id: doctorId, clinicId }, select: doctorSelect });
  }

  async createDoctor(clinicId: string, data: Prisma.DoctorUncheckedCreateInput): Promise<DoctorRow> {
    return this.db.doctor.create({ data: { ...data, clinicId }, select: doctorSelect });
  }

  async updateDoctor(
    clinicId: string,
    doctorId: string,
    data: Prisma.DoctorUpdateManyMutationInput,
  ): Promise<DoctorRow> {
    this.requireAffected(await this.db.doctor.updateMany({ where: { id: doctorId, clinicId }, data }));
    return this.requireFound(await this.findDoctor(clinicId, doctorId));
  }

  async deleteDoctor(clinicId: string, doctorId: string): Promise<void> {
    this.requireAffected(await this.db.doctor.deleteMany({ where: { id: doctorId, clinicId } }));
  }

  // ── services ──────────────────────────────────────────────────────

  async listServices(clinicId: string, activeOnly = false): Promise<ClinicServiceRow[]> {
    return this.db.clinicService.findMany({
      where: { clinicId, ...(activeOnly ? { isActive: true } : {}) },
      select: serviceSelect,
      orderBy: { serviceName: 'asc' },
    });
  }

  async createService(
    clinicId: string,
    data: Omit<Prisma.ClinicServiceUncheckedCreateInput, 'clinicId'>,
  ): Promise<ClinicServiceRow> {
    return this.db.clinicService.create({ data: { ...data, clinicId }, select: serviceSelect });
  }

  async updateService(
    clinicId: string,
    serviceId: string,
    data: Prisma.ClinicServiceUpdateManyMutationInput,
  ): Promise<ClinicServiceRow> {
    this.requireAffected(
      await this.db.clinicService.updateMany({ where: { id: serviceId, clinicId }, data }),
    );
    return this.requireFound(
      await this.db.clinicService.findFirst({ where: { id: serviceId, clinicId }, select: serviceSelect }),
    );
  }

  async deleteService(clinicId: string, serviceId: string): Promise<void> {
    this.requireAffected(
      await this.db.clinicService.deleteMany({ where: { id: serviceId, clinicId } }),
    );
  }

  // ── FAQs ──────────────────────────────────────────────────────────

  async listFaqs(clinicId: string): Promise<ClinicFaqRow[]> {
    return this.db.clinicFAQ.findMany({
      where: { clinicId },
      select: faqSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async createFaq(
    clinicId: string,
    data: { question: string; answer: string; keywords: string | null },
  ): Promise<ClinicFaqRow> {
    return this.db.clinicFAQ.create({ data: { ...data, clinicId }, select: faqSelect });
  }

  async updateFaq(
    clinicId: string,
    faqId: string,
    data: Prisma.ClinicFAQUpdateManyMutationInput,
  ): Promise<ClinicFaqRow> {
    this.requireAffected(await this.db.clinicFAQ.updateMany({ where: { id: faqId, clinicId }, data }));
    return this.requireFound(
      await this.db.clinicFAQ.findFirst({ where: { id: faqId, clinicId }, select: faqSelect }),
    );
  }

  async deleteFaq(clinicId: string, faqId: string): Promise<void> {
    this.requireAffected(await this.db.clinicFAQ.deleteMany({ where: { id: faqId, clinicId } }));
  }

  /** Bulk import, atomic. `replace` clears the existing set first. */
  async importFaqs(
    clinicId: string,
    faqs: Array<{ question: string; answer: string; keywords: string | null }>,
    mode: 'append' | 'replace',
  ): Promise<number> {
    return this.db.$transaction(async (tx) => {
      if (mode === 'replace') {
        await tx.clinicFAQ.deleteMany({ where: { clinicId } });
      }
      const result = await tx.clinicFAQ.createMany({
        data: faqs.map((faq) => ({ ...faq, clinicId })),
      });
      return result.count;
    });
  }

  // ── AI settings ───────────────────────────────────────────────────

  async findAiSettings(clinicId: string): Promise<AiSettingsRow | null> {
    return this.db.aISettings.findFirst({ where: { clinicId }, select: aiSettingsSelect });
  }

  /**
   * Real upsert on the `clinicId` unique key — the operation the compat
   * endpoint silently downgraded to `create`, which is why every settings save
   * returned a unique-constraint error.
   */
  async upsertAiSettings(
    clinicId: string,
    data: Omit<Prisma.AISettingsUncheckedCreateInput, 'clinicId' | 'id'>,
  ): Promise<AiSettingsRow> {
    await this.db.aISettings.upsert({
      where: { clinicId },
      create: { ...data, clinicId },
      update: data,
      select: { id: true },
    });
    return this.requireFound(await this.findAiSettings(clinicId));
  }
}
