/**
 * Business vertical wire contracts (hotels, education, salons, …).
 *
 * A parallel model set to the healthcare one. Consolidating them is Phase 2;
 * this file makes the existing set typed and tenant-safe. Where the two agree
 * conceptually, the DTOs use the same field names so a future merge is a
 * rename, not a redesign.
 */

import { z } from 'zod';

import { inboundRoutingModeSchema } from './clinic.dto';
import {
  dateOnlySchema,
  isoDateSchema,
  jsonValueSchema,
  toDateOnly,
  toIso,
  toJsonObject,
  toNumberOrNull,
  toStringArray,
} from './common.dto';
import { timeOfDaySchema } from '../validators/common.validator';

export const businessProfileDtoSchema = z.object({
  id: z.string(),
  businessType: z.string(),
  businessName: z.string().nullable(),
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
  description: z.string().nullable(),
  /** Free-text context injected into the AI prompt. Not a vector store. */
  aiKnowledgeBase: z.string().nullable(),
  institutionType: z.string().nullable(),
  propertyType: z.string().nullable(),
  workingHours: z.record(jsonValueSchema),
  dateExceptions: z.record(jsonValueSchema),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type BusinessProfileDto = z.infer<typeof businessProfileDtoSchema>;

interface BusinessProfileRow {
  id: string;
  businessType: string;
  businessName: string | null;
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
  description: string | null;
  aiKnowledgeBase: string | null;
  institutionType: string | null;
  propertyType: string | null;
  workingHours: unknown;
  dateExceptions: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function toBusinessProfileDto(row: BusinessProfileRow): BusinessProfileDto {
  return {
    id: row.id,
    businessType: row.businessType,
    businessName: row.businessName ?? null,
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
    description: row.description ?? null,
    aiKnowledgeBase: row.aiKnowledgeBase ?? null,
    institutionType: row.institutionType ?? null,
    propertyType: row.propertyType ?? null,
    workingHours: toJsonObject(row.workingHours),
    dateExceptions: toJsonObject(row.dateExceptions),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

// ── service ─────────────────────────────────────────────────────────

export const businessServiceDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number().nullable(),
  durationMinutes: z.number().int().nullable(),
  category: z.string().nullable(),
  isActive: z.boolean(),
});
export type BusinessServiceDto = z.infer<typeof businessServiceDtoSchema>;

export function toBusinessServiceDto(row: {
  id: string;
  name: string;
  description: string | null;
  price: { toString(): string } | number | null;
  durationMinutes: number | null;
  category: string | null;
  isActive: boolean;
}): BusinessServiceDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    price: toNumberOrNull(row.price),
    durationMinutes: row.durationMinutes ?? null,
    category: row.category ?? null,
    isActive: row.isActive,
  };
}

// ── staff ───────────────────────────────────────────────────────────

export const businessStaffDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().nullable(),
  specialization: z.string().nullable(),
  qualification: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  extraInfo: z.record(jsonValueSchema),
});
export type BusinessStaffDto = z.infer<typeof businessStaffDtoSchema>;

export function toBusinessStaffDto(row: {
  id: string;
  name: string;
  role: string | null;
  specialization: string | null;
  qualification: string | null;
  phone: string | null;
  isActive: boolean;
  extraInfo: unknown;
}): BusinessStaffDto {
  return {
    id: row.id,
    name: row.name,
    role: row.role ?? null,
    specialization: row.specialization ?? null,
    qualification: row.qualification ?? null,
    phone: row.phone ?? null,
    isActive: row.isActive,
    extraInfo: toJsonObject(row.extraInfo),
  };
}

// ── FAQ ─────────────────────────────────────────────────────────────

export const businessFaqDtoSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  keywords: z.array(z.string()),
});
export type BusinessFaqDto = z.infer<typeof businessFaqDtoSchema>;

export function toBusinessFaqDto(row: {
  id: string;
  question: string;
  answer: string;
  keywords: string | null;
}): BusinessFaqDto {
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

export const businessAiSettingsDtoSchema = z.object({
  aiEnabled: z.boolean(),
  aiTone: z.string(),
  supportedLanguages: z.array(z.string()),
  greetingMessage: z.string().nullable(),
  afterHoursMessage: z.string().nullable(),
  escalationKeywords: z.array(z.string()),
  humanHandoverEnabled: z.boolean(),
  inboundRoutingMode: inboundRoutingModeSchema,
});
export type BusinessAiSettingsDto = z.infer<typeof businessAiSettingsDtoSchema>;

export function toBusinessAiSettingsDto(row: {
  aiEnabled: boolean;
  aiTone: string;
  supportedLanguages: unknown;
  greetingMessage: string | null;
  afterHoursMessage: string | null;
  escalationKeywords: unknown;
  humanHandoverEnabled: boolean;
  inboundRoutingMode: string;
}): BusinessAiSettingsDto {
  const mode = inboundRoutingModeSchema.safeParse(row.inboundRoutingMode);
  return {
    aiEnabled: row.aiEnabled,
    aiTone: row.aiTone,
    supportedLanguages: toStringArray(row.supportedLanguages),
    greetingMessage: row.greetingMessage ?? null,
    afterHoursMessage: row.afterHoursMessage ?? null,
    escalationKeywords: toStringArray(row.escalationKeywords),
    humanHandoverEnabled: row.humanHandoverEnabled,
    inboundRoutingMode: mode.success ? mode.data : 'ai_first',
  };
}

// ── enquiry ─────────────────────────────────────────────────────────

export const BUSINESS_ENQUIRY_STATUSES = ['pending', 'confirmed', 'cancelled'] as const;
export const businessEnquiryStatusSchema = z.enum(BUSINESS_ENQUIRY_STATUSES);

export const businessEnquiryDtoSchema = z.object({
  id: z.string(),
  enquiryType: z.string().nullable(),
  preferredDate: dateOnlySchema.nullable(),
  preferredTime: timeOfDaySchema.nullable(),
  notes: z.string().nullable(),
  status: businessEnquiryStatusSchema,
  source: z.string(),
  createdAt: isoDateSchema,
  /**
   * `contactName` / `contactPhone` are captured on the enquiry itself because
   * an AI-captured enquiry may precede a Contact record.
   */
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contact: z
    .object({ id: z.string(), phone: z.string(), name: z.string().nullable() })
    .nullable(),
});
export type BusinessEnquiryDto = z.infer<typeof businessEnquiryDtoSchema>;

export function toBusinessEnquiryDto(row: {
  id: string;
  enquiryType: string | null;
  preferredDate: Date | null;
  preferredTime: string | null;
  notes: string | null;
  status: string;
  source: string;
  createdAt: Date;
  contactName: string | null;
  contactPhone: string | null;
  contact?: { id: string; phone: string; name: string | null } | null;
}): BusinessEnquiryDto {
  const status = businessEnquiryStatusSchema.safeParse(row.status);
  const time = row.preferredTime && timeOfDaySchema.safeParse(row.preferredTime).success
    ? row.preferredTime
    : null;
  return {
    id: row.id,
    enquiryType: row.enquiryType ?? null,
    preferredDate: toDateOnly(row.preferredDate),
    preferredTime: time,
    notes: row.notes ?? null,
    status: status.success ? status.data : 'pending',
    source: row.source,
    createdAt: toIso(row.createdAt),
    contactName: row.contactName ?? null,
    contactPhone: row.contactPhone ?? null,
    contact: row.contact
      ? { id: row.contact.id, phone: row.contact.phone, name: row.contact.name ?? null }
      : null,
  };
}

// ── AI log ──────────────────────────────────────────────────────────

/**
 * `BusinessAILog` is the only model in the schema with an owner column
 * (`businessId`) and **no** Prisma relation field, so the tenant guard reaches
 * it through the `scalarParent` strategy (`businessId IN (tenant's business
 * ids)`) rather than a relation filter.
 */
export const businessAiLogDtoSchema = z.object({
  id: z.string(),
  userMessage: z.string().nullable(),
  aiResponse: z.string().nullable(),
  detectedIntent: z.string().nullable(),
  confidenceScore: z.number().nullable(),
  createdAt: isoDateSchema,
  contact: z
    .object({ id: z.string(), phone: z.string(), name: z.string().nullable() })
    .nullable(),
});
export type BusinessAiLogDto = z.infer<typeof businessAiLogDtoSchema>;

export function toBusinessAiLogDto(row: {
  id: string;
  userMessage: string | null;
  aiResponse: string | null;
  detectedIntent: string | null;
  confidenceScore: { toString(): string } | number | null;
  createdAt: Date;
  contact?: { id: string; phone: string; name: string | null } | null;
}): BusinessAiLogDto {
  return {
    id: row.id,
    userMessage: row.userMessage ?? null,
    aiResponse: row.aiResponse ?? null,
    detectedIntent: row.detectedIntent ?? null,
    confidenceScore: toNumberOrNull(row.confidenceScore),
    createdAt: toIso(row.createdAt),
    contact: row.contact
      ? { id: row.contact.id, phone: row.contact.phone, name: row.contact.name ?? null }
      : null,
  };
}

/** Whole vertical configuration, for the setup screen. */
export const businessSetupDtoSchema = z.object({
  business: businessProfileDtoSchema,
  services: z.array(businessServiceDtoSchema),
  staff: z.array(businessStaffDtoSchema),
  faqs: z.array(businessFaqDtoSchema),
  aiSettings: businessAiSettingsDtoSchema.nullable(),
});
export type BusinessSetupDto = z.infer<typeof businessSetupDtoSchema>;
