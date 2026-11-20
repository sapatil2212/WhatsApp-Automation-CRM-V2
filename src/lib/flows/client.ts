/**
 * Client adapter between the flows API (standard `{ success, data }`
 * envelope, camelCase DTOs) and the flow UI components, which work with the
 * snake_case `FlowRow` / `FlowNodeRow` shapes the engine also uses.
 *
 * The API moved to the envelope during the server refactor but the Flows
 * pages kept reading `json.flows` / `json.flow` — so the list was always
 * empty, the editor could not load a flow, and saves went to a PUT route
 * that no longer existed. Everything now goes through this module.
 */

import type { FlowNodeRow, FlowRow } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FlowDtoLike {
  id: string;
  name: string;
  description: string | null;
  status: FlowRow['status'];
  triggerType: FlowRow['trigger_type'];
  triggerConfig: Record<string, unknown>;
  entryNodeKey: string | null;
  fallbackPolicy: any;
  executionCount: number;
  lastExecutedAt: string | null;
  nodeCount?: number;
  createdAt: string;
  updatedAt: string;
  nodes?: Array<{ nodeKey: string; nodeType: string; config: Record<string, unknown> }>;
}

export function flowFromDto(dto: FlowDtoLike): FlowRow & { node_count?: number } {
  return {
    id: dto.id,
    user_id: '',
    name: dto.name,
    description: dto.description,
    status: dto.status,
    trigger_type: dto.triggerType,
    trigger_config: dto.triggerConfig ?? {},
    entry_node_id: dto.entryNodeKey,
    fallback_policy: dto.fallbackPolicy,
    execution_count: dto.executionCount ?? 0,
    last_executed_at: dto.lastExecutedAt,
    created_at: dto.createdAt,
    updated_at: dto.updatedAt,
    node_count: dto.nodeCount,
  };
}

export function nodesFromDto(flowId: string, dto: FlowDtoLike): FlowNodeRow[] {
  return (dto.nodes ?? []).map((n, i) => ({
    id: `${flowId}:${n.nodeKey}`,
    flow_id: flowId,
    node_key: n.nodeKey,
    node_type: n.nodeType as FlowNodeRow['node_type'],
    config: n.config ?? {},
    position_x: 0,
    position_y: i * 120,
    created_at: dto.createdAt,
  }));
}

/** Builder state → PATCH /api/flows/[id] body. */
export function flowUpdateBody(state: {
  name: string;
  description?: string | null;
  trigger_type: FlowRow['trigger_type'];
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  nodes: Array<{ node_key: string; node_type: string; config: Record<string, unknown> }>;
}) {
  return {
    name: state.name,
    description: state.description || null,
    triggerType: state.trigger_type,
    triggerConfig: state.trigger_config,
    entryNodeKey: state.entry_node_id,
    nodes: state.nodes.map((n) => ({ nodeKey: n.node_key, nodeType: n.node_type, config: n.config })),
  };
}

/** Unwraps the envelope (or passes legacy bodies through). */
export function unwrap<T>(json: any): T {
  return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}

export function apiErrorMessage(json: any, fallback: string): string {
  return (json && (json.message || json.error)) || fallback;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
