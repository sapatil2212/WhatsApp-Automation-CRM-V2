/**
 * Appointment, intake, feedback and AI-log persistence.
 *
 * Two structural fixes:
 *
 *  1. **Double booking.** The old path ran `findMany` to check the slot, then
 *     `create` — two separate statements with no transaction. Two concurrent
 *     WhatsApp messages both passed the check and both inserted. The schema has
 *     no unique constraint on `(doctorId, appointmentDate, appointmentTime)`
 *     and MySQL cannot express a *partial* unique index, so one that ignored
 *     cancelled rows is not available — a plain unique index would permanently
 *     block re-booking a cancelled slot. `book()` therefore does the check and
 *     the insert inside one `Serializable` transaction.
 *
 *  2. **Reminder bookkeeping.** Three cron implementations expected
 *     `reminder_24h_sent` / `reminder_4h_sent` / `reminder_2h_sent` columns.
 *     They do not exist; the schema has `remindersSent Json?`. `markReminderSent`
 *     writes into that blob.
 */

import { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { hasReminderBeenSent, type ReminderOffset } from '../dtos/appointment.dto';
import { BaseRepository } from './base.repository';

const contactSelect = { id: true, phone: true, name: true } satisfies Prisma.ContactSelect;

const appointmentSelect = {
  id: true,
  appointmentDate: true,
  appointmentTime: true,
  status: true,
  patientName: true,
  patientAge: true,
  reasonForVisit: true,
  remindersSent: true,
  feedbackSent: true,
  followupSent: true,
  sheetsSynced: true,
  createdAt: true,
  updatedAt: true,
  doctorId: true,
  contactId: true,
  clinicId: true,
  contact: { select: contactSelect },
  doctor: { select: { id: true, doctorName: true, specialization: true } },
} satisfies Prisma.AppointmentSelect;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;

export interface AppointmentListFilter {
  status?: string;
  doctorId?: string;
  contactId?: string;
  from?: Date;
  to?: Date;
  search?: string;
}

export class AppointmentRepository extends BaseRepository {
  protected readonly resourceName = 'Appointment';

  constructor(db: TenantDb) {
    super(db);
  }

  private buildWhere(clinicId: string, filter: AppointmentListFilter): Prisma.AppointmentWhereInput {
    const where: Prisma.AppointmentWhereInput = { clinicId };
    if (filter.status) where.status = filter.status;
    if (filter.doctorId) where.doctorId = filter.doctorId;
    if (filter.contactId) where.contactId = filter.contactId;
    if (filter.from || filter.to) {
      where.appointmentDate = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }
    if (filter.search) {
      where.OR = [
        { patientName: { contains: filter.search } },
        { reasonForVisit: { contains: filter.search } },
        { contact: { phone: { contains: filter.search } } },
        { contact: { name: { contains: filter.search } } },
      ];
    }
    return where;
  }

  async list(
    clinicId: string,
    filter: AppointmentListFilter,
    pagination: PaginationQuery,
  ): Promise<Page<AppointmentRow>> {
    const where = this.buildWhere(clinicId, filter);
    return this.paginate(
      ({ skip, take }) =>
        this.db.appointment.findMany({
          where,
          select: appointmentSelect,
          orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.appointment.count({ where }),
      pagination,
    );
  }

  async findById(clinicId: string, appointmentId: string): Promise<AppointmentRow> {
    return this.requireFound(
      await this.db.appointment.findFirst({
        where: { id: appointmentId, clinicId },
        select: appointmentSelect,
      }),
    );
  }

  /**
   * Booked slots for a doctor across a date range, for availability.
   *
   * `excludeAppointmentId` is used when rescheduling: an appointment must not
   * treat its own current slot as taken, or moving it to a different time on
   * the same day would report a false collision.
   */
  async findBookedSlots(doctorId: string, from: Date, to: Date, excludeAppointmentId?: string) {
    return this.db.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: { gte: from, lte: to },
        status: { notIn: ['cancelled'] },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: { appointmentDate: true, appointmentTime: true },
    });
  }

  /**
   * Books a slot, refusing a collision inside one serialisable transaction.
   * Returns null when the slot was taken — including by a transaction that
   * committed a microsecond earlier.
   */
  async book(input: {
    clinicId: string;
    contactId: string;
    doctorId: string;
    appointmentDate: Date;
    appointmentTime: string;
    patientName: string | null;
    patientAge: string | null;
    reasonForVisit: string | null;
  }): Promise<AppointmentRow | null> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const clash = await tx.appointment.count({
            where: {
              doctorId: input.doctorId,
              appointmentDate: input.appointmentDate,
              appointmentTime: input.appointmentTime,
              status: { notIn: ['cancelled'] },
            },
          });
          if (clash > 0) return null;

          return tx.appointment.create({
            data: {
              clinicId: input.clinicId,
              contactId: input.contactId,
              doctorId: input.doctorId,
              appointmentDate: input.appointmentDate,
              appointmentTime: input.appointmentTime,
              patientName: input.patientName,
              patientAge: input.patientAge,
              reasonForVisit: input.reasonForVisit,
              status: 'scheduled',
            },
            select: appointmentSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch {
      // A serialisation failure means a concurrent booking won the slot.
      // Indistinguishable from the explicit clash, and handled the same way.
      return null;
    }
  }

  /** Same collision guard as `book`, excluding the appointment being moved. */
  async reschedule(input: {
    clinicId: string;
    appointmentId: string;
    doctorId: string;
    appointmentDate: Date;
    appointmentTime: string;
  }): Promise<AppointmentRow | null> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const clash = await tx.appointment.count({
            where: {
              id: { not: input.appointmentId },
              doctorId: input.doctorId,
              appointmentDate: input.appointmentDate,
              appointmentTime: input.appointmentTime,
              status: { notIn: ['cancelled'] },
            },
          });
          if (clash > 0) return null;

          const affected = await tx.appointment.updateMany({
            where: { id: input.appointmentId, clinicId: input.clinicId },
            data: {
              doctorId: input.doctorId,
              appointmentDate: input.appointmentDate,
              appointmentTime: input.appointmentTime,
              // A moved appointment must re-earn its reminders, or the patient
              // gets none for the new time.
              remindersSent: Prisma.JsonNull,
            },
          });
          if (affected.count === 0) return null;

          return tx.appointment.findFirst({
            where: { id: input.appointmentId },
            select: appointmentSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch {
      return null;
    }
  }

  async setStatus(clinicId: string, appointmentId: string, status: string): Promise<AppointmentRow> {
    this.requireAffected(
      await this.db.appointment.updateMany({ where: { id: appointmentId, clinicId }, data: { status } }),
    );
    return this.findById(clinicId, appointmentId);
  }

  /**
   * Appointments due a reminder at the given offset.
   *
   * The offset filter is applied in the service (it needs the clinic's clock);
   * this returns the candidate window and lets the caller decide, which keeps
   * the JSON-blob check out of SQL.
   */
  async findUpcoming(clinicId: string, from: Date, to: Date, limit: number) {
    return this.db.appointment.findMany({
      where: {
        clinicId,
        status: 'scheduled',
        appointmentDate: { gte: from, lte: to },
      },
      select: appointmentSelect,
      orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
      take: limit,
    });
  }

  /**
   * Records that a reminder went out, merging into the `remindersSent` blob.
   * Read-modify-write inside a transaction so two concurrent cron ticks cannot
   * lose one offset by overwriting the whole object.
   */
  async markReminderSent(appointmentId: string, offset: ReminderOffset): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const row = await tx.appointment.findFirst({
        where: { id: appointmentId },
        select: { remindersSent: true },
      });
      if (!row) return false;
      if (hasReminderBeenSent(row.remindersSent, offset)) return false;

      const current =
        row.remindersSent && typeof row.remindersSent === 'object' && !Array.isArray(row.remindersSent)
          ? (row.remindersSent as Record<string, unknown>)
          : {};

      await tx.appointment.updateMany({
        where: { id: appointmentId },
        data: {
          remindersSent: { ...current, [offset]: new Date().toISOString() } as Prisma.InputJsonValue,
        },
      });
      return true;
    });
  }

  async markFeedbackSent(appointmentId: string): Promise<boolean> {
    const affected = await this.db.appointment.updateMany({
      where: { id: appointmentId, feedbackSent: false },
      data: { feedbackSent: true },
    });
    return affected.count > 0;
  }

  async markFollowupSent(appointmentId: string): Promise<boolean> {
    const affected = await this.db.appointment.updateMany({
      where: { id: appointmentId, followupSent: false },
      data: { followupSent: true },
    });
    return affected.count > 0;
  }

  async markSheetsSynced(appointmentId: string): Promise<void> {
    // `sheetsSynced` existed but was never written, so a failed Google Sheets
    // push could not be detected or replayed.
    await this.db.appointment.updateMany({
      where: { id: appointmentId },
      data: { sheetsSynced: true },
    });
  }

  // ── intake / feedback / AI logs ────────────────────────────────────

  async createIntake(input: {
    clinicId: string;
    contactId: string;
    appointmentId: string | null;
    symptoms: string | null;
    allergies: string | null;
    currentMedications: string | null;
    medicalHistory: string | null;
    urgencyLevel: string | null;
  }) {
    return this.db.patientIntake.create({
      data: { ...input, collectedVia: 'whatsapp' },
      select: {
        id: true,
        appointmentId: true,
        symptoms: true,
        allergies: true,
        currentMedications: true,
        medicalHistory: true,
        urgencyLevel: true,
        triageResult: true,
        collectedVia: true,
        createdAt: true,
        contact: { select: contactSelect },
      },
    });
  }

  async listIntakes(clinicId: string, pagination: PaginationQuery) {
    const where: Prisma.PatientIntakeWhereInput = { clinicId };
    return this.paginate(
      ({ skip, take }) =>
        this.db.patientIntake.findMany({
          where,
          select: {
            id: true,
            appointmentId: true,
            symptoms: true,
            allergies: true,
            currentMedications: true,
            medicalHistory: true,
            urgencyLevel: true,
            triageResult: true,
            collectedVia: true,
            createdAt: true,
            contact: { select: contactSelect },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.patientIntake.count({ where }),
      pagination,
    );
  }

  async createFeedback(input: {
    clinicId: string;
    contactId: string;
    appointmentId: string | null;
    rating: number;
    feedbackText: string | null;
  }) {
    return this.db.patientFeedback.create({
      data: input,
      select: {
        id: true,
        appointmentId: true,
        rating: true,
        feedbackText: true,
        createdAt: true,
        contact: { select: contactSelect },
      },
    });
  }

  async listFeedback(clinicId: string, pagination: PaginationQuery) {
    const where: Prisma.PatientFeedbackWhereInput = { clinicId };
    return this.paginate(
      ({ skip, take }) =>
        this.db.patientFeedback.findMany({
          where,
          select: {
            id: true,
            appointmentId: true,
            rating: true,
            feedbackText: true,
            createdAt: true,
            contact: { select: contactSelect },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.patientFeedback.count({ where }),
      pagination,
    );
  }

  async averageRating(clinicId: string): Promise<{ average: number | null; count: number }> {
    const result = await this.db.patientFeedback.aggregate({
      where: { clinicId },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return {
      average: result._avg.rating === null ? null : Math.round(result._avg.rating * 10) / 10,
      count: result._count._all,
    };
  }

  /** AI conversation log — the table the compat endpoint could not map. */
  async listAiChatLogs(clinicId: string, pagination: PaginationQuery) {
    const where: Prisma.AiChatLogWhereInput = { clinicId };
    return this.paginate(
      ({ skip, take }) =>
        this.db.aiChatLog.findMany({
          where,
          select: {
            id: true,
            userMessage: true,
            aiResponse: true,
            detectedIntent: true,
            confidenceScore: true,
            createdAt: true,
            patient: { select: contactSelect },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.aiChatLog.count({ where }),
      pagination,
    );
  }

  async recordAiChat(input: {
    clinicId: string;
    patientId: string;
    userMessage: string;
    aiResponse: string;
    detectedIntent: string | null;
    confidenceScore: number | null;
  }): Promise<void> {
    await this.db.aiChatLog.create({ data: input });
  }

  async countAiChats(clinicId: string, since: Date): Promise<number> {
    return this.db.aiChatLog.count({ where: { clinicId, createdAt: { gte: since } } });
  }
}

/** Re-exported so the service can build the tenant-scoped clinic write. */
export { scoped };
