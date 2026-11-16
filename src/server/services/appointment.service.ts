/**
 * Appointment booking rules.
 *
 * The invariant that matters: **a slot that can be booked is exactly a slot
 * that was offered.** Both paths go through `computeDaySlots`, so the
 * availability endpoint and the booking endpoint cannot disagree. Previously
 * the AI built its own 7-day grid while assembling a prompt and the booking
 * path re-derived a subset of the rules, which is how a patient could be
 * offered a lunchtime slot.
 *
 * Collision safety is the repository's job (`Serializable` check-then-insert);
 * this service turns a lost race into a 409 the caller can act on.
 */

import { ConflictError, NotFoundError, ValidationError, type Page, type TenantDb } from '../kernel';
import { toDateOnly } from '../dtos/common.dto';
import {
  REMINDER_OFFSETS,
  hasReminderBeenSent,
  toAiChatLogDto,
  toAppointmentDto,
  toPatientFeedbackDto,
  toPatientIntakeDto,
  type AiChatLogDto,
  type AppointmentDto,
  type DoctorAvailabilityDto,
  type PatientFeedbackDto,
  type PatientIntakeDto,
  type ReminderOffset,
} from '../dtos/appointment.dto';
import { toClinicTimingDto, toDoctorDto } from '../dtos/clinic.dto';
import { AppointmentRepository } from '../repositories/appointment.repository';
import { ClinicRepository } from '../repositories/clinic.repository';
import { ContactRepository } from '../repositories/contact.repository';
import type {
  AvailabilityQuery,
  BookAppointmentBody,
  ListAppointmentsQuery,
  RecordFeedbackBody,
  RecordIntakeBody,
  RescheduleAppointmentBody,
  SetAppointmentStatusBody,
} from '../validators/clinic.validator';
import {
  addDays,
  computeDaySlots,
  todayUtc,
  type DayTiming,
  type DoctorAvailabilityInput,
} from './availability';

/** Fallback consultation length when no service defines one. */
const DEFAULT_SLOT_MINUTES = 30;

export interface AppointmentServiceDeps {
  appointments: AppointmentRepository;
  clinics: ClinicRepository;
  contacts: Pick<ContactRepository, 'exists'>;
}

export class AppointmentService {
  constructor(private readonly deps: AppointmentServiceDeps) {}

  static create(db: TenantDb): AppointmentService {
    return new AppointmentService({
      appointments: new AppointmentRepository(db),
      clinics: new ClinicRepository(db),
      contacts: new ContactRepository(db),
    });
  }

  private async requireClinic(): Promise<{ id: string; dateExceptions: unknown }> {
    const clinic = await this.deps.clinics.find();
    if (!clinic) {
      throw new NotFoundError('Clinic', {
        details: { hint: 'Complete the healthcare setup step first.' },
      });
    }
    return clinic;
  }

  /** Shortest active service duration, which is the finest bookable grid. */
  private async resolveSlotMinutes(clinicId: string): Promise<number> {
    const services = await this.deps.clinics.listServices(clinicId, true);
    const durations = services.map((service) => service.duration).filter((value) => value > 0);
    return durations.length > 0 ? Math.min(...durations) : DEFAULT_SLOT_MINUTES;
  }

  private async loadSlotContext(clinicId: string, doctorId: string) {
    const doctor = await this.deps.clinics.findDoctor(clinicId, doctorId);
    if (!doctor) throw new NotFoundError('Doctor');

    const [timings, slotMinutes, clinic] = await Promise.all([
      this.deps.clinics.listTimings(clinicId),
      this.resolveSlotMinutes(clinicId),
      this.requireClinic(),
    ]);

    const doctorDto = toDoctorDto(doctor);
    const timingDtos: DayTiming[] = timings.map(toClinicTimingDto);
    const doctorAvailability: DoctorAvailabilityInput = {
      availableDays: doctorDto.availableDays,
      availableStartTime: doctorDto.availableStartTime,
      availableEndTime: doctorDto.availableEndTime,
      dateExceptions: doctorDto.dateExceptions,
    };

    return {
      doctor: doctorDto,
      timings: timingDtos,
      slotMinutes,
      clinicDateExceptions: asRecord(clinic.dateExceptions),
      doctorAvailability,
    };
  }

  async list(query: ListAppointmentsQuery): Promise<Page<AppointmentDto>> {
    const clinic = await this.requireClinic();

    if (query.from && query.to && query.from > query.to) {
      throw new ValidationError('The start of the range must not be after its end.');
    }

    const page = await this.deps.appointments.list(
      clinic.id,
      {
        status: query.status,
        doctorId: query.doctorId,
        contactId: query.contactId,
        from: query.from,
        to: query.to,
        search: query.search,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return { ...page, items: page.items.map(toAppointmentDto) };
  }

  async getById(appointmentId: string): Promise<AppointmentDto> {
    const clinic = await this.requireClinic();
    return toAppointmentDto(await this.deps.appointments.findById(clinic.id, appointmentId));
  }

  /**
   * Free slots per day for a doctor. This is the single source the AI, the
   * booking form, and the booking guard all read.
   */
  async availability(query: AvailabilityQuery, now = new Date()): Promise<DoctorAvailabilityDto> {
    const clinic = await this.requireClinic();
    const context = await this.loadSlotContext(clinic.id, query.doctorId);

    const startDate = query.from ? (toDateOnly(query.from) ?? todayUtc(now)) : todayUtc(now);
    const endDate = addDays(startDate, query.days - 1);

    const booked = await this.deps.appointments.findBookedSlots(
      query.doctorId,
      new Date(`${startDate}T00:00:00.000Z`),
      new Date(`${endDate}T00:00:00.000Z`),
    );

    // Bucket bookings by date once, rather than filtering the list per day.
    const bookedByDate = new Map<string, string[]>();
    for (const row of booked) {
      const key = toDateOnly(row.appointmentDate);
      if (!key) continue;
      const bucket = bookedByDate.get(key);
      if (bucket) bucket.push(row.appointmentTime);
      else bookedByDate.set(key, [row.appointmentTime]);
    }

    const days = Array.from({ length: query.days }, (_, offset) => {
      const date = addDays(startDate, offset);
      return computeDaySlots({
        date,
        timings: context.timings,
        clinicDateExceptions: context.clinicDateExceptions,
        doctor: context.doctorAvailability,
        slotMinutes: context.slotMinutes,
        bookedTimes: bookedByDate.get(date) ?? [],
        now,
      });
    });

    return {
      doctorId: context.doctor.id,
      doctorName: context.doctor.doctorName,
      days,
    };
  }

  /** Rejects a slot that availability would not have offered. */
  private async assertSlotOffered(input: {
    clinicId: string;
    doctorId: string;
    date: string;
    time: string;
    now: Date;
    excludeAppointmentId?: string;
  }): Promise<void> {
    const context = await this.loadSlotContext(input.clinicId, input.doctorId);

    const dateAsDate = new Date(`${input.date}T00:00:00.000Z`);
    const booked = await this.deps.appointments.findBookedSlots(
      input.doctorId,
      dateAsDate,
      dateAsDate,
      // Rescheduling must not see its own slot as taken.
      input.excludeAppointmentId,
    );
    const bookedTimes = booked.map((row) => row.appointmentTime);

    const day = computeDaySlots({
      date: input.date,
      timings: context.timings,
      clinicDateExceptions: context.clinicDateExceptions,
      doctor: context.doctorAvailability,
      slotMinutes: context.slotMinutes,
      bookedTimes,
      now: input.now,
    });

    if (!day.slots.includes(input.time)) {
      throw new ConflictError(
        day.closedReason ?? `${input.time} is not an available slot on ${input.date}.`,
        {
          details: {
            date: input.date,
            time: input.time,
            availableSlots: day.slots.slice(0, 12),
          },
        },
      );
    }
  }

  async book(body: BookAppointmentBody, now = new Date()): Promise<AppointmentDto> {
    const clinic = await this.requireClinic();

    if (!(await this.deps.contacts.exists(body.contactId))) {
      throw new NotFoundError('Contact');
    }

    const date = toDateOnly(body.appointmentDate);
    if (!date) throw new ValidationError('Invalid appointment date.');

    await this.assertSlotOffered({
      clinicId: clinic.id,
      doctorId: body.doctorId,
      date,
      time: body.appointmentTime,
      now,
    });

    const appointment = await this.deps.appointments.book({
      clinicId: clinic.id,
      contactId: body.contactId,
      doctorId: body.doctorId,
      appointmentDate: body.appointmentDate,
      appointmentTime: body.appointmentTime,
      patientName: body.patientName,
      patientAge: body.patientAge,
      reasonForVisit: body.reasonForVisit,
    });

    if (!appointment) {
      // The slot was free when we checked and taken by the time we inserted.
      // Real, and common when a patient double-taps a WhatsApp button.
      throw new ConflictError('That slot was just taken. Please choose another time.', {
        details: { date, time: body.appointmentTime },
      });
    }

    return toAppointmentDto(appointment);
  }

  async reschedule(
    appointmentId: string,
    body: RescheduleAppointmentBody,
    now = new Date(),
  ): Promise<AppointmentDto> {
    const clinic = await this.requireClinic();
    const existing = await this.deps.appointments.findById(clinic.id, appointmentId);

    if (existing.status === 'cancelled') {
      throw new ConflictError('A cancelled appointment cannot be rescheduled. Book a new one.');
    }
    if (existing.status === 'completed') {
      throw new ConflictError('A completed appointment cannot be rescheduled.');
    }

    const doctorId = body.doctorId ?? existing.doctorId;
    if (!doctorId) {
      throw new ValidationError('This appointment has no doctor assigned; choose one to reschedule.');
    }

    const date = toDateOnly(body.appointmentDate);
    if (!date) throw new ValidationError('Invalid appointment date.');

    await this.assertSlotOffered({
      clinicId: clinic.id,
      doctorId,
      date,
      time: body.appointmentTime,
      now,
      excludeAppointmentId: appointmentId,
    });

    const moved = await this.deps.appointments.reschedule({
      clinicId: clinic.id,
      appointmentId,
      doctorId,
      appointmentDate: body.appointmentDate,
      appointmentTime: body.appointmentTime,
    });

    if (!moved) {
      throw new ConflictError('That slot was just taken. Please choose another time.', {
        details: { date, time: body.appointmentTime },
      });
    }

    return toAppointmentDto(moved);
  }

  /**
   * Status changes follow the obvious lifecycle. `cancelled` and `completed`
   * are terminal: reopening a completed visit would silently re-arm its
   * reminders and feedback request.
   */
  async setStatus(appointmentId: string, body: SetAppointmentStatusBody): Promise<AppointmentDto> {
    const clinic = await this.requireClinic();
    const existing = await this.deps.appointments.findById(clinic.id, appointmentId);

    if (existing.status === body.status) {
      return toAppointmentDto(existing);
    }
    if (existing.status === 'cancelled' || existing.status === 'completed') {
      throw new ConflictError(`A ${existing.status} appointment can no longer change status.`, {
        details: { from: existing.status, to: body.status },
      });
    }

    return toAppointmentDto(
      await this.deps.appointments.setStatus(clinic.id, appointmentId, body.status),
    );
  }

  /**
   * Appointments due a reminder at the given offset.
   *
   * Returns candidates plus the offset so the caller sends and then calls
   * `markReminderSent`. The three previous cron implementations all queried
   * `reminder_24h_sent` / `reminder_4h_sent` / `reminder_2h_sent` — columns
   * that do not exist — so none of them ever sent a reminder.
   */
  async findRemindersDue(
    offset: ReminderOffset,
    now = new Date(),
    limit = 100,
  ): Promise<AppointmentDto[]> {
    const clinic = await this.requireClinic();

    const hoursAhead = offset === '24h' ? 24 : offset === '4h' ? 4 : 2;
    const target = new Date(now.getTime() + hoursAhead * 3_600_000);

    // The date window is deliberately wide (the appointment date is date-only);
    // the precise cutoff is applied below against date + time.
    const from = new Date(`${todayUtc(now)}T00:00:00.000Z`);
    const to = new Date(`${addDays(todayUtc(target), 1)}T00:00:00.000Z`);

    const candidates = await this.deps.appointments.findUpcoming(clinic.id, from, to, limit * 4);

    return candidates
      .filter((appointment) => {
        if (hasReminderBeenSent(appointment.remindersSent, offset)) return false;

        const date = toDateOnly(appointment.appointmentDate);
        if (!date) return false;
        const at = new Date(`${date}T${appointment.appointmentTime}:00.000Z`);

        // Due when the appointment is inside the window and still ahead of now.
        return at.getTime() > now.getTime() && at.getTime() <= target.getTime();
      })
      .slice(0, limit)
      .map(toAppointmentDto);
  }

  async markReminderSent(appointmentId: string, offset: ReminderOffset): Promise<boolean> {
    return this.deps.appointments.markReminderSent(appointmentId, offset);
  }

  /** Completed visits awaiting a feedback request. */
  async findFeedbackDue(now = new Date(), limit = 100): Promise<AppointmentDto[]> {
    const clinic = await this.requireClinic();
    const from = new Date(now.getTime() - 7 * 86_400_000);
    const candidates = await this.deps.appointments.findUpcoming(clinic.id, from, now, limit * 4);
    return candidates
      .filter((appointment) => !appointment.feedbackSent)
      .slice(0, limit)
      .map(toAppointmentDto);
  }

  async markFeedbackSent(appointmentId: string): Promise<boolean> {
    return this.deps.appointments.markFeedbackSent(appointmentId);
  }

  async markSheetsSynced(appointmentId: string): Promise<void> {
    await this.deps.appointments.markSheetsSynced(appointmentId);
  }

  // ── intake / feedback / logs ───────────────────────────────────────

  async recordIntake(body: RecordIntakeBody): Promise<PatientIntakeDto> {
    const clinic = await this.requireClinic();
    if (!(await this.deps.contacts.exists(body.contactId))) throw new NotFoundError('Contact');

    if (body.appointmentId) {
      // Confirms the appointment is this clinic's before linking.
      await this.deps.appointments.findById(clinic.id, body.appointmentId);
    }

    return toPatientIntakeDto(
      await this.deps.appointments.createIntake({
        clinicId: clinic.id,
        contactId: body.contactId,
        appointmentId: body.appointmentId ?? null,
        symptoms: body.symptoms,
        allergies: body.allergies,
        currentMedications: body.currentMedications,
        medicalHistory: body.medicalHistory,
        urgencyLevel: body.urgencyLevel ?? null,
      }),
    );
  }

  async listIntakes(page: number, pageSize: number): Promise<Page<PatientIntakeDto>> {
    const clinic = await this.requireClinic();
    const result = await this.deps.appointments.listIntakes(clinic.id, { page, pageSize });
    return { ...result, items: result.items.map(toPatientIntakeDto) };
  }

  async recordFeedback(body: RecordFeedbackBody): Promise<PatientFeedbackDto> {
    const clinic = await this.requireClinic();
    if (!(await this.deps.contacts.exists(body.contactId))) throw new NotFoundError('Contact');

    if (body.appointmentId) {
      await this.deps.appointments.findById(clinic.id, body.appointmentId);
    }

    return toPatientFeedbackDto(
      await this.deps.appointments.createFeedback({
        clinicId: clinic.id,
        contactId: body.contactId,
        appointmentId: body.appointmentId ?? null,
        rating: body.rating,
        feedbackText: body.feedbackText,
      }),
    );
  }

  async listFeedback(page: number, pageSize: number): Promise<Page<PatientFeedbackDto>> {
    const clinic = await this.requireClinic();
    const result = await this.deps.appointments.listFeedback(clinic.id, { page, pageSize });
    return { ...result, items: result.items.map(toPatientFeedbackDto) };
  }

  async feedbackSummary(): Promise<{ average: number | null; count: number }> {
    const clinic = await this.requireClinic();
    return this.deps.appointments.averageRating(clinic.id);
  }

  /** AI conversation log — the page that returned 400 for an unmapped table. */
  async listAiChatLogs(page: number, pageSize: number): Promise<Page<AiChatLogDto>> {
    const clinic = await this.requireClinic();
    const result = await this.deps.appointments.listAiChatLogs(clinic.id, { page, pageSize });
    return { ...result, items: result.items.map(toAiChatLogDto) };
  }

  /** Reminder offsets, newest-first, for a cron that sweeps all three. */
  static reminderOffsets(): readonly ReminderOffset[] {
    return REMINDER_OFFSETS;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
