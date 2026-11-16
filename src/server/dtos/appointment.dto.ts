/**
 * Appointment, intake, feedback and AI-log wire contracts.
 */

import { z } from 'zod';

import { dateOnlySchema, isoDateSchema, jsonValueSchema, toDateOnly, toIso, toJsonObject, toNumberOrNull } from './common.dto';
import { timeOfDaySchema } from '../validators/common.validator';

export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const URGENCY_LEVELS = ['emergency', 'urgent', 'routine', 'self_care'] as const;
export const urgencyLevelSchema = z.enum(URGENCY_LEVELS);

/**
 * Which reminders have gone out. The column is a `Json` blob
 * (`Appointment.remindersSent`); the three cron implementations each expected
 * dedicated boolean columns (`reminder_24h_sent`, `reminder_4h_sent`,
 * `reminder_2h_sent`) that do not exist, which is one of the reasons none of
 * them worked.
 */
export const REMINDER_OFFSETS = ['24h', '4h', '2h'] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

export const remindersSentDtoSchema = z.object({
  '24h': isoDateSchema.nullable(),
  '4h': isoDateSchema.nullable(),
  '2h': isoDateSchema.nullable(),
});
export type RemindersSentDto = z.infer<typeof remindersSentDtoSchema>;

export function toRemindersSentDto(value: unknown): RemindersSentDto {
  const record = toJsonObject(value);
  const read = (key: ReminderOffset): string | null => {
    const entry = record[key];
    if (typeof entry === 'string') return entry;
    // Legacy shape stored `true` with no timestamp; treat it as sent-at-unknown
    // rather than losing the fact that it went out.
    if (entry === true) return null;
    return null;
  };
  return { '24h': read('24h'), '4h': read('4h'), '2h': read('2h') };
}

export function hasReminderBeenSent(value: unknown, offset: ReminderOffset): boolean {
  const record = toJsonObject(value);
  const entry = record[offset];
  return entry === true || typeof entry === 'string';
}

// ── appointment ─────────────────────────────────────────────────────

export const appointmentDtoSchema = z.object({
  id: z.string(),
  /** `YYYY-MM-DD`, never a timestamp — the column is `@db.Date`. */
  appointmentDate: dateOnlySchema,
  appointmentTime: timeOfDaySchema,
  status: appointmentStatusSchema,
  patientName: z.string().nullable(),
  patientAge: z.string().nullable(),
  reasonForVisit: z.string().nullable(),
  remindersSent: remindersSentDtoSchema,
  feedbackSent: z.boolean(),
  followupSent: z.boolean(),
  sheetsSynced: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  /** Always populated. Every appointment route used to 400 without it. */
  contact: z
    .object({ id: z.string(), phone: z.string(), name: z.string().nullable() })
    .nullable(),
  doctor: z
    .object({ id: z.string(), doctorName: z.string(), specialization: z.string().nullable() })
    .nullable(),
});
export type AppointmentDto = z.infer<typeof appointmentDtoSchema>;

interface AppointmentRow {
  id: string;
  appointmentDate: Date;
  appointmentTime: string;
  status: string;
  patientName: string | null;
  patientAge: string | null;
  reasonForVisit: string | null;
  remindersSent: unknown;
  feedbackSent: boolean;
  followupSent: boolean;
  sheetsSynced: boolean;
  createdAt: Date;
  updatedAt: Date;
  contact?: { id: string; phone: string; name: string | null } | null;
  doctor?: { id: string; doctorName: string; specialization: string | null } | null;
}

export function toAppointmentDto(row: AppointmentRow): AppointmentDto {
  const status = appointmentStatusSchema.safeParse(row.status);
  const time = timeOfDaySchema.safeParse(row.appointmentTime);
  return {
    id: row.id,
    // `toDateOnly` reads the UTC calendar date, matching how the write side
    // stores it (UTC midnight). Reading it in server-local time is what made
    // dates appear a day early on hosts ahead of UTC.
    appointmentDate: toDateOnly(row.appointmentDate) ?? '1970-01-01',
    appointmentTime: time.success ? time.data : '00:00',
    status: status.success ? status.data : 'scheduled',
    patientName: row.patientName ?? null,
    patientAge: row.patientAge ?? null,
    reasonForVisit: row.reasonForVisit ?? null,
    remindersSent: toRemindersSentDto(row.remindersSent),
    feedbackSent: row.feedbackSent,
    followupSent: row.followupSent,
    sheetsSynced: row.sheetsSynced,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    contact: row.contact
      ? { id: row.contact.id, phone: row.contact.phone, name: row.contact.name ?? null }
      : null,
    doctor: row.doctor
      ? {
          id: row.doctor.id,
          doctorName: row.doctor.doctorName,
          specialization: row.doctor.specialization ?? null,
        }
      : null,
  };
}

// ── availability ────────────────────────────────────────────────────

export const availableSlotDtoSchema = z.object({
  date: dateOnlySchema,
  time: timeOfDaySchema,
});

export const doctorAvailabilityDtoSchema = z.object({
  doctorId: z.string(),
  doctorName: z.string(),
  days: z.array(
    z.object({
      date: dateOnlySchema,
      weekday: z.string(),
      /** Why no slots exist, when the list is empty. */
      closedReason: z.string().nullable(),
      slots: z.array(timeOfDaySchema),
    }),
  ),
});
export type DoctorAvailabilityDto = z.infer<typeof doctorAvailabilityDtoSchema>;

// ── intake / feedback / AI log ───────────────────────────────────────

export const patientIntakeDtoSchema = z.object({
  id: z.string(),
  appointmentId: z.string().nullable(),
  symptoms: z.string().nullable(),
  allergies: z.string().nullable(),
  currentMedications: z.string().nullable(),
  medicalHistory: z.string().nullable(),
  urgencyLevel: urgencyLevelSchema.nullable(),
  triageResult: z.record(jsonValueSchema),
  collectedVia: z.string(),
  createdAt: isoDateSchema,
  contact: z.object({ id: z.string(), phone: z.string(), name: z.string().nullable() }).nullable(),
});
export type PatientIntakeDto = z.infer<typeof patientIntakeDtoSchema>;

export function toPatientIntakeDto(row: {
  id: string;
  appointmentId: string | null;
  symptoms: string | null;
  allergies: string | null;
  currentMedications: string | null;
  medicalHistory: string | null;
  urgencyLevel: string | null;
  triageResult: unknown;
  collectedVia: string;
  createdAt: Date;
  contact?: { id: string; phone: string; name: string | null } | null;
}): PatientIntakeDto {
  const urgency = urgencyLevelSchema.safeParse(row.urgencyLevel);
  return {
    id: row.id,
    appointmentId: row.appointmentId ?? null,
    symptoms: row.symptoms ?? null,
    allergies: row.allergies ?? null,
    currentMedications: row.currentMedications ?? null,
    medicalHistory: row.medicalHistory ?? null,
    urgencyLevel: urgency.success ? urgency.data : null,
    triageResult: toJsonObject(row.triageResult),
    collectedVia: row.collectedVia,
    createdAt: toIso(row.createdAt),
    contact: row.contact
      ? { id: row.contact.id, phone: row.contact.phone, name: row.contact.name ?? null }
      : null,
  };
}

export const patientFeedbackDtoSchema = z.object({
  id: z.string(),
  appointmentId: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  feedbackText: z.string().nullable(),
  createdAt: isoDateSchema,
  contact: z.object({ id: z.string(), phone: z.string(), name: z.string().nullable() }).nullable(),
});
export type PatientFeedbackDto = z.infer<typeof patientFeedbackDtoSchema>;

export function toPatientFeedbackDto(row: {
  id: string;
  appointmentId: string | null;
  rating: number;
  feedbackText: string | null;
  createdAt: Date;
  contact?: { id: string; phone: string; name: string | null } | null;
}): PatientFeedbackDto {
  return {
    id: row.id,
    appointmentId: row.appointmentId ?? null,
    // Clamped: a rating outside 1–5 would fail the response contract and take
    // the whole feedback list down over one bad row.
    rating: Math.min(5, Math.max(1, row.rating)),
    feedbackText: row.feedbackText ?? null,
    createdAt: toIso(row.createdAt),
    contact: row.contact
      ? { id: row.contact.id, phone: row.contact.phone, name: row.contact.name ?? null }
      : null,
  };
}

/**
 * AI conversation log.
 *
 * The healthcare logs page returned `400 Prisma model not found:
 * ai_chat_logs` because the compat endpoint had no mapping for the table, so
 * the page and the "AI conversations" dashboard metric never rendered.
 */
export const aiChatLogDtoSchema = z.object({
  id: z.string(),
  userMessage: z.string(),
  aiResponse: z.string(),
  detectedIntent: z.string().nullable(),
  confidenceScore: z.number().nullable(),
  createdAt: isoDateSchema,
  contact: z.object({ id: z.string(), phone: z.string(), name: z.string().nullable() }).nullable(),
});
export type AiChatLogDto = z.infer<typeof aiChatLogDtoSchema>;

export function toAiChatLogDto(row: {
  id: string;
  userMessage: string;
  aiResponse: string;
  detectedIntent: string | null;
  confidenceScore: { toString(): string } | number | null;
  createdAt: Date;
  patient?: { id: string; phone: string; name: string | null } | null;
}): AiChatLogDto {
  return {
    id: row.id,
    userMessage: row.userMessage,
    aiResponse: row.aiResponse,
    detectedIntent: row.detectedIntent ?? null,
    confidenceScore: toNumberOrNull(row.confidenceScore),
    createdAt: toIso(row.createdAt),
    contact: row.patient
      ? { id: row.patient.id, phone: row.patient.phone, name: row.patient.name ?? null }
      : null,
  };
}
