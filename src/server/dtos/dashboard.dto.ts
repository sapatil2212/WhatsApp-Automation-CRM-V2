/**
 * Dashboard wire contract.
 *
 * One endpoint, one payload. The old dashboard issued a dozen separate
 * table reads from the browser and reduced them client-side; a single
 * aggregate response means the page renders from one request and the numbers
 * are internally consistent.
 */

import { z } from 'zod';

import { currencyTotalSchema } from './pipeline.dto';
import { isoDateSchema } from './common.dto';

/**
 * Absolute change plus a percentage against the preceding window.
 * `changePercent` is null when the previous window was zero — a rise from 0
 * has no meaningful percentage, and reporting `Infinity` or `100%` would be
 * a fabrication.
 */
export const metricDeltaSchema = z.object({
  current: z.number(),
  previous: z.number(),
  change: z.number(),
  changePercent: z.number().nullable(),
});
export type MetricDelta = z.infer<typeof metricDeltaSchema>;

export function toMetricDelta(current: number, previous: number): MetricDelta {
  return {
    current,
    previous,
    change: current - previous,
    changePercent: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
  };
}

export const dashboardDtoSchema = z.object({
  window: z.object({ from: isoDateSchema, to: isoDateSchema }),
  contacts: z.object({
    total: z.number().int().nonnegative(),
    created: metricDeltaSchema,
  }),
  conversations: z.object({
    open: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
    unreadTotal: z.number().int().nonnegative(),
    active: metricDeltaSchema,
  }),
  messages: z.object({
    inbound: z.number().int().nonnegative(),
    outbound: z.number().int().nonnegative(),
    /** Outbound ÷ inbound, one decimal. Null when nothing came in. */
    replyRatio: z.number().nullable(),
    byDay: z.array(
      z.object({
        date: z.string(),
        inbound: z.number().int().nonnegative(),
        outbound: z.number().int().nonnegative(),
      }),
    ),
  }),
  deals: z.object({
    open: z.array(currencyTotalSchema),
    won: z.array(currencyTotalSchema),
    lost: z.array(currencyTotalSchema),
  }),
  broadcasts: z.object({
    count: z.number().int().nonnegative(),
    recipients: z.number().int().nonnegative(),
    sent: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    read: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  automations: z.object({
    active: z.number().int().nonnegative(),
    executions: z.number().int().nonnegative(),
  }),
  topTags: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      contactCount: z.number().int().nonnegative(),
    }),
  ),
  activity: z.array(
    z.object({
      kind: z.enum(['contact_created', 'message_received']),
      at: isoDateSchema,
      contactId: z.string().nullable(),
      contactName: z.string().nullable(),
      contactPhone: z.string().nullable(),
      conversationId: z.string().nullable(),
      preview: z.string().nullable(),
    }),
  ),
});
export type DashboardDto = z.infer<typeof dashboardDtoSchema>;
