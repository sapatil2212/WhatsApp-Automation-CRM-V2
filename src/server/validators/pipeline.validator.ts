/**
 * Pipeline and deal request schemas.
 */

import { z } from 'zod';

import { paginationQuerySchema } from '../kernel';
import { dealStatusSchema } from '../dtos/pipeline.dto';
import {
  hexColorSchema,
  idSchema,
  nonEmptyPatch,
  optionalText,
  requiredText,
  searchSchema,
} from './common.validator';

export const pipelineParamsSchema = z.object({ id: idSchema });
export type PipelineParams = z.infer<typeof pipelineParamsSchema>;

export const stageParamsSchema = z.object({ id: idSchema, stageId: idSchema });
export type StageParams = z.infer<typeof stageParamsSchema>;

export const dealParamsSchema = z.object({ id: idSchema });
export type DealParams = z.infer<typeof dealParamsSchema>;

export const createPipelineBodySchema = z.object({
  name: requiredText(120, 'Pipeline name'),
});
export type CreatePipelineBody = z.infer<typeof createPipelineBodySchema>;

export const updatePipelineBodySchema = z.object({
  name: requiredText(120, 'Pipeline name'),
});
export type UpdatePipelineBody = z.infer<typeof updatePipelineBodySchema>;

export const createStageBodySchema = z.object({
  name: requiredText(60, 'Stage name'),
  color: hexColorSchema.default('#3b82f6'),
});
export type CreateStageBody = z.infer<typeof createStageBodySchema>;

/**
 * Bulk reorder/rename. `position` is derived from array order rather than
 * trusted from the client, so two stages can never claim the same slot.
 */
export const reorderStagesBodySchema = z.object({
  stages: z
    .array(
      z.object({
        id: idSchema,
        name: requiredText(60, 'Stage name'),
        color: hexColorSchema,
      }),
    )
    .min(1, 'A pipeline needs at least one stage.')
    .max(30),
});
export type ReorderStagesBody = z.infer<typeof reorderStagesBodySchema>;

export const listDealsQuerySchema = paginationQuerySchema.extend({
  pipelineId: idSchema.optional(),
  stageId: idSchema.optional(),
  status: dealStatusSchema.optional(),
  contactId: idSchema.optional(),
  search: searchSchema,
});
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;

const dealValueSchema = z.coerce
  .number()
  .min(0, 'Deal value cannot be negative.')
  // Decimal(12,2) — beyond this the database silently truncates.
  .max(9_999_999_999.99, 'Deal value exceeds the maximum supported amount.');

export const createDealBodySchema = z.object({
  title: requiredText(200, 'Deal title'),
  pipelineId: idSchema,
  stageId: idSchema,
  contactId: idSchema,
  conversationId: idSchema.nullish().transform((value) => value ?? null),
  value: dealValueSchema.default(0),
  /** ISO-4217. Uppercased so `usd` and `USD` do not become two currencies. */
  currency: z
    .string()
    .trim()
    .length(3, 'Use a three-letter currency code.')
    .toUpperCase()
    .default('USD'),
  notes: optionalText(2000),
  expectedCloseDate: z.coerce.date().nullish().transform((value) => value ?? null),
});
export type CreateDealBody = z.infer<typeof createDealBodySchema>;

export const updateDealBodySchema = nonEmptyPatch(
  z.object({
    title: requiredText(200, 'Deal title').optional(),
    /** Moving between stages is how the board's drag-and-drop persists. */
    stageId: idSchema.optional(),
    value: dealValueSchema.optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    notes: optionalText(2000).optional(),
    expectedCloseDate: z.coerce.date().nullable().optional(),
    status: dealStatusSchema.optional(),
  }),
);
export type UpdateDealBody = z.infer<typeof updateDealBodySchema>;
