/**
 * Healthcare vertical configuration rules.
 *
 * Owns the clinic profile, weekly timings, doctors, services, FAQs and AI
 * settings — everything the AI responder reads to answer a patient. The
 * responder itself is migrated later; this makes its inputs trustworthy.
 */

import { NotFoundError, ValidationError, type TenantDb } from '../kernel';
import {
  toAiSettingsDto,
  toClinicDto,
  toClinicFaqDto,
  toClinicServiceDto,
  toClinicTimingDto,
  toDoctorDto,
  WEEKDAYS,
  type AiSettingsDto,
  type ClinicDto,
  type ClinicFaqDto,
  type ClinicServiceDto,
  type ClinicSetupDto,
  type ClinicTimingDto,
  type DoctorDto,
} from '../dtos/clinic.dto';
import { ClinicRepository } from '../repositories/clinic.repository';
import type {
  CreateDoctorBody,
  ImportClinicFaqsBody,
  SetClinicTimingsBody,
  UpdateDoctorBody,
  UpsertAiSettingsBody,
  UpsertClinicBody,
  UpsertClinicFaqBody,
  UpsertClinicServiceBody,
} from '../validators/clinic.validator';

export interface ClinicServiceDeps {
  clinics: ClinicRepository;
}

export class ClinicConfigService {
  constructor(
    private readonly deps: ClinicServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string): ClinicConfigService {
    return new ClinicConfigService({ clinics: new ClinicRepository(db) }, userId);
  }

  /**
   * The clinic record, or a clear 404 rather than a null that every caller
   * then has to remember to check.
   */
  private async requireClinic(): Promise<{ id: string }> {
    const clinic = await this.deps.clinics.find();
    if (!clinic) {
      throw new NotFoundError('Clinic', {
        details: { hint: 'Complete the healthcare setup step first.' },
      });
    }
    return clinic;
  }

  async get(): Promise<ClinicDto | null> {
    const clinic = await this.deps.clinics.find();
    return clinic ? toClinicDto(clinic) : null;
  }

  /** Everything the setup screen and the AI prompt need, in one read. */
  async getSetup(): Promise<ClinicSetupDto> {
    const clinic = await this.deps.clinics.require();
    const [timings, doctors, services, faqs, aiSettings] = await Promise.all([
      this.deps.clinics.listTimings(clinic.id),
      this.deps.clinics.listDoctors(clinic.id),
      this.deps.clinics.listServices(clinic.id),
      this.deps.clinics.listFaqs(clinic.id),
      this.deps.clinics.findAiSettings(clinic.id),
    ]);

    return {
      clinic: toClinicDto(clinic),
      timings: timings.map(toClinicTimingDto),
      doctors: doctors.map(toDoctorDto),
      services: services.map(toClinicServiceDto),
      faqs: faqs.map(toClinicFaqDto),
      aiSettings: aiSettings ? toAiSettingsDto(aiSettings) : null,
    };
  }

  async upsert(body: UpsertClinicBody): Promise<ClinicDto> {
    return toClinicDto(await this.deps.clinics.upsert({ userId: this.userId, data: body }));
  }

  // ── timings ───────────────────────────────────────────────────────

  async listTimings(): Promise<ClinicTimingDto[]> {
    const clinic = await this.requireClinic();
    return (await this.deps.clinics.listTimings(clinic.id)).map(toClinicTimingDto);
  }

  async setTimings(body: SetClinicTimingsBody): Promise<ClinicTimingDto[]> {
    const clinic = await this.requireClinic();
    const rows = await this.deps.clinics.replaceTimings(
      clinic.id,
      body.timings.map((timing) => ({
        dayName: timing.dayName,
        isClosed: timing.isClosed,
        // A closed day's times are cleared rather than kept, so the slot
        // calculator cannot read stale hours if the day is reopened.
        openingTime: timing.isClosed ? null : (timing.openingTime ?? null),
        closingTime: timing.isClosed ? null : (timing.closingTime ?? null),
        lunchBreakStart: timing.isClosed ? null : (timing.lunchBreakStart ?? null),
        lunchBreakEnd: timing.isClosed ? null : (timing.lunchBreakEnd ?? null),
      })),
    );
    return rows.map(toClinicTimingDto);
  }

  /** Seeds a Mon–Sat 09:00–18:00 week so setup starts from something sane. */
  async seedDefaultTimings(): Promise<ClinicTimingDto[]> {
    const clinic = await this.requireClinic();
    const existing = await this.deps.clinics.listTimings(clinic.id);
    if (existing.length > 0) return existing.map(toClinicTimingDto);

    const rows = await this.deps.clinics.replaceTimings(
      clinic.id,
      WEEKDAYS.map((day) => ({
        dayName: day,
        isClosed: day === 'Sunday',
        openingTime: day === 'Sunday' ? null : '09:00',
        closingTime: day === 'Sunday' ? null : '18:00',
        lunchBreakStart: day === 'Sunday' ? null : '13:00',
        lunchBreakEnd: day === 'Sunday' ? null : '14:00',
      })),
    );
    return rows.map(toClinicTimingDto);
  }

  // ── doctors ───────────────────────────────────────────────────────

  async listDoctors(): Promise<DoctorDto[]> {
    const clinic = await this.requireClinic();
    return (await this.deps.clinics.listDoctors(clinic.id)).map(toDoctorDto);
  }

  async createDoctor(body: CreateDoctorBody): Promise<DoctorDto> {
    const clinic = await this.requireClinic();
    return toDoctorDto(
      await this.deps.clinics.createDoctor(clinic.id, {
        clinicId: clinic.id,
        doctorName: body.doctorName,
        specialization: body.specialization,
        qualification: body.qualification,
        experience: body.experience,
        availableDays: body.availableDays,
        availableStartTime: body.availableStartTime ?? null,
        availableEndTime: body.availableEndTime ?? null,
        consultationFee: body.consultationFee,
        languagesSpoken: body.languagesSpoken,
        profilePhoto: body.profilePhoto,
      }),
    );
  }

  async updateDoctor(doctorId: string, body: UpdateDoctorBody): Promise<DoctorDto> {
    const clinic = await this.requireClinic();
    return toDoctorDto(
      await this.deps.clinics.updateDoctor(clinic.id, doctorId, {
        ...(body.doctorName !== undefined ? { doctorName: body.doctorName } : {}),
        ...(body.specialization !== undefined ? { specialization: body.specialization } : {}),
        ...(body.qualification !== undefined ? { qualification: body.qualification } : {}),
        ...(body.experience !== undefined ? { experience: body.experience } : {}),
        ...(body.availableDays !== undefined ? { availableDays: body.availableDays } : {}),
        ...(body.availableStartTime !== undefined
          ? { availableStartTime: body.availableStartTime ?? null }
          : {}),
        ...(body.availableEndTime !== undefined
          ? { availableEndTime: body.availableEndTime ?? null }
          : {}),
        ...(body.consultationFee !== undefined ? { consultationFee: body.consultationFee } : {}),
        ...(body.languagesSpoken !== undefined ? { languagesSpoken: body.languagesSpoken } : {}),
        ...(body.profilePhoto !== undefined ? { profilePhoto: body.profilePhoto } : {}),
      }),
    );
  }

  /**
   * Deleting a doctor leaves their appointments in place with a null doctor
   * (`onDelete: SetNull`), so patient history survives. The caller is told how
   * many were affected rather than discovering it later.
   */
  async deleteDoctor(doctorId: string): Promise<void> {
    const clinic = await this.requireClinic();
    await this.deps.clinics.deleteDoctor(clinic.id, doctorId);
  }

  // ── services ──────────────────────────────────────────────────────

  async listServices(activeOnly = false): Promise<ClinicServiceDto[]> {
    const clinic = await this.requireClinic();
    return (await this.deps.clinics.listServices(clinic.id, activeOnly)).map(toClinicServiceDto);
  }

  async createService(body: UpsertClinicServiceBody): Promise<ClinicServiceDto> {
    const clinic = await this.requireClinic();
    return toClinicServiceDto(
      await this.deps.clinics.createService(clinic.id, {
        serviceName: body.serviceName,
        description: body.description,
        startingPrice: body.startingPrice,
        duration: body.durationMinutes,
        isActive: body.isActive,
      }),
    );
  }

  async updateService(serviceId: string, body: UpsertClinicServiceBody): Promise<ClinicServiceDto> {
    const clinic = await this.requireClinic();
    return toClinicServiceDto(
      await this.deps.clinics.updateService(clinic.id, serviceId, {
        serviceName: body.serviceName,
        description: body.description,
        startingPrice: body.startingPrice,
        duration: body.durationMinutes,
        isActive: body.isActive,
      }),
    );
  }

  async deleteService(serviceId: string): Promise<void> {
    const clinic = await this.requireClinic();
    await this.deps.clinics.deleteService(clinic.id, serviceId);
  }

  // ── FAQs ──────────────────────────────────────────────────────────

  async listFaqs(): Promise<ClinicFaqDto[]> {
    const clinic = await this.requireClinic();
    return (await this.deps.clinics.listFaqs(clinic.id)).map(toClinicFaqDto);
  }

  async createFaq(body: UpsertClinicFaqBody): Promise<ClinicFaqDto> {
    const clinic = await this.requireClinic();
    return toClinicFaqDto(
      await this.deps.clinics.createFaq(clinic.id, {
        question: body.question,
        answer: body.answer,
        keywords: serialiseKeywords(body.keywords),
      }),
    );
  }

  async updateFaq(faqId: string, body: UpsertClinicFaqBody): Promise<ClinicFaqDto> {
    const clinic = await this.requireClinic();
    return toClinicFaqDto(
      await this.deps.clinics.updateFaq(clinic.id, faqId, {
        question: body.question,
        answer: body.answer,
        keywords: serialiseKeywords(body.keywords),
      }),
    );
  }

  async deleteFaq(faqId: string): Promise<void> {
    const clinic = await this.requireClinic();
    await this.deps.clinics.deleteFaq(clinic.id, faqId);
  }

  async importFaqs(body: ImportClinicFaqsBody): Promise<{ imported: number; mode: string }> {
    const clinic = await this.requireClinic();
    const imported = await this.deps.clinics.importFaqs(
      clinic.id,
      body.faqs.map((faq) => ({
        question: faq.question,
        answer: faq.answer,
        keywords: serialiseKeywords(faq.keywords),
      })),
      body.mode,
    );
    return { imported, mode: body.mode };
  }

  // ── AI settings ───────────────────────────────────────────────────

  async getAiSettings(): Promise<AiSettingsDto | null> {
    const clinic = await this.requireClinic();
    const settings = await this.deps.clinics.findAiSettings(clinic.id);
    return settings ? toAiSettingsDto(settings) : null;
  }

  /**
   * A real upsert. The previous client called
   * `upsert(..., { onConflict: 'clinic_id' })`, the compat endpoint ignored
   * `onConflict` and issued a `create`, and the row already existed from setup
   * — so **every** AI settings save returned a unique-constraint error.
   */
  async upsertAiSettings(body: UpsertAiSettingsBody): Promise<AiSettingsDto> {
    const clinic = await this.requireClinic();

    // Handover must stay on when escalation keywords are configured, or the
    // keywords silently do nothing and a patient asking for a human is ignored.
    if (body.escalationKeywords.length > 0 && !body.humanHandoverEnabled) {
      throw new ValidationError(
        'Escalation keywords require human handover to be enabled, otherwise they have no effect.',
        { details: { field: 'humanHandoverEnabled' } },
      );
    }

    return toAiSettingsDto(
      await this.deps.clinics.upsertAiSettings(clinic.id, {
        aiEnabled: body.aiEnabled,
        aiTone: body.aiTone,
        supportedLanguages: body.supportedLanguages,
        greetingMessage: body.greetingMessage,
        afterHoursMessage: body.afterHoursMessage,
        escalationKeywords: body.escalationKeywords,
        emergencyKeywords: body.emergencyKeywords,
        humanHandoverEnabled: body.humanHandoverEnabled,
        inboundRoutingMode: body.inboundRoutingMode,
      }),
    );
  }
}

/**
 * Keywords are stored comma-separated in a `Text` column. Commas inside a
 * keyword would corrupt the round-trip, so they are stripped rather than
 * silently splitting one keyword into two.
 */
function serialiseKeywords(keywords: string[]): string | null {
  const cleaned = keywords
    .map((keyword) => keyword.replace(/,/g, ' ').trim())
    .filter((keyword) => keyword.length > 0);
  return cleaned.length > 0 ? cleaned.join(',') : null;
}
