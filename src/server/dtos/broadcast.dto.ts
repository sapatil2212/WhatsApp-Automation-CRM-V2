/**
 * Broadcast wire contracts.
 */

import { z } from 'zod';

import { BROADCAST_STATUSES, RECIPIENT_STATUSES } from '../services/broadcast-status';
import { isoDateSchema, toIso, toIsoOrNull, toJsonObject } from './common.dto';

export const broadcastStatusSchema = z.enum(BROADCAST_STATUSES);
export const recipientStatusSchema = z.enum(RECIPIENT_STATUSES);

/**
 * Audience definition. A discriminated union rather than the old opaque
 * `Record<string, unknown>` JSON blob, so an invalid audience is rejected
 * at the boundary instead of producing an empty recipient list at send
 * time.
 */
export const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({
    type: z.literal('tags'),
    tagIds: z.array(z.string().uuid()).min(1, 'Select at least one tag.'),
    /** Contacts carrying any of these tags are removed from the audience. */
    excludeTagIds: z.array(z.string().uuid()).default([]),
  }),
  z.object({
    type: z.literal('customField'),
    customFieldId: z.string().uuid(),
    operator: z.enum(['is', 'isNot', 'contains']),
    value: z.string().trim().min(1).max(500),
    excludeTagIds: z.array(z.string().uuid()).default([]),
  }),
]);
export type Audience = z.infer<typeof audienceSchema>;

export const broadcastStatsDtoSchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  replied: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Percentages of `total`, rounded to one decimal, 0 when total is 0. */
  deliveryRate: z.number(),
  readRate: z.number(),
  failureRate: z.number(),
});
export type BroadcastStatsDto = z.infer<typeof broadcastStatsDtoSchema>;

export const broadcastDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  templateName: z.string(),
  templateLanguage: z.string(),
  /** Positional `{{n}}` values, index 0 → `{{1}}`. */
  templateVariables: z.array(z.string()),
  audience: audienceSchema.nullable(),
  scheduledAt: isoDateSchema.nullable(),
  status: broadcastStatusSchema,
  stats: broadcastStatsDtoSchema,
  /** Whether the campaign may still be edited or deleted. */
  editable: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type BroadcastDto = z.infer<typeof broadcastDtoSchema>;

interface BroadcastRow {
  id: string;
  name: string;
  templateName: string;
  templateLanguage: string;
  templateVariables: unknown;
  audienceFilter: unknown;
  scheduledAt: Date | null;
  status: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  repliedCount: number;
  failedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function rate(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function toStats(row: BroadcastRow): BroadcastStatsDto {
  const total = row.totalRecipients;
  const attempted = row.sentCount + row.deliveredCount + row.readCount + row.repliedCount;
  const pending = Math.max(0, total - attempted - row.failedCount);

  return {
    total,
    pending,
    sent: row.sentCount,
    delivered: row.deliveredCount,
    read: row.readCount,
    replied: row.repliedCount,
    failed: row.failedCount,
    deliveryRate: rate(row.deliveredCount + row.readCount + row.repliedCount, total),
    readRate: rate(row.readCount + row.repliedCount, total),
    failureRate: rate(row.failedCount, total),
  };
}

/**
 * The stored audience is a free-form JSON column, so historical rows may
 * hold a shape the current union rejects. Returning `null` degrades the
 * campaign to "audience unknown" rather than failing the whole list.
 */
function parseAudience(value: unknown): Audience | null {
  const parsed = audienceSchema.safeParse(toJsonObject(value));
  return parsed.success ? parsed.data : null;
}

function parseVariables(value: unknown): string[] {
  const json = toJsonObject(value);
  // Stored as `{ "1": "Asha", "2": "A-1" }` by the wizard; normalise to a
  // positional array so callers stop doing index arithmetic on an object.
  const keys = Object.keys(json)
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key) && key >= 1)
    .sort((a, b) => a - b);
  if (keys.length === 0) return [];
  return keys.map((key) => {
    const entry = json[String(key)];
    return typeof entry === 'string' ? entry : '';
  });
}

export function toBroadcastDto(row: BroadcastRow): BroadcastDto {
  const status = broadcastStatusSchema.safeParse(row.status);
  const resolvedStatus = status.success ? status.data : 'draft';
  return {
    id: row.id,
    name: row.name,
    templateName: row.templateName,
    templateLanguage: row.templateLanguage,
    templateVariables: parseVariables(row.templateVariables),
    audience: parseAudience(row.audienceFilter),
    scheduledAt: toIsoOrNull(row.scheduledAt),
    status: resolvedStatus,
    stats: toStats(row),
    editable: resolvedStatus === 'draft' || resolvedStatus === 'scheduled',
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

// ── recipient ───────────────────────────────────────────────────────

export const broadcastRecipientDtoSchema = z.object({
  id: z.string(),
  status: recipientStatusSchema,
  sentAt: isoDateSchema.nullable(),
  deliveredAt: isoDateSchema.nullable(),
  readAt: isoDateSchema.nullable(),
  repliedAt: isoDateSchema.nullable(),
  errorMessage: z.string().nullable(),
  /**
   * Always populated. The old detail page rendered "Unknown" and exported
   * empty CSV columns for every row because the contact relation was
   * dropped by the data layer.
   */
  contact: z
    .object({
      id: z.string(),
      phone: z.string(),
      name: z.string().nullable(),
    })
    .nullable(),
});
export type BroadcastRecipientDto = z.infer<typeof broadcastRecipientDtoSchema>;

interface BroadcastRecipientRow {
  id: string;
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  repliedAt: Date | null;
  errorMessage: string | null;
  contact?: { id: string; phone: string; name: string | null } | null;
}

export function toBroadcastRecipientDto(row: BroadcastRecipientRow): BroadcastRecipientDto {
  const status = recipientStatusSchema.safeParse(row.status);
  return {
    id: row.id,
    status: status.success ? status.data : 'pending',
    sentAt: toIsoOrNull(row.sentAt),
    deliveredAt: toIsoOrNull(row.deliveredAt),
    readAt: toIsoOrNull(row.readAt),
    repliedAt: toIsoOrNull(row.repliedAt),
    errorMessage: row.errorMessage ?? null,
    contact: row.contact
      ? { id: row.contact.id, phone: row.contact.phone, name: row.contact.name ?? null }
      : null,
  };
}

// ── audience preview ────────────────────────────────────────────────

export const audiencePreviewDtoSchema = z.object({
  /** Contacts that would receive this campaign. */
  reach: z.number().int().nonnegative(),
  /** Excluded because they carry an excluded tag. */
  excluded: z.number().int().nonnegative(),
  sample: z.array(
    z.object({ id: z.string(), phone: z.string(), name: z.string().nullable() }),
  ),
});
export type AudiencePreviewDto = z.infer<typeof audiencePreviewDtoSchema>;

// ── send progress ───────────────────────────────────────────────────

export const broadcastSendResultDtoSchema = z.object({
  broadcastId: z.string(),
  status: broadcastStatusSchema,
  attempted: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** True when the batch limit was hit and another pass is required. */
  hasMore: z.boolean(),
});
export type BroadcastSendResultDto = z.infer<typeof broadcastSendResultDtoSchema>;
