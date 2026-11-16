/**
 * Contact-domain request schemas.
 *
 * Contrast with the previous implementation, where the only check on
 * contact creation was `!phone.trim()` — no format validation, no length
 * caps, no duplicate handling, and the E.164 helpers that already existed
 * were never called.
 */

import { z } from 'zod';

import { paginationQuerySchema, sortDirectionSchema } from '../kernel';
import { CUSTOM_FIELD_TYPES } from '../dtos/contact.dto';
import {
  hexColorSchema,
  idListQuerySchema,
  idSchema,
  nonEmptyPatch,
  optionalEmailSchema,
  optionalHttpUrlSchema,
  optionalText,
  phoneSchema,
  requiredText,
  searchSchema,
} from './common.validator';

// ── list ────────────────────────────────────────────────────────────

export const CONTACT_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'phone'] as const;

export const listContactsQuerySchema = paginationQuerySchema.extend({
  search: searchSchema,
  tagIds: idListQuerySchema,
  sortBy: z.enum(CONTACT_SORT_FIELDS).default('createdAt'),
  sortDirection: sortDirectionSchema,
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

// ── create / update ─────────────────────────────────────────────────

const contactFields = {
  phone: phoneSchema,
  name: optionalText(120),
  email: optionalEmailSchema,
  company: optionalText(160),
  avatarUrl: optionalHttpUrlSchema,
  /** Replaces the contact's tag set wholesale when present. */
  tagIds: z.array(idSchema).max(50).optional(),
};

export const createContactBodySchema = z.object(contactFields);
export type CreateContactBody = z.infer<typeof createContactBodySchema>;

export const updateContactBodySchema = nonEmptyPatch(
  z.object({
    phone: phoneSchema.optional(),
    name: optionalText(120).optional(),
    email: optionalEmailSchema.optional(),
    company: optionalText(160).optional(),
    avatarUrl: optionalHttpUrlSchema.optional(),
    tagIds: z.array(idSchema).max(50).optional(),
  }),
);
export type UpdateContactBody = z.infer<typeof updateContactBodySchema>;

// ── import ──────────────────────────────────────────────────────────

export const IMPORT_MAX_ROWS = 5000;

export const importContactsBodySchema = z.object({
  rows: z
    .array(
      z.object({
        phone: z.string().trim().min(1),
        name: z.string().trim().max(120).optional(),
        email: z.string().trim().max(255).optional(),
        company: z.string().trim().max(160).optional(),
      }),
    )
    .min(1, 'Provide at least one row to import.')
    .max(IMPORT_MAX_ROWS, `Imports are limited to ${IMPORT_MAX_ROWS} rows per request.`),
  /**
   * How to treat a phone number that already exists in this tenant. The
   * old importer had no concept of this and silently doubled the contact
   * list on a re-import.
   */
  onDuplicate: z.enum(['skip', 'update']).default('skip'),
  /** Applied to every imported contact. */
  tagIds: z.array(idSchema).max(50).default([]),
});
export type ImportContactsBody = z.infer<typeof importContactsBodySchema>;

// ── custom field values ─────────────────────────────────────────────

export const setContactCustomValuesBodySchema = z.object({
  values: z
    .array(
      z.object({
        customFieldId: idSchema,
        value: z.string().trim().max(2000).nullable(),
      }),
    )
    .max(100),
});
export type SetContactCustomValuesBody = z.infer<typeof setContactCustomValuesBodySchema>;

// ── notes ───────────────────────────────────────────────────────────

export const createContactNoteBodySchema = z.object({
  noteText: requiredText(5000, 'Note'),
});
export type CreateContactNoteBody = z.infer<typeof createContactNoteBodySchema>;

export const contactNoteParamsSchema = z.object({
  id: idSchema,
  noteId: idSchema,
});
export type ContactNoteParams = z.infer<typeof contactNoteParamsSchema>;

// ── tags ────────────────────────────────────────────────────────────

export const createTagBodySchema = z.object({
  name: requiredText(60, 'Tag name'),
  color: hexColorSchema.default('#3b82f6'),
});
export type CreateTagBody = z.infer<typeof createTagBodySchema>;

export const updateTagBodySchema = nonEmptyPatch(
  z.object({
    name: requiredText(60, 'Tag name').optional(),
    color: hexColorSchema.optional(),
  }),
);
export type UpdateTagBody = z.infer<typeof updateTagBodySchema>;

// ── custom field definitions ────────────────────────────────────────

export const createCustomFieldBodySchema = z
  .object({
    fieldName: requiredText(60, 'Field name'),
    fieldType: z.enum(CUSTOM_FIELD_TYPES).default('text'),
    fieldOptions: z.array(requiredText(80, 'Option')).max(50).default([]),
  })
  .refine((value) => value.fieldType !== 'select' || value.fieldOptions.length > 0, {
    message: 'A select field needs at least one option.',
    path: ['fieldOptions'],
  });
export type CreateCustomFieldBody = z.infer<typeof createCustomFieldBodySchema>;

export const updateCustomFieldBodySchema = nonEmptyPatch(
  z.object({
    fieldName: requiredText(60, 'Field name').optional(),
    fieldOptions: z.array(requiredText(80, 'Option')).max(50).optional(),
  }),
);
export type UpdateCustomFieldBody = z.infer<typeof updateCustomFieldBodySchema>;
