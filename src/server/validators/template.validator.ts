/**
 * Message-template request schemas.
 *
 * Field-level shape only — the cross-field rules Meta enforces (a media
 * header needs a sample URL, `{{n}}` must be gap-free, at most one call
 * button) live in `template-components.ts` because they are the same rules
 * whether a template arrives from the builder UI, a seed, or a future
 * import.
 */

import { z } from 'zod';

import { paginationQuerySchema } from '../kernel';
import { TEMPLATE_CATEGORIES, TEMPLATE_HEADER_TYPES } from '../services/template-components';
import { booleanQuerySchema, idSchema, requiredText, searchSchema } from './common.validator';

export const listTemplatesQuerySchema = paginationQuerySchema.extend({
  search: searchSchema,
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  status: z.enum(['Draft', 'Pending', 'Approved', 'Rejected']).optional(),
  /** Pickers that can only offer templates Meta will accept. */
  sendableOnly: booleanQuerySchema,
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

const buttonSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('QUICK_REPLY'),
    text: requiredText(25, 'Button text'),
  }),
  z.object({
    type: z.literal('URL'),
    text: requiredText(25, 'Button text'),
    url: requiredText(2000, 'Button URL'),
    /** Sample suffix, required when the URL ends in `{{1}}`. */
    example: z.string().trim().max(2000).optional(),
  }),
  z.object({
    type: z.literal('PHONE_NUMBER'),
    text: requiredText(25, 'Button text'),
    phoneNumber: requiredText(20, 'Phone number'),
  }),
]);

export const submitTemplateBodySchema = z.object({
  /** Normalised to `lower_snake_case` by the service before submission. */
  name: requiredText(512, 'Template name'),
  category: z.enum(TEMPLATE_CATEGORIES).default('Marketing'),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'Use a Meta language code such as en or en_US.')
    .default('en_US'),
  headerType: z.enum(TEMPLATE_HEADER_TYPES).default('none'),
  headerText: z.string().trim().max(60).optional(),
  headerExample: z.string().trim().max(2000).optional(),
  headerTextExample: z.array(z.string().trim().max(200)).max(1).optional(),
  bodyText: requiredText(1024, 'Body text'),
  bodyExample: z.array(z.string().trim().max(200)).max(20).optional(),
  footerText: z.string().trim().max(60).optional(),
  buttons: z.array(buttonSchema).max(10).optional(),
});
export type SubmitTemplateBody = z.infer<typeof submitTemplateBodySchema>;

export const templateParamsSchema = z.object({ id: idSchema });
export type TemplateParams = z.infer<typeof templateParamsSchema>;

/** Resolve a template by the name+language pair a send actually uses. */
export const templateLookupQuerySchema = z.object({
  name: requiredText(512, 'Template name'),
  language: z.string().trim().max(20).default('en_US'),
});
export type TemplateLookupQuery = z.infer<typeof templateLookupQuerySchema>;
