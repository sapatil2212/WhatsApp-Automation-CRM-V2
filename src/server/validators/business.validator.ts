/**
 * Business vertical request schemas.
 */

import { z } from 'zod';

import { paginationQuerySchema } from '../kernel';
import { BUSINESS_ENQUIRY_STATUSES } from '../dtos/business.dto';
import { INBOUND_ROUTING_MODES } from '../dtos/clinic.dto';
import {
  dateOnlyInputSchema,
  idSchema,
  optionalEmailSchema,
  optionalHttpUrlSchema,
  optionalPhoneSchema,
  optionalText,
  requiredText,
  timeOfDaySchema,
} from './common.validator';

/**
 * Supported segments, matching `SEGMENTS` in `src/lib/business/terminology.ts`.
 *
 * `healthcare` is deliberately absent: it has its own model set (`Clinic`) and
 * its own service. The old code let it fall through `getTerminology()` to the
 * generic `business` bucket while every healthcare string was hardcoded
 * elsewhere — an inconsistency worth not reproducing.
 */
export const BUSINESS_SEGMENTS = [
  'hotel',
  'education',
  'salon',
  'fitness',
  'restaurant',
  'realestate',
  'automotive',
  'retail',
  'business',
] as const;
export const businessSegmentSchema = z.enum(BUSINESS_SEGMENTS);
export type BusinessSegment = z.infer<typeof businessSegmentSchema>;

export const upsertBusinessBodySchema = z.object({
  businessType: requiredText(80, 'Business type'),
  businessName: optionalText(160),
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
  description: optionalText(2000),
  /** Capped for the same reason as the clinic's: it goes into the AI prompt. */
  aiKnowledgeBase: optionalText(8000),
  institutionType: optionalText(80),
  propertyType: optionalText(80),
});
export type UpsertBusinessBody = z.infer<typeof upsertBusinessBodySchema>;

export const upsertBusinessServiceBodySchema = z.object({
  name: requiredText(160, 'Service name'),
  description: optionalText(1000),
  price: z.coerce.number().min(0).max(9_999_999_999.99).nullish(),
  durationMinutes: z.coerce.number().int().min(5).max(1440).nullish(),
  category: optionalText(80),
  isActive: z.boolean().default(true),
});
export type UpsertBusinessServiceBody = z.infer<typeof upsertBusinessServiceBodySchema>;

export const upsertBusinessStaffBodySchema = z.object({
  name: requiredText(160, 'Name'),
  role: optionalText(80),
  specialization: optionalText(120),
  qualification: optionalText(160),
  phone: optionalPhoneSchema,
  isActive: z.boolean().default(true),
});
export type UpsertBusinessStaffBody = z.infer<typeof upsertBusinessStaffBodySchema>;

export const upsertBusinessFaqBodySchema = z.object({
  question: requiredText(500, 'Question'),
  answer: requiredText(4000, 'Answer'),
  keywords: z.array(requiredText(60, 'Keyword')).max(30).default([]),
});
export type UpsertBusinessFaqBody = z.infer<typeof upsertBusinessFaqBodySchema>;

export const importBusinessFaqsBodySchema = z.object({
  faqs: z.array(upsertBusinessFaqBodySchema).min(1).max(500),
  mode: z.enum(['append', 'replace']).default('append'),
});
export type ImportBusinessFaqsBody = z.infer<typeof importBusinessFaqsBodySchema>;

export const upsertBusinessAiSettingsBodySchema = z.object({
  aiEnabled: z.boolean().default(true),
  aiTone: requiredText(60, 'Tone').default('polite and professional'),
  supportedLanguages: z.array(requiredText(40, 'Language')).max(20).default(['English']),
  greetingMessage: optionalText(1000),
  afterHoursMessage: optionalText(1000),
  escalationKeywords: z.array(requiredText(60, 'Keyword')).max(50).default([]),
  humanHandoverEnabled: z.boolean().default(true),
  inboundRoutingMode: z.enum(INBOUND_ROUTING_MODES).default('ai_first'),
});
export type UpsertBusinessAiSettingsBody = z.infer<typeof upsertBusinessAiSettingsBodySchema>;

export const listEnquiriesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(BUSINESS_ENQUIRY_STATUSES).optional(),
});
export type ListEnquiriesQuery = z.infer<typeof listEnquiriesQuerySchema>;

export const createEnquiryBodySchema = z
  .object({
    contactId: idSchema.nullish(),
    /** Captured directly when the enquiry precedes a Contact record. */
    contactName: optionalText(160),
    contactPhone: optionalPhoneSchema,
    enquiryType: optionalText(80),
    preferredDate: dateOnlyInputSchema.optional(),
    preferredTime: timeOfDaySchema.optional(),
    notes: optionalText(2000),
  })
  .refine((body) => Boolean(body.contactId ?? body.contactPhone), {
    message: 'Provide either a contact or a phone number.',
    path: ['contactPhone'],
  });
export type CreateEnquiryBody = z.infer<typeof createEnquiryBodySchema>;

export const setEnquiryStatusBodySchema = z.object({
  status: z.enum(BUSINESS_ENQUIRY_STATUSES),
});
export type SetEnquiryStatusBody = z.infer<typeof setEnquiryStatusBodySchema>;

export const businessChildParamsSchema = z.object({ id: idSchema });
export type BusinessChildParams = z.infer<typeof businessChildParamsSchema>;
