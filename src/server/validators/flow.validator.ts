/**
 * Flow request schemas.
 *
 * Shape only — graph integrity (entry node exists, every `next_node_key`
 * resolves, Meta's button and list limits) is already owned by
 * `src/lib/flows/validate.ts`, which is well tested and shared with the
 * builder UI. The service calls it; this file does not duplicate it.
 */

import { z } from 'zod';

import { paginationQuerySchema } from '../kernel';
import {
  flowNodeTypeSchema,
  flowRunStatusSchema,
  flowStatusSchema,
  flowTriggerTypeSchema,
} from '../dtos/flow.dto';
import { jsonValueSchema } from '../dtos/common.dto';
import { idSchema, optionalText, requiredText, searchSchema } from './common.validator';

export const listFlowsQuerySchema = paginationQuerySchema.extend({
  status: flowStatusSchema.optional(),
  search: searchSchema,
});
export type ListFlowsQuery = z.infer<typeof listFlowsQuerySchema>;

export const listFlowRunsQuerySchema = paginationQuerySchema.extend({
  status: flowRunStatusSchema.optional(),
});
export type ListFlowRunsQuery = z.infer<typeof listFlowRunsQuerySchema>;

/**
 * A node key is the graph's stable identifier — it appears inside other
 * nodes' `next_node_key` fields. Restricting the character set keeps those
 * references readable and prevents a key that needs escaping.
 */
export const nodeKeySchema = z
  .string()
  .trim()
  .min(1, 'Node key is required.')
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Node keys may contain letters, numbers, underscores and hyphens.');

export const flowNodeInputSchema = z.object({
  nodeKey: nodeKeySchema,
  nodeType: flowNodeTypeSchema,
  config: z.record(jsonValueSchema).default({}),
});
export type FlowNodeInput = z.infer<typeof flowNodeInputSchema>;

const MAX_NODES_PER_FLOW = 200;

export const createFlowBodySchema = z.object({
  name: requiredText(120, 'Flow name'),
  description: optionalText(500),
  triggerType: flowTriggerTypeSchema.default('keyword'),
  triggerConfig: z.record(jsonValueSchema).default({}),
  /** Clone a starter template by supplying its nodes up front. */
  entryNodeKey: nodeKeySchema.nullable().default(null),
  nodes: z.array(flowNodeInputSchema).max(MAX_NODES_PER_FLOW).default([]),
});
export type CreateFlowBody = z.infer<typeof createFlowBodySchema>;

/**
 * The editor saves the whole graph at once, so `nodes` is a full
 * replacement rather than a patch. The service performs that replacement
 * inside a transaction — the previous implementation deleted then
 * re-inserted without one, and acknowledged in a comment that a concurrent
 * inbound message mid-save would fail the customer's run.
 */
export const updateFlowBodySchema = z
  .object({
    name: requiredText(120, 'Flow name').optional(),
    description: optionalText(500).optional(),
    triggerType: flowTriggerTypeSchema.optional(),
    triggerConfig: z.record(jsonValueSchema).optional(),
    entryNodeKey: nodeKeySchema.nullable().optional(),
    nodes: z.array(flowNodeInputSchema).max(MAX_NODES_PER_FLOW).optional(),
    fallbackPolicy: z
      .object({
        on_no_match: z.enum(['ignore', 'reprompt', 'handoff', 'end']),
        max_reprompts: z.coerce.number().int().min(0).max(10),
        on_exhaust: z.enum(['handoff', 'end']),
        on_timeout_hours: z.coerce.number().int().min(1).max(720),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  })
  .refine((value) => !value.nodes || uniqueKeys(value.nodes), {
    message: 'Node keys must be unique within a flow.',
    path: ['nodes'],
  });
export type UpdateFlowBody = z.infer<typeof updateFlowBodySchema>;

function uniqueKeys(nodes: FlowNodeInput[]): boolean {
  return new Set(nodes.map((node) => node.nodeKey)).size === nodes.length;
}

export const flowParamsSchema = z.object({ id: idSchema });
export type FlowParams = z.infer<typeof flowParamsSchema>;

export const flowRunParamsSchema = z.object({ id: idSchema, runId: idSchema });
export type FlowRunParams = z.infer<typeof flowRunParamsSchema>;

export const setFlowStatusBodySchema = z.object({
  status: z.enum(['draft', 'active', 'archived']),
});
export type SetFlowStatusBody = z.infer<typeof setFlowStatusBodySchema>;
