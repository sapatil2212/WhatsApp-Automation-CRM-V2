/**
 * Contact-domain wire contracts.
 *
 * Note what is *not* here: `tenantId` and `userId`. They are internal
 * ownership columns; exposing them let the old client send them back as
 * filters, which is how the compat endpoint became escalatable. The
 * client never needs them — the session already determines the tenant.
 */

import { z } from 'zod';

import { hexColorSchema } from '../validators/common.validator';
import { isoDateSchema, toIso, toIsoOrNull, toJson, toJsonArray, type JsonValue } from './common.dto';

// ── Tag ─────────────────────────────────────────────────────────────

export const tagDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: hexColorSchema,
  createdAt: isoDateSchema,
  /** Populated only by the tag-list endpoint. */
  contactCount: z.number().int().nonnegative().nullable(),
});
export type TagDto = z.infer<typeof tagDtoSchema>;

interface TagRow {
  id: string;
  name: string;
  color: string;
  createdAt: Date;
  _count?: { contacts: number };
}

export function toTagDto(row: TagRow): TagDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: toIso(row.createdAt),
    contactCount: row._count?.contacts ?? null,
  };
}

// ── Custom field definition ─────────────────────────────────────────

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const;
export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const customFieldDtoSchema = z.object({
  id: z.string(),
  fieldName: z.string(),
  fieldType: customFieldTypeSchema,
  /** Choices for `select`; empty for every other type. */
  fieldOptions: z.array(z.string()),
  createdAt: isoDateSchema,
});
export type CustomFieldDto = z.infer<typeof customFieldDtoSchema>;

interface CustomFieldRow {
  id: string;
  fieldName: string;
  fieldType: string;
  fieldOptions: unknown;
  createdAt: Date;
}

export function toCustomFieldDto(row: CustomFieldRow): CustomFieldDto {
  const parsedType = customFieldTypeSchema.safeParse(row.fieldType);
  return {
    id: row.id,
    fieldName: row.fieldName,
    // Legacy rows may hold a type we no longer offer; degrade to `text`
    // rather than failing the whole response.
    fieldType: parsedType.success ? parsedType.data : 'text',
    fieldOptions: toJsonArray(row.fieldOptions).filter((item): item is string => typeof item === 'string'),
    createdAt: toIso(row.createdAt),
  };
}

// ── Custom field value ──────────────────────────────────────────────

export const contactCustomValueDtoSchema = z.object({
  customFieldId: z.string(),
  fieldName: z.string(),
  fieldType: customFieldTypeSchema,
  value: z.string().nullable(),
});
export type ContactCustomValueDto = z.infer<typeof contactCustomValueDtoSchema>;

interface ContactCustomValueRow {
  customFieldId: string;
  value: string | null;
  customField?: { fieldName: string; fieldType: string };
}

export function toContactCustomValueDto(row: ContactCustomValueRow): ContactCustomValueDto {
  const parsedType = customFieldTypeSchema.safeParse(row.customField?.fieldType);
  return {
    customFieldId: row.customFieldId,
    fieldName: row.customField?.fieldName ?? '',
    fieldType: parsedType.success ? parsedType.data : 'text',
    value: row.value ?? null,
  };
}

// ── Note ────────────────────────────────────────────────────────────

export const contactNoteDtoSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  noteText: z.string(),
  createdAt: isoDateSchema,
  author: z
    .object({
      userId: z.string(),
      fullName: z.string().nullable(),
    })
    .nullable(),
});
export type ContactNoteDto = z.infer<typeof contactNoteDtoSchema>;

interface ContactNoteRow {
  id: string;
  contactId: string;
  userId: string;
  noteText: string;
  createdAt: Date;
  author?: { fullName: string | null } | null;
}

export function toContactNoteDto(row: ContactNoteRow): ContactNoteDto {
  return {
    id: row.id,
    contactId: row.contactId,
    noteText: row.noteText,
    createdAt: toIso(row.createdAt),
    author: { userId: row.userId, fullName: row.author?.fullName ?? null },
  };
}

// ── Contact ─────────────────────────────────────────────────────────

export const contactDtoSchema = z.object({
  id: z.string(),
  phone: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  company: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  tags: z.array(tagDtoSchema),
});
export type ContactDto = z.infer<typeof contactDtoSchema>;

/** Contact plus the detail-view relations. */
export const contactDetailDtoSchema = contactDtoSchema.extend({
  customValues: z.array(contactCustomValueDtoSchema),
  notes: z.array(contactNoteDtoSchema),
  conversationId: z.string().nullable(),
  openDealCount: z.number().int().nonnegative(),
});
export type ContactDetailDto = z.infer<typeof contactDetailDtoSchema>;

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags?: Array<{ tag: TagRow }>;
}

export function toContactDto(row: ContactRow): ContactDto {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name ?? null,
    email: row.email ?? null,
    company: row.company ?? null,
    avatarUrl: row.avatarUrl ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    tags: (row.tags ?? []).map((link) => toTagDto(link.tag)),
  };
}

interface ContactDetailRow extends ContactRow {
  customValues?: ContactCustomValueRow[];
  notes?: ContactNoteRow[];
  conversations?: Array<{ id: string }>;
  deals?: Array<{ id: string }>;
}

export function toContactDetailDto(row: ContactDetailRow): ContactDetailDto {
  return {
    ...toContactDto(row),
    customValues: (row.customValues ?? []).map(toContactCustomValueDto),
    notes: (row.notes ?? []).map(toContactNoteDto),
    conversationId: row.conversations?.[0]?.id ?? null,
    openDealCount: row.deals?.length ?? 0,
  };
}

// ── Import summary ──────────────────────────────────────────────────

export const contactImportResultDtoSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errors: z.array(z.object({ row: z.number().int(), phone: z.string().nullable(), reason: z.string() })),
});
export type ContactImportResultDto = z.infer<typeof contactImportResultDtoSchema>;

/** Re-exported so services can build `unknown`-typed JSON safely. */
export { toJson, type JsonValue, toIsoOrNull };
