/**
 * Broadcast request schemas.
 *
 * The audience is a typed union here, not the opaque JSON the old wizard
 * posted. That matters because an unparseable audience previously produced
 * an empty recipient set and the campaign still reported success.
 */

import { z } from 'zod';

import { paginationQuerySchema } from '../kernel';
import { audienceSchema, broadcastStatusSchema, recipientStatusSchema } from '../dtos/broadcast.dto';
import { idSchema, nonEmptyPatch, requiredText, searchSchema } from './common.validator';

export const listBroadcastsQuerySchema = paginationQuerySchema.extend({
  status: broadcastStatusSchema.optional(),
  search: searchSchema,
});
export type ListBroadcastsQuery = z.infer<typeof listBroadcastsQuerySchema>;

export const listRecipientsQuerySchema = paginationQuerySchema.extend({
  status: recipientStatusSchema.optional(),
});
export type ListRecipientsQuery = z.infer<typeof listRecipientsQuerySchema>;

const templateSelection = {
  templateName: requiredText(512, 'Template name'),
  templateLanguage: z.string().trim().max(20).default('en_US'),
  /** Positional values for `{{1}}…{{n}}`. */
  templateVariables: z.array(z.string().max(1024)).max(20).default([]),
};

export const createBroadcastBodySchema = z.object({
  name: requiredText(160, 'Campaign name'),
  ...templateSelection,
  audience: audienceSchema,
  /**
   * Absent means "send when told to". A past timestamp is rejected rather
   * than silently sent immediately, so a timezone mistake surfaces at the
   * boundary. `Broadcast.scheduledAt` existed but nothing ever read or
   * wrote it.
   */
  scheduledAt: z.coerce
    .date()
    .refine((value) => value.getTime() > Date.now(), {
      message: 'Scheduled time must be in the future.',
    })
    .optional(),
});
export type CreateBroadcastBody = z.infer<typeof createBroadcastBodySchema>;

export const updateBroadcastBodySchema = nonEmptyPatch(
  z.object({
    name: requiredText(160, 'Campaign name').optional(),
    templateName: requiredText(512, 'Template name').optional(),
    templateLanguage: z.string().trim().max(20).optional(),
    templateVariables: z.array(z.string().max(1024)).max(20).optional(),
    audience: audienceSchema.optional(),
    /** `null` clears the schedule. */
    scheduledAt: z.coerce.date().nullable().optional(),
  }),
);
export type UpdateBroadcastBody = z.infer<typeof updateBroadcastBodySchema>;

export const previewAudienceBodySchema = z.object({
  audience: audienceSchema,
});
export type PreviewAudienceBody = z.infer<typeof previewAudienceBodySchema>;

export const broadcastParamsSchema = z.object({ id: idSchema });
export type BroadcastParams = z.infer<typeof broadcastParamsSchema>;

/**
 * One pass of the server-side sender. Bounded so a single invocation
 * cannot run unbounded inside a request; the caller (a cron tick or the
 * dispatch route) loops while `hasMore` is true.
 */
export const MAX_SEND_BATCH = 200;

export const dispatchBroadcastBodySchema = z.object({
  batchSize: z.coerce.number().int().min(1).max(MAX_SEND_BATCH).default(50),
});
export type DispatchBroadcastBody = z.infer<typeof dispatchBroadcastBodySchema>;
