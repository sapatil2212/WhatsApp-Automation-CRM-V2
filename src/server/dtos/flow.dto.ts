/**
 * Flow wire contracts.
 *
 * Node `config` stays an opaque JSON object on the wire: each node type
 * carries a different shape, and `src/lib/flows/types.ts` already owns the
 * per-type definitions. Validating the union here would duplicate that and
 * the two would drift.
 */

import { z } from 'zod';

import { isoDateSchema, jsonValueSchema, toIso, toIsoOrNull, toJsonObject } from './common.dto';

export const FLOW_STATUSES = ['draft', 'active', 'archived'] as const;
export const flowStatusSchema = z.enum(FLOW_STATUSES);
export type FlowStatus = z.infer<typeof flowStatusSchema>;

export const FLOW_TRIGGER_TYPES = ['keyword', 'first_inbound_message', 'manual'] as const;
export const flowTriggerTypeSchema = z.enum(FLOW_TRIGGER_TYPES);
export type FlowTriggerType = z.infer<typeof flowTriggerTypeSchema>;

/**
 * Node types the runner can actually execute.
 *
 * `http_fetch` is deliberately absent. It is named in the schema comment
 * and referenced in the engine's own comments, but has no config
 * interface, no executor, and no builder entry — declaring it here would
 * advertise a capability that does not exist.
 */
export const FLOW_NODE_TYPES = [
  'start',
  'send_message',
  'send_buttons',
  'send_list',
  'collect_input',
  'condition',
  'set_tag',
  'handoff',
  'end',
] as const;
export const flowNodeTypeSchema = z.enum(FLOW_NODE_TYPES);
export type FlowNodeType = z.infer<typeof flowNodeTypeSchema>;

export const FLOW_RUN_STATUSES = [
  'active',
  'completed',
  'handed_off',
  'timed_out',
  'paused_by_agent',
  'failed',
] as const;
export const flowRunStatusSchema = z.enum(FLOW_RUN_STATUSES);

export const flowFallbackPolicyDtoSchema = z.object({
  on_no_match: z.enum(['ignore', 'reprompt', 'handoff', 'end']),
  max_reprompts: z.number().int().min(0).max(10),
  on_exhaust: z.enum(['handoff', 'end']),
  on_timeout_hours: z.number().int().min(1).max(720),
});
export type FlowFallbackPolicyDto = z.infer<typeof flowFallbackPolicyDtoSchema>;

export const DEFAULT_FALLBACK_POLICY: FlowFallbackPolicyDto = {
  on_no_match: 'reprompt',
  max_reprompts: 2,
  on_exhaust: 'handoff',
  on_timeout_hours: 24,
};

/**
 * Reads `flows.fallbackPolicy`, tolerating the key this column was written
 * with before the API contract was named.
 *
 * `src/lib/flows/types.ts` wrote `on_unknown_reply`; the wire contract calls
 * the same field `on_no_match`. Without the alias every existing flow would
 * fail this schema and silently fall back to `DEFAULT_FALLBACK_POLICY` —
 * turning a customer's configured `handoff` or `ignore` into `reprompt`.
 *
 * This is deliberately different from the automation step-config decision,
 * where the *stored* key was made canonical. There, two pieces of code
 * disagreed about one stored shape and the data could not be moved. Here it
 * is a rename between storage and wire, which is exactly what a DTO absorbs:
 * reads accept both, writes emit only `on_no_match`, and stored rows are
 * upgraded the next time the flow is saved. No data migration needed.
 *
 * The legacy enum had no `end` option, so the mapping is total.
 */
function parseFallbackPolicy(value: unknown): FlowFallbackPolicyDto {
  const raw = toJsonObject(value);
  const candidate =
    raw && typeof raw === 'object' && !('on_no_match' in raw) && 'on_unknown_reply' in raw
      ? { ...raw, on_no_match: (raw as Record<string, unknown>).on_unknown_reply }
      : raw;

  const parsed = flowFallbackPolicyDtoSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_FALLBACK_POLICY;
}

/** Exported for the engine, which needs the policy without the whole flow DTO. */
export function toFallbackPolicy(value: unknown): FlowFallbackPolicyDto {
  return parseFallbackPolicy(value);
}

// ── node ────────────────────────────────────────────────────────────

export const flowNodeDtoSchema = z.object({
  nodeKey: z.string(),
  nodeType: flowNodeTypeSchema,
  config: z.record(jsonValueSchema),
});
export type FlowNodeDto = z.infer<typeof flowNodeDtoSchema>;

interface FlowNodeRow {
  nodeKey: string;
  nodeType: string;
  config: unknown;
}

export function toFlowNodeDto(row: FlowNodeRow): FlowNodeDto {
  const nodeType = flowNodeTypeSchema.safeParse(row.nodeType);
  return {
    nodeKey: row.nodeKey,
    // An unrecognised type would make the whole flow unopenable in the
    // builder; degrading to `end` keeps it editable so the user can fix it.
    nodeType: nodeType.success ? nodeType.data : 'end',
    config: toJsonObject(row.config),
  };
}

// ── flow ────────────────────────────────────────────────────────────

export const flowDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: flowStatusSchema,
  triggerType: flowTriggerTypeSchema,
  triggerConfig: z.record(jsonValueSchema),
  entryNodeKey: z.string().nullable(),
  fallbackPolicy: flowFallbackPolicyDtoSchema,
  executionCount: z.number().int().nonnegative(),
  lastExecutedAt: isoDateSchema.nullable(),
  nodeCount: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type FlowDto = z.infer<typeof flowDtoSchema>;

/** Flow plus its full node graph, for the editor. */
export const flowDetailDtoSchema = flowDtoSchema.extend({
  nodes: z.array(flowNodeDtoSchema),
});
export type FlowDetailDto = z.infer<typeof flowDetailDtoSchema>;

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  triggerType: string;
  triggerConfig: unknown;
  entryNodeId: string | null;
  fallbackPolicy: unknown;
  executionCount: number;
  lastExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { nodes: number };
  nodes?: FlowNodeRow[];
}

export function toFlowDto(row: FlowRow): FlowDto {
  const status = flowStatusSchema.safeParse(row.status);
  const triggerType = flowTriggerTypeSchema.safeParse(row.triggerType);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    status: status.success ? status.data : 'draft',
    triggerType: triggerType.success ? triggerType.data : 'manual',
    triggerConfig: toJsonObject(row.triggerConfig),
    // The column is `entryNodeId` but it stores a *node key*, not a row id.
    // Renamed on the wire so the next reader is not misled.
    entryNodeKey: row.entryNodeId ?? null,
    fallbackPolicy: parseFallbackPolicy(row.fallbackPolicy),
    executionCount: row.executionCount,
    lastExecutedAt: toIsoOrNull(row.lastExecutedAt),
    nodeCount: row._count?.nodes ?? row.nodes?.length ?? 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function toFlowDetailDto(row: FlowRow & { nodes: FlowNodeRow[] }): FlowDetailDto {
  return { ...toFlowDto(row), nodes: row.nodes.map(toFlowNodeDto) };
}

// ── run ─────────────────────────────────────────────────────────────

export const flowRunDtoSchema = z.object({
  id: z.string(),
  flowId: z.string(),
  status: flowRunStatusSchema,
  currentNodeKey: z.string().nullable(),
  vars: z.record(jsonValueSchema),
  repromptCount: z.number().int().nonnegative(),
  startedAt: isoDateSchema,
  lastAdvancedAt: isoDateSchema,
  endedAt: isoDateSchema.nullable(),
  endReason: z.string().nullable(),
  contact: z
    .object({ id: z.string(), phone: z.string(), name: z.string().nullable() })
    .nullable(),
});
export type FlowRunDto = z.infer<typeof flowRunDtoSchema>;

interface FlowRunRow {
  id: string;
  flowId: string;
  status: string;
  currentNodeKey: string | null;
  vars: unknown;
  repromptCount: number;
  startedAt: Date;
  lastAdvancedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  contact?: { id: string; phone: string; name: string | null } | null;
}

export function toFlowRunDto(row: FlowRunRow): FlowRunDto {
  const status = flowRunStatusSchema.safeParse(row.status);
  return {
    id: row.id,
    flowId: row.flowId,
    status: status.success ? status.data : 'failed',
    currentNodeKey: row.currentNodeKey ?? null,
    vars: toJsonObject(row.vars),
    repromptCount: row.repromptCount,
    startedAt: toIso(row.startedAt),
    lastAdvancedAt: toIso(row.lastAdvancedAt),
    endedAt: toIsoOrNull(row.endedAt),
    endReason: row.endReason ?? null,
    // Always populated when requested. The runs viewer showed an empty
    // contact column because the old data layer dropped the join.
    contact: row.contact
      ? { id: row.contact.id, phone: row.contact.phone, name: row.contact.name ?? null }
      : null,
  };
}

export const flowRunEventDtoSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  nodeKey: z.string().nullable(),
  payload: z.record(jsonValueSchema),
  createdAt: isoDateSchema,
});
export type FlowRunEventDto = z.infer<typeof flowRunEventDtoSchema>;

export function toFlowRunEventDto(row: {
  id: string;
  eventType: string;
  nodeKey: string | null;
  payload: unknown;
  createdAt: Date;
}): FlowRunEventDto {
  return {
    id: row.id,
    eventType: row.eventType,
    nodeKey: row.nodeKey ?? null,
    payload: toJsonObject(row.payload),
    createdAt: toIso(row.createdAt),
  };
}

// ── validation feedback ─────────────────────────────────────────────

export const flowValidationIssueDtoSchema = z.object({
  severity: z.enum(['error', 'warning']),
  scope: z.enum(['flow', 'trigger', 'node']),
  nodeKey: z.string().nullable(),
  field: z.string().nullable(),
  message: z.string(),
});

export const flowActivationResultDtoSchema = z.object({
  flow: flowDtoSchema.nullable(),
  issues: z.array(flowValidationIssueDtoSchema),
});
export type FlowActivationResultDto = z.infer<typeof flowActivationResultDtoSchema>;
