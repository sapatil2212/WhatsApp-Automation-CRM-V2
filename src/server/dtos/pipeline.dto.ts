/**
 * Pipeline and deal wire contracts.
 *
 * Deal status had three vocabularies in the old codebase: the schema
 * defaulted to `'active'`, the analytics component tested for
 * `'won'`/`'lost'`, and the contact detail view tested `status !== 'open'`.
 * Canonical set is `active | won | lost`; a legacy `'open'` row is read as
 * `active` so nothing has to be migrated.
 */

import { z } from 'zod';

import { dateOnlySchema, isoDateSchema, toDateOnly, toIso, toNumber } from './common.dto';
import { hexColorSchema } from '../validators/common.validator';

export const DEAL_STATUSES = ['active', 'won', 'lost'] as const;
export const dealStatusSchema = z.enum(DEAL_STATUSES);
export type DealStatus = z.infer<typeof dealStatusSchema>;

function narrowDealStatus(value: string): DealStatus {
  // `'open'` predates the current vocabulary and means the same as active.
  if (value === 'open') return 'active';
  const parsed = dealStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : 'active';
}

// ── stage ───────────────────────────────────────────────────────────

export const pipelineStageDtoSchema = z.object({
  id: z.string(),
  pipelineId: z.string(),
  name: z.string(),
  position: z.number().int().nonnegative(),
  color: hexColorSchema,
  dealCount: z.number().int().nonnegative().nullable(),
});
export type PipelineStageDto = z.infer<typeof pipelineStageDtoSchema>;

interface PipelineStageRow {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  color: string;
  _count?: { deals: number };
}

export function toPipelineStageDto(row: PipelineStageRow): PipelineStageDto {
  return {
    id: row.id,
    pipelineId: row.pipelineId,
    name: row.name,
    position: row.position,
    color: row.color,
    dealCount: row._count?.deals ?? null,
  };
}

// ── pipeline ────────────────────────────────────────────────────────

export const pipelineDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: isoDateSchema,
  stages: z.array(pipelineStageDtoSchema),
});
export type PipelineDto = z.infer<typeof pipelineDtoSchema>;

interface PipelineRow {
  id: string;
  name: string;
  createdAt: Date;
  stages?: PipelineStageRow[];
}

export function toPipelineDto(row: PipelineRow): PipelineDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: toIso(row.createdAt),
    stages: (row.stages ?? []).map(toPipelineStageDto),
  };
}

// ── deal ────────────────────────────────────────────────────────────

export const dealDtoSchema = z.object({
  id: z.string(),
  pipelineId: z.string(),
  stageId: z.string(),
  title: z.string(),
  /** Prisma Decimal serialised to a number; a raw Decimal becomes `{}`. */
  value: z.number(),
  currency: z.string(),
  notes: z.string().nullable(),
  expectedCloseDate: dateOnlySchema.nullable(),
  status: dealStatusSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  /** Null once the referenced contact is deleted; history is preserved. */
  contact: z
    .object({ id: z.string(), phone: z.string(), name: z.string().nullable() })
    .nullable(),
  conversationId: z.string().nullable(),
  stage: z
    .object({ id: z.string(), name: z.string(), color: hexColorSchema, position: z.number().int() })
    .nullable(),
});
export type DealDto = z.infer<typeof dealDtoSchema>;

interface DealRow {
  id: string;
  pipelineId: string;
  stageId: string;
  title: string;
  value: { toString(): string } | number;
  currency: string;
  notes: string | null;
  expectedCloseDate: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  conversationId: string | null;
  contact?: { id: string; phone: string; name: string | null } | null;
  stage?: { id: string; name: string; color: string; position: number } | null;
}

export function toDealDto(row: DealRow): DealDto {
  return {
    id: row.id,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    title: row.title,
    value: toNumber(row.value),
    currency: row.currency,
    notes: row.notes ?? null,
    expectedCloseDate: toDateOnly(row.expectedCloseDate),
    status: narrowDealStatus(row.status),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    contact: row.contact
      ? { id: row.contact.id, phone: row.contact.phone, name: row.contact.name ?? null }
      : null,
    conversationId: row.conversationId ?? null,
    stage: row.stage
      ? { id: row.stage.id, name: row.stage.name, color: row.stage.color, position: row.stage.position }
      : null,
  };
}

// ── analytics ───────────────────────────────────────────────────────

/**
 * Totals are grouped **by currency**, not summed into one figure.
 *
 * The old board and analytics panel both hardcoded USD in `formatCurrency`
 * and added mixed-currency deals together, so every metric was wrong for any
 * tenant not billing in dollars. Refusing to sum across currencies is the
 * only correct answer without an exchange-rate source.
 */
export const currencyTotalSchema = z.object({
  currency: z.string(),
  value: z.number(),
  count: z.number().int().nonnegative(),
});

export const pipelineAnalyticsDtoSchema = z.object({
  pipelineId: z.string(),
  totalDeals: z.number().int().nonnegative(),
  openTotals: z.array(currencyTotalSchema),
  wonTotals: z.array(currencyTotalSchema),
  lostTotals: z.array(currencyTotalSchema),
  /** Won ÷ (won + lost), as a percentage with one decimal. */
  winRate: z.number(),
  byStage: z.array(
    z.object({
      stageId: z.string(),
      stageName: z.string(),
      dealCount: z.number().int().nonnegative(),
      totals: z.array(currencyTotalSchema),
    }),
  ),
});
export type PipelineAnalyticsDto = z.infer<typeof pipelineAnalyticsDtoSchema>;
