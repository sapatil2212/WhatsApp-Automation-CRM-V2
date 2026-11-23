'use client';

/**
 * Browser client for /api/automations.
 *
 * The server contract is camelCase inside the `{ success, message, data }`
 * envelope. Everything in the automations UI goes through this file so the
 * wire shape is defined in one place.
 */
import { api, ApiError } from '@/lib/campaigns/api';
import type { AutomationTriggerType } from '@/types';

export interface AutomationSummary {
  id: string;
  name: string;
  description: string | null;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  isActive: boolean;
  executionCount: number;
  lastExecutedAt: string | null;
  stepCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationStepNode {
  id: string;
  stepType: string;
  stepConfig: Record<string, unknown>;
  position: number;
  branches: { yes: AutomationStepNode[]; no: AutomationStepNode[] };
}

export interface AutomationDetail extends AutomationSummary {
  steps: AutomationStepNode[];
}

export interface AutomationLogStep {
  stepId: string | null;
  stepType: string;
  status: 'success' | 'skipped' | 'failed' | 'parked';
  error: string | null;
  branchChosen: 'yes' | 'no' | null;
}

export interface AutomationLogEntry {
  id: string;
  automationId: string;
  triggerEvent: string;
  status: 'success' | 'partial' | 'failed';
  errorMessage: string | null;
  stepsExecuted: AutomationLogStep[];
  createdAt: string;
  contact: { id: string; phone: string; name: string | null } | null;
}

export interface ValidationIssue {
  path?: string;
  message?: string;
}

/** First concrete validation problem carried by an ApiError, if any. */
export function firstIssue(err: unknown): ValidationIssue | null {
  if (!(err instanceof ApiError)) return null;
  const issues = (err.details as { issues?: ValidationIssue[] } | undefined)?.issues;
  return Array.isArray(issues) && issues.length > 0 ? issues[0] : null;
}

export async function listAutomations(): Promise<AutomationSummary[]> {
  const res = await api<AutomationSummary[]>('/api/automations?pageSize=100');
  return res.data;
}

export async function getAutomation(id: string): Promise<AutomationDetail> {
  return (await api<AutomationDetail>(`/api/automations/${id}`)).data;
}

export async function setAutomationActive(id: string, isActive: boolean): Promise<AutomationDetail> {
  return (await api<AutomationDetail>(`/api/automations/${id}`, { method: 'PATCH', json: { isActive } })).data;
}

export async function duplicateAutomation(id: string): Promise<AutomationDetail> {
  return (await api<AutomationDetail>(`/api/automations/${id}/duplicate`, { method: 'POST' })).data;
}

export async function deleteAutomation(id: string): Promise<void> {
  await api(`/api/automations/${id}`, { method: 'DELETE' });
}

export async function listAutomationLogs(id: string): Promise<AutomationLogEntry[]> {
  return (await api<AutomationLogEntry[]>(`/api/automations/${id}/logs?pageSize=100`)).data;
}

export interface SaveAutomationInput {
  name: string;
  description: string | null;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  isActive: boolean;
  steps: unknown[];
}

export async function saveAutomation(id: string | undefined, input: SaveAutomationInput): Promise<AutomationDetail> {
  const res = id
    ? await api<AutomationDetail>(`/api/automations/${id}`, { method: 'PATCH', json: input })
    : await api<AutomationDetail>('/api/automations', { method: 'POST', json: input });
  return res.data;
}
