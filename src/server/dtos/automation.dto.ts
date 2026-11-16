/**
 * Automation wire contracts.
 */

import { z } from 'zod';

import { AUTOMATION_STEP_TYPES, AUTOMATION_TRIGGER_TYPES } from '../validators/automation.validator';
import { isoDateSchema, jsonValueSchema, toIso, toIsoOrNull, toJsonArray, toJsonObject } from './common.dto';

export const automationTriggerTypeDtoSchema = z.enum(AUTOMATION_TRIGGER_TYPES);
export const automationStepTypeDtoSchema = z.enum(AUTOMATION_STEP_TYPES);

export interface AutomationStepDto {
  id: string;
  stepType: z.infer<typeof automationStepTypeDtoSchema>;
  stepConfig: Record<string, unknown>;
  position: number;
  branches: { yes: AutomationStepDto[]; no: AutomationStepDto[] };
}

/** Self-referential: `condition` steps nest their branches. */
export const automationStepDtoSchema: z.ZodType<AutomationStepDto> = z.lazy(() =>
  z.object({
    id: z.string(),
    stepType: automationStepTypeDtoSchema,
    stepConfig: z.record(z.unknown()),
    position: z.number().int().nonnegative(),
    branches: z.object({
      yes: z.array(automationStepDtoSchema),
      no: z.array(automationStepDtoSchema),
    }),
  }),
);

export const automationDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  triggerType: automationTriggerTypeDtoSchema,
  triggerConfig: z.record(jsonValueSchema),
  isActive: z.boolean(),
  executionCount: z.number().int().nonnegative(),
  lastExecutedAt: isoDateSchema.nullable(),
  stepCount: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AutomationDto = z.infer<typeof automationDtoSchema>;

export const automationDetailDtoSchema = automationDtoSchema.extend({
  steps: z.array(automationStepDtoSchema),
});
export type AutomationDetailDto = z.infer<typeof automationDetailDtoSchema>;

interface AutomationRow {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: unknown;
  isActive: boolean;
  executionCount: number;
  lastExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { steps: number };
}

export function toAutomationDto(row: AutomationRow): AutomationDto {
  const triggerType = automationTriggerTypeDtoSchema.safeParse(row.triggerType);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    // Rows created before the unsupported triggers were withdrawn may hold
    // `tag_added` or `time_based`. Reporting them as `new_message_received`
    // would be a lie, so they surface as inactive-by-shape: the detail view
    // shows the raw value and the service refuses to activate them.
    triggerType: triggerType.success ? triggerType.data : 'new_message_received',
    triggerConfig: toJsonObject(row.triggerConfig),
    isActive: row.isActive,
    executionCount: row.executionCount,
    lastExecutedAt: toIsoOrNull(row.lastExecutedAt),
    stepCount: row._count?.steps ?? 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

// ── logs ────────────────────────────────────────────────────────────

export const automationLogStepDtoSchema = z.object({
  stepId: z.string().nullable(),
  stepType: z.string(),
  status: z.enum(['success', 'skipped', 'failed', 'parked']),
  error: z.string().nullable(),
  branchChosen: z.enum(['yes', 'no']).nullable(),
});

export const automationLogDtoSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  triggerEvent: z.string(),
  status: z.enum(['success', 'partial', 'failed']),
  errorMessage: z.string().nullable(),
  stepsExecuted: z.array(automationLogStepDtoSchema),
  createdAt: isoDateSchema,
  /** Always populated when requested — the logs page showed "Unknown contact". */
  contact: z
    .object({ id: z.string(), phone: z.string(), name: z.string().nullable() })
    .nullable(),
});
export type AutomationLogDto = z.infer<typeof automationLogDtoSchema>;

interface AutomationLogRow {
  id: string;
  automationId: string;
  triggerEvent: string;
  status: string;
  errorMessage: string | null;
  stepsExecuted: unknown;
  createdAt: Date;
  contact?: { id: string; phone: string; name: string | null } | null;
}

function firstString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

/**
 * `AutomationLog.stepsExecuted` is an untyped JSON array, so it holds two
 * generations of keys: the pre-Phase-1 engine wrote `step_id` / `step_type` /
 * `branch_chosen`, the current one writes camelCase. Reading both keeps a
 * tenant's execution history legible instead of rendering every historical
 * row as "unknown".
 */
function narrowLogSteps(value: unknown): z.infer<typeof automationLogStepDtoSchema>[] {
  return toJsonArray(value).flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const status = record.status;
    const branch = firstString(record, 'branchChosen', 'branch_chosen');
    return [
      {
        stepId: firstString(record, 'stepId', 'step_id'),
        stepType: firstString(record, 'stepType', 'step_type') ?? 'unknown',
        status:
          status === 'success' || status === 'skipped' || status === 'failed' || status === 'parked'
            ? status
            : 'failed',
        error: typeof record.error === 'string' ? record.error : null,
        branchChosen: branch === 'yes' || branch === 'no' ? branch : null,
      },
    ];
  });
}

export function toAutomationLogDto(row: AutomationLogRow): AutomationLogDto {
  const status = row.status === 'success' || row.status === 'partial' || row.status === 'failed'
    ? row.status
    : 'failed';
  return {
    id: row.id,
    automationId: row.automationId,
    triggerEvent: row.triggerEvent,
    status,
    errorMessage: row.errorMessage ?? null,
    stepsExecuted: narrowLogSteps(row.stepsExecuted),
    createdAt: toIso(row.createdAt),
    contact: row.contact
      ? { id: row.contact.id, phone: row.contact.phone, name: row.contact.name ?? null }
      : null,
  };
}
