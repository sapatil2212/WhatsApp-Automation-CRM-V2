/**
 * Healthcare (clinic) wire contracts.
 *
 * `Clinic` and its children are the healthcare vertical's own model set,
 * parallel to `BusinessProfile` for every other segment. Consolidating the two
 * is a Phase 2 concern; this file makes the existing one typed and safe.
 */

import { z } from 'zod';

import { hexColorSchema, timeOfDaySchema } from '../validators/common.validator';
import {
  isoDateSchema,
  jsonValueSchema,
  toIso,
  toJsonArray,
  toJsonObject,
  toNumberOrNull,
  toStringArray,
} from './common.dto';

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export const weekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof weekdaySchema>;

// ── clinic timing ───────────────────────────────────────────────────

export const clinicTimingDtoSchema = z.object({
  id: z.string(),
  dayName: weekdaySchema,
  isClosed: z.boolean(),
  openingTime: timeOfDaySchema.nullable(),
  closingTime: timeOfDaySchema.nullable(),
  lunchBreakStart: timeOfDaySchema.nullable(),
  lunchBreakEnd: timeOfDaySchema.nullable(),
});
export type ClinicTimingDto = z.infer<typeof clinicTimingDtoSchema>;

interface ClinicTimingRow {
  id: string;
  dayName: string;
  isClosed: boolean;
  openingTime: string | null;
  closingTime: string | null;
  lunchBreakStart: string | null;
  lunchBreakEnd: string | null;
}

/** Legacy rows may hold a malformed time; null is safer than a bad render. */
function narrowTime(value: string | null): string | null {
  return value && timeOfDaySchema.safeParse(value).success ? value : null;
}

export function toClinicTimingDto(row: ClinicTimingRow): ClinicTimingDto {
  const day = weekdaySchema.safeParse(row.dayName);
  return {
    id: row.id,
    dayName: day.success ? day.data : 'Monday',
    isClosed: row.isClosed,
    openingTime: narrowTime(row.openingTime),
    closingTime: narrowTime(row.closingTime),
    lunchBreakStart: narrowTime(row.lunchBreakStart),
    lunchBreakEnd: narrowTime(row.lunchBreakEnd),
  };
}

// ── doctor ──────────────────────────────────────────────────────────

export const doctorDtoSchema = z.object({
  id: z.string(),
  doctorName: z.string(),
  specialization: z.string().nullable(),
  qualification: z.string().nullable(),
  experience: z.string().nullable(),
  availableDays: z.array(weekdaySchema),
  availableStartTime: timeOfDaySchema.nullable(),
  availableEndTime: timeOfDaySchema.nullable(),
  consultationFee: z.number().nullable(),
  languagesSpoken: z.string().nullable(),
  profilePhoto: z.string().nullable(),
  /** Per-weekday overrides; opaque JSON, shape owned by the setup UI. */
  weeklySlots: z.record(jsonValueSchema),
  /** Leave / holiday overrides keyed by YYYY-MM-DD. */
  dateExceptions: z.record(jsonValueSchema),
});
export type DoctorDto = z.infer<typeof doctorDtoSchema>;

interface DoctorRow {
  id: string;
  doctorName: string;
  specialization: string | null;
  qualification: string | null;
  experience: string | null;
  availableDays: unknown;
  availableStartTime: string | null;
  availableEndTime: string | null;
  consultationFee: { toString(): string } | number | null;
  languagesSpoken: string | null;
  profilePhoto: string | null;
  weeklySlots: unknown;
  dateExceptions: unknown;
}

export function toDoctorDto(row: DoctorRow): DoctorDto {
  return {
    id: row.id,
    doctorName: row.doctorName,
    specialization: row.specialization ?? null,
    qualification: row.qualification ?? null,
    experience: row.experience ?? null,
    availableDays: toStringArray(row.availableDays).filter(
      (day): day is Weekday => weekdaySchema.safeParse(day).success,
    ),
    availableStartTime: narrowTime(row.availableStartTime),
    availableEndTime: narrowTime(row.availableEndTime),
    consultationFee: toNumberOrNull(row.consultationFee),
    languagesSpoken: row.languagesSpoken ?? null,
    profilePhoto: row.profilePhoto ?? null,
    weeklySlots: toJsonObject(row.weeklySlots),
    dateExceptions: toJsonObject(row.dateExceptions),
  };
}

// ── service ─────────────────────────────────────────────────────────

export const clinicServiceDtoSchema = z.object({
  id: z.string(),
  serviceName: z.string(),
  description: z.string().nullable(),
  startingPrice: z.number().nullable(),
  durationMinutes: z.number().int().positive(),
  isActive: z.boolean(),
});
export type ClinicServiceDto = z.infer<typeof clinicServiceDtoSchema>;

export function toClinicServiceDto(row: {
  id: string;
  serviceName: string;
  description: string | null;
  startingPrice: { toString(): string } | number | null;
  duration: number;
  isActive: boolean;
}): ClinicServiceDto {
  return {
    id: row.id,
    serviceName: row.serviceName,
    description: row.description ?? null,
    startingPrice: toNumberOrNull(row.startingPrice),
    // Renamed on the wire: `duration` alone does not say what unit it is in.
    durationMinutes: row.duration,
    isActive: row.isActive,
  };
}

// ── FAQ ─────────────────────────────────────────────────────────────

export const clinicFaqDtoSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  /** Comma-separated in the column; an array on the wire. */
  keywords: z.array(z.string()),
});
export type ClinicFaqDto = z.infer<typeof clinicFaqDtoSchema>;

export function toClinicFaqDto(row: {
  id: string;
  question: string;
  answer: string;
  keywords: string | null;
}): ClinicFaqDto {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    keywords: (row.keywords ?? '')
      .split(',')
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0),
  };
}

// ── AI settings ─────────────────────────────────────────────────────

export const INBOUND_ROUTING_MODES = ['ai_first', 'flows_first', 'flows_only', 'ai_only'] as const;
export const inboundRoutingModeSchema = z.enum(INBOUND_ROUTING_MODES);

export const aiSettingsDtoSchema = z.object({
  aiEnabled: z.boolean(),
  aiTone: z.string(),
  supportedLanguages: z.array(z.string()),
  greetingMessage: z.string().nullable(),
  afterHoursMessage: z.string().nullable(),
  escalationKeywords: z.array(z.string()),
  emergencyKeywords: z.array(z.string()),
  humanHandoverEnabled: z.boolean(),
  inboundRoutingMode: inboundRoutingModeSchema,
});
export type AiSettingsDto = z.infer<typeof aiSettingsDtoSchema>;

interface AiSettingsRow {
  aiEnabled: boolean;
  aiTone: string;
  supportedLanguages: unknown;
  greetingMessage: string | null;
  afterHoursMessage: string | null;
  escalationKeywords: unknown;
  emergencyKeywords: unknown;
  humanHandoverEnabled: boolean;
  inboundRoutingMode: string;
}

export function toAiSettingsDto(row: AiSettingsRow): AiSettingsDto {
  const mode = inboundRoutingModeSchema.safeParse(row.inboundRoutingMode);
  return {
    aiEnabled: row.aiEnabled,
    aiTone: row.aiTone,
    supportedLanguages: toStringArray(row.supportedLanguages),
    greetingMessage: row.greetingMessage ?? null,
    afterHoursMessage: row.afterHoursMessage ?? null,
    escalationKeywords: toStringArray(row.escalationKeywords),
    emergencyKeywords: toStringArray(row.emergencyKeywords),
    humanHandoverEnabled: row.humanHandoverEnabled,
    inboundRoutingMode: mode.success ? mode.data : 'ai_first',
  };
}

// ── clinic ──────────────────────────────────────────────────────────

export const clinicDtoSchema = z.object({
  id: z.string(),
  clinicName: z.string(),
  clinicType: z.string().nullable(),
  clinicDescription: z.string().nullable(),
  phone: z.string().nullable(),
  whatsappNumber: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  pincode: z.string().nullable(),
  googleMapLink: z.string().nullable(),
  instagramUrl: z.string().nullable(),
  facebookUrl: z.string().nullable(),
  /** Free-text context injected into the AI prompt. Not a vector store. */
  aiKnowledgeBase: z.string().nullable(),
  /** Holiday / closure overrides keyed by YYYY-MM-DD. */
  dateExceptions: z.record(jsonValueSchema),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type ClinicDto = z.infer<typeof clinicDtoSchema>;

interface ClinicRow {
  id: string;
  clinicName: string;
  clinicType: string | null;
  clinicDescription: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  googleMapLink: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  aiKnowledgeBase: string | null;
  dateExceptions: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function toClinicDto(row: ClinicRow): ClinicDto {
  return {
    id: row.id,
    clinicName: row.clinicName,
    clinicType: row.clinicType ?? null,
    clinicDescription: row.clinicDescription ?? null,
    phone: row.phone ?? null,
    whatsappNumber: row.whatsappNumber ?? null,
    email: row.email ?? null,
    website: row.website ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    pincode: row.pincode ?? null,
    googleMapLink: row.googleMapLink ?? null,
    instagramUrl: row.instagramUrl ?? null,
    facebookUrl: row.facebookUrl ?? null,
    aiKnowledgeBase: row.aiKnowledgeBase ?? null,
    dateExceptions: toJsonObject(row.dateExceptions),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** The whole vertical configuration, for the setup screen. */
export const clinicSetupDtoSchema = z.object({
  clinic: clinicDtoSchema,
  timings: z.array(clinicTimingDtoSchema),
  doctors: z.array(doctorDtoSchema),
  services: z.array(clinicServiceDtoSchema),
  faqs: z.array(clinicFaqDtoSchema),
  aiSettings: aiSettingsDtoSchema.nullable(),
});
export type ClinicSetupDto = z.infer<typeof clinicSetupDtoSchema>;

/** Re-exported so the validator can share the colour rule. */
export { hexColorSchema, toJsonArray };
