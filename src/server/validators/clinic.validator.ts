/**
 * Healthcare vertical request schemas.
 */

import { z } from 'zod';

import { paginationQuerySchema } from '../kernel';
import { INBOUND_ROUTING_MODES, WEEKDAYS } from '../dtos/clinic.dto';
import { APPOINTMENT_STATUSES, URGENCY_LEVELS } from '../dtos/appointment.dto';
import {
  dateOnlyInputSchema,
  idSchema,
  nonEmptyPatch,
  optionalEmailSchema,
  optionalHttpUrlSchema,
  optionalPhoneSchema,
  optionalText,
  requiredText,
  searchSchema,
  timeOfDaySchema,
} from './common.validator';

// ── clinic profile ──────────────────────────────────────────────────

export const upsertClinicBodySchema = z.object({
  clinicName: requiredText(160, 'Clinic name'),
  clinicType: optionalText(80),
  clinicDescription: optionalText(2000),
  phone: optionalPhoneSchema,
  whatsappNumber: optionalPhoneSchema,
  email: optionalEmailSchema,
  website: optionalHttpUrlSchema,
  address: optionalText(500),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(20),
  googleMapLink: optionalHttpUrlSchema,
  instagramUrl: optionalHttpUrlSchema,
  facebookUrl: optionalHttpUrlSchema,
  /**
   * Extra context pasted into the AI prompt verbatim. Capped because the
   * healthcare prompt already interpolates every doctor, service, FAQ and a
   * 7-day slot grid — an unbounded blob here is what silently overruns the
   * model's context window.
   */
  aiKnowledgeBase: optionalText(8000),
});
export type UpsertClinicBody = z.infer<typeof upsertClinicBodySchema>;

// ── timings ─────────────────────────────────────────────────────────

/**
 * Full-week replacement. A partial update would leave the AI's slot grid
 * inconsistent with what the user sees on screen.
 */
export const setClinicTimingsBodySchema = z.object({
  timings: z
    .array(
      z
        .object({
          dayName: z.enum(WEEKDAYS),
          isClosed: z.boolean().default(false),
          openingTime: timeOfDaySchema.nullish(),
          closingTime: timeOfDaySchema.nullish(),
          lunchBreakStart: timeOfDaySchema.nullish(),
          lunchBreakEnd: timeOfDaySchema.nullish(),
        })
        .superRefine((timing, ctx) => {
          if (timing.isClosed) return;

          if (!timing.openingTime || !timing.closingTime) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'An open day needs both an opening and a closing time.',
              path: ['openingTime'],
            });
            return;
          }
          if (timing.openingTime >= timing.closingTime) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Closing time must be after opening time.',
              path: ['closingTime'],
            });
          }
          // A half-specified lunch break silently disabled break filtering,
          // so the AI offered slots during lunch.
          if (Boolean(timing.lunchBreakStart) !== Boolean(timing.lunchBreakEnd)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Provide both ends of the lunch break, or neither.',
              path: ['lunchBreakEnd'],
            });
            return;
          }
          if (timing.lunchBreakStart && timing.lunchBreakEnd) {
            if (timing.lunchBreakStart >= timing.lunchBreakEnd) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Lunch break end must be after its start.',
                path: ['lunchBreakEnd'],
              });
            }
            if (
              timing.lunchBreakStart < timing.openingTime ||
              timing.lunchBreakEnd > timing.closingTime
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Lunch break must fall inside opening hours.',
                path: ['lunchBreakStart'],
              });
            }
          }
        }),
    )
    .length(WEEKDAYS.length, 'Provide an entry for every day of the week.')
    .refine(
      (timings) => new Set(timings.map((timing) => timing.dayName)).size === timings.length,
      { message: 'Each day may appear only once.' },
    ),
});
export type SetClinicTimingsBody = z.infer<typeof setClinicTimingsBodySchema>;

// ── doctors ─────────────────────────────────────────────────────────

const doctorFields = {
  doctorName: requiredText(160, 'Name'),
  specialization: optionalText(120),
  qualification: optionalText(160),
  experience: optionalText(80),
  availableDays: z.array(z.enum(WEEKDAYS)).max(7).default([]),
  availableStartTime: timeOfDaySchema.nullish(),
  availableEndTime: timeOfDaySchema.nullish(),
  consultationFee: z.coerce.number().min(0).max(9_999_999_999.99).default(0),
  languagesSpoken: optionalText(200),
  profilePhoto: optionalHttpUrlSchema,
};

export const createDoctorBodySchema = z
  .object(doctorFields)
  .refine(
    (doctor) =>
      !doctor.availableStartTime ||
      !doctor.availableEndTime ||
      doctor.availableStartTime < doctor.availableEndTime,
    { message: 'Available end time must be after the start time.', path: ['availableEndTime'] },
  );
export type CreateDoctorBody = z.infer<typeof createDoctorBodySchema>;

export const updateDoctorBodySchema = nonEmptyPatch(
  z.object({
    doctorName: requiredText(160, 'Name').optional(),
    specialization: optionalText(120).optional(),
    qualification: optionalText(160).optional(),
    experience: optionalText(80).optional(),
    availableDays: z.array(z.enum(WEEKDAYS)).max(7).optional(),
    availableStartTime: timeOfDaySchema.nullish(),
    availableEndTime: timeOfDaySchema.nullish(),
    consultationFee: z.coerce.number().min(0).max(9_999_999_999.99).optional(),
    languagesSpoken: optionalText(200).optional(),
    profilePhoto: optionalHttpUrlSchema.optional(),
  }),
);
export type UpdateDoctorBody = z.infer<typeof updateDoctorBodySchema>;

// ── services ────────────────────────────────────────────────────────

export const upsertClinicServiceBodySchema = z.object({
  serviceName: requiredText(160, 'Service name'),
  description: optionalText(1000),
  startingPrice: z.coerce.number().min(0).max(9_999_999_999.99).default(0),
  /** Drives slot length, so it must be positive and bounded. */
  durationMinutes: z.coerce.number().int().min(5).max(480).default(30),
  isActive: z.boolean().default(true),
});
export type UpsertClinicServiceBody = z.infer<typeof upsertClinicServiceBodySchema>;

// ── FAQs ────────────────────────────────────────────────────────────

export const upsertClinicFaqBodySchema = z.object({
  question: requiredText(500, 'Question'),
  answer: requiredText(4000, 'Answer'),
  keywords: z.array(requiredText(60, 'Keyword')).max(30).default([]),
});
export type UpsertClinicFaqBody = z.infer<typeof upsertClinicFaqBodySchema>;

export const importClinicFaqsBodySchema = z.object({
  faqs: z.array(upsertClinicFaqBodySchema).min(1).max(500),
  /** Replace the existing set, or append to it. */
  mode: z.enum(['append', 'replace']).default('append'),
});
export type ImportClinicFaqsBody = z.infer<typeof importClinicFaqsBodySchema>;

// ── AI settings ─────────────────────────────────────────────────────

export const upsertAiSettingsBodySchema = z.object({
  aiEnabled: z.boolean().default(true),
  aiTone: requiredText(60, 'Tone').default('polite'),
  supportedLanguages: z.array(requiredText(40, 'Language')).max(20).default(['English']),
  greetingMessage: optionalText(1000),
  afterHoursMessage: optionalText(1000),
  escalationKeywords: z.array(requiredText(60, 'Keyword')).max(50).default([]),
  emergencyKeywords: z.array(requiredText(60, 'Keyword')).max(50).default([]),
  humanHandoverEnabled: z.boolean().default(true),
  inboundRoutingMode: z.enum(INBOUND_ROUTING_MODES).default('ai_first'),
});
export type UpsertAiSettingsBody = z.infer<typeof upsertAiSettingsBodySchema>;

// ── appointments ────────────────────────────────────────────────────

export const listAppointmentsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  doctorId: idSchema.optional(),
  contactId: idSchema.optional(),
  from: dateOnlyInputSchema.optional(),
  to: dateOnlyInputSchema.optional(),
  search: searchSchema,
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export const bookAppointmentBodySchema = z.object({
  contactId: idSchema,
  doctorId: idSchema,
  appointmentDate: dateOnlyInputSchema,
  appointmentTime: timeOfDaySchema,
  patientName: optionalText(160),
  patientAge: optionalText(20),
  reasonForVisit: optionalText(1000),
});
export type BookAppointmentBody = z.infer<typeof bookAppointmentBodySchema>;

export const rescheduleAppointmentBodySchema = z.object({
  appointmentDate: dateOnlyInputSchema,
  appointmentTime: timeOfDaySchema,
  /** Optional move to a different doctor. */
  doctorId: idSchema.optional(),
});
export type RescheduleAppointmentBody = z.infer<typeof rescheduleAppointmentBodySchema>;

export const setAppointmentStatusBodySchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
});
export type SetAppointmentStatusBody = z.infer<typeof setAppointmentStatusBodySchema>;

export const availabilityQuerySchema = z.object({
  doctorId: idSchema,
  from: dateOnlyInputSchema.optional(),
  /** How many days forward to compute. */
  days: z.coerce.number().int().min(1).max(30).default(7),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const recordIntakeBodySchema = z.object({
  contactId: idSchema,
  appointmentId: idSchema.nullish(),
  symptoms: optionalText(2000),
  allergies: optionalText(1000),
  currentMedications: optionalText(1000),
  medicalHistory: optionalText(2000),
  urgencyLevel: z.enum(URGENCY_LEVELS).nullish(),
});
export type RecordIntakeBody = z.infer<typeof recordIntakeBodySchema>;

export const recordFeedbackBodySchema = z.object({
  contactId: idSchema,
  appointmentId: idSchema.nullish(),
  rating: z.coerce.number().int().min(1).max(5),
  feedbackText: optionalText(2000),
});
export type RecordFeedbackBody = z.infer<typeof recordFeedbackBodySchema>;

export const clinicChildParamsSchema = z.object({ id: idSchema });
export type ClinicChildParams = z.infer<typeof clinicChildParamsSchema>;
