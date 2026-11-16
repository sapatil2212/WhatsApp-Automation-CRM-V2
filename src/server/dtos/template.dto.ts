/**
 * Message-template wire contracts.
 */

import { z } from 'zod';

import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_HEADER_TYPES,
  TEMPLATE_STATUSES,
  placeholderCount,
} from '../services/template-components';
import { isoDateSchema, toIso, toJsonArray } from './common.dto';

export const templateCategorySchema = z.enum(TEMPLATE_CATEGORIES);
export const templateStatusSchema = z.enum(TEMPLATE_STATUSES);
export const templateHeaderTypeSchema = z.enum(TEMPLATE_HEADER_TYPES);

export const templateButtonDtoSchema = z.object({
  type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']),
  text: z.string(),
  url: z.string().nullable(),
  phoneNumber: z.string().nullable(),
});
export type TemplateButtonDto = z.infer<typeof templateButtonDtoSchema>;

export const templateDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: templateCategorySchema,
  language: z.string(),
  headerType: templateHeaderTypeSchema,
  headerContent: z.string().nullable(),
  bodyText: z.string(),
  footerText: z.string().nullable(),
  buttons: z.array(templateButtonDtoSchema),
  status: templateStatusSchema,
  /**
   * Number of positional `{{n}}` variables in the body, derived rather
   * than stored. The broadcast wizard and the inbox template picker both
   * need it, and both used to recompute it in the browser from a regex.
   */
  variableCount: z.number().int().nonnegative(),
  /** True only when Meta will actually accept a send with this template. */
  sendable: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type TemplateDto = z.infer<typeof templateDtoSchema>;

interface TemplateRow {
  id: string;
  name: string;
  category: string;
  language: string;
  headerType: string | null;
  headerContent: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function narrowButtons(value: unknown): TemplateButtonDto[] {
  return toJsonArray(value).flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type.toUpperCase() : '';
    if (type !== 'QUICK_REPLY' && type !== 'URL' && type !== 'PHONE_NUMBER') return [];
    return [
      {
        type,
        text: typeof record.text === 'string' ? record.text : '',
        url: typeof record.url === 'string' ? record.url : null,
        // Meta's payload uses snake_case here; normalise on the way out.
        phoneNumber: typeof record.phone_number === 'string' ? record.phone_number : null,
      },
    ];
  });
}

export function toTemplateDto(row: TemplateRow): TemplateDto {
  const category = templateCategorySchema.safeParse(row.category);
  const status = templateStatusSchema.safeParse(row.status);
  const headerType = templateHeaderTypeSchema.safeParse(row.headerType ?? 'none');
  const resolvedStatus = status.success ? status.data : 'Draft';

  return {
    id: row.id,
    name: row.name,
    category: category.success ? category.data : 'Marketing',
    language: row.language,
    headerType: headerType.success ? headerType.data : 'none',
    headerContent: row.headerContent ?? null,
    bodyText: row.bodyText,
    footerText: row.footerText ?? null,
    buttons: narrowButtons(row.buttons),
    status: resolvedStatus,
    variableCount: placeholderCount(row.bodyText).max,
    // The gate the broadcast wizard never had: it listed every template
    // regardless of status, so Draft and Rejected templates were
    // selectable and every send failed at Meta with #132001.
    sendable: resolvedStatus === 'Approved',
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export const templateSyncResultDtoSchema = z.object({
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** True when Meta had more pages than the sync was willing to walk. */
  truncated: z.boolean(),
});
export type TemplateSyncResultDto = z.infer<typeof templateSyncResultDtoSchema>;

export const templateSubmitResultDtoSchema = z.object({
  template: templateDtoSchema,
  metaStatus: z.string(),
});
export type TemplateSubmitResultDto = z.infer<typeof templateSubmitResultDtoSchema>;
