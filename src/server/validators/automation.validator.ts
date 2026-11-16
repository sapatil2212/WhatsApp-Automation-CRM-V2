/**
 * Automation request schemas — and the canonical step-config contract.
 *
 * ## The drift this resolves
 *
 * Three places disagreed about what a step's config looks like:
 *
 * | step | builder + validator + templates wrote | engine read |
 * | --- | --- | --- |
 * | `wait` | `amount`, `unit` | `duration` |
 * | `condition` | `subject`, `operand`, `value` | `condition_type`, `operator`, `field_value` |
 * | `update_contact_field` | `field`, `value` | `field_source`, `field_name`, `field_value` |
 * | `create_deal` | `title`, `value` | `deal_title`, `deal_value` |
 * | `assign_conversation` | `mode` | `agent_id` |
 *
 * The consequences were silent: `wait` computed `NaN` milliseconds and
 * failed the step, every `condition` fell through to `return false` and so
 * always took the `no` branch, `update_contact_field` threw, `create_deal`
 * always produced "New Deal" worth 0, and `close_conversation` had no
 * engine branch at all but was logged as a success.
 *
 * **The builder's shape is canonical**, because it is what is already
 * persisted in `automation_steps.step_config`. Choosing the engine's shape
 * instead would require migrating live data. The engine is corrected to
 * read these keys in step 1.3, and these schemas are the single definition
 * both sides import — the drift cannot reopen.
 */

import { z } from 'zod';

import { paginationQuerySchema } from '../kernel';
import { idSchema, httpUrlSchema, nonEmptyPatch, optionalText, requiredText } from './common.validator';

// ── triggers ────────────────────────────────────────────────────────

/**
 * Only the four triggers that are actually dispatched from the webhook.
 *
 * `tag_added`, `conversation_assigned` and `time_based` are deliberately
 * excluded: all three appeared in the builder, the validator and the badge
 * list, but nothing ever dispatched them, so a user could build and
 * activate an automation that could never fire. Offering them again
 * requires a dispatcher, not a schema entry.
 */
export const AUTOMATION_TRIGGER_TYPES = [
  'new_message_received',
  'first_inbound_message',
  'keyword_match',
  'new_contact_created',
] as const;
export const automationTriggerTypeSchema = z.enum(AUTOMATION_TRIGGER_TYPES);
export type AutomationTriggerType = z.infer<typeof automationTriggerTypeSchema>;

export const keywordTriggerConfigSchema = z.object({
  keywords: z.array(requiredText(80, 'Keyword')).min(1, 'Add at least one keyword.').max(50),
  match_type: z.enum(['exact', 'contains']).default('contains'),
  case_sensitive: z.boolean().default(false),
});

export const emptyTriggerConfigSchema = z.object({}).strip();

/** Validates the config against whichever trigger was chosen. */
export function triggerConfigSchemaFor(triggerType: AutomationTriggerType) {
  return triggerType === 'keyword_match' ? keywordTriggerConfigSchema : emptyTriggerConfigSchema;
}

// ── step configs (canonical) ────────────────────────────────────────

export const WAIT_UNITS = ['minutes', 'hours', 'days'] as const;

/** Built-in contact columns an automation may write. */
export const CONTACT_WRITABLE_FIELDS = ['name', 'email', 'company'] as const;

export const CONDITION_SUBJECTS = [
  'contact_field',
  'tag_presence',
  'message_content',
  'time_of_day',
] as const;

const sendMessageConfig = z.object({
  text: requiredText(4096, 'Message text'),
});

const sendTemplateConfig = z.object({
  template_name: requiredText(512, 'Template name'),
  language: z.string().trim().max(20).default('en_US'),
  variables: z.array(z.string().max(1024)).max(20).default([]),
});

const tagConfig = z.object({
  tag_id: idSchema,
});

const assignConversationConfig = z
  .object({
    mode: z.enum(['specific', 'round_robin']).default('specific'),
    agent_id: idSchema.optional(),
  })
  .refine((value) => value.mode !== 'specific' || Boolean(value.agent_id), {
    message: 'Select an agent when the mode is "specific".',
    path: ['agent_id'],
  });

const updateContactFieldConfig = z.object({
  field: z.enum(CONTACT_WRITABLE_FIELDS),
  value: z.string().trim().max(500),
});

const createDealConfig = z.object({
  pipeline_id: idSchema,
  stage_id: idSchema,
  title: requiredText(200, 'Deal title'),
  value: z.coerce.number().min(0).max(1_000_000_000).default(0),
  currency: z.string().trim().length(3).default('USD'),
});

const waitConfig = z.object({
  amount: z.coerce.number().int().min(1, 'Wait amount must be at least 1.').max(365),
  unit: z.enum(WAIT_UNITS),
});

/**
 * `operand` and `value` are kept as-is for compatibility with stored rows;
 * `superRefine` supplies the per-subject meaning the flat shape cannot.
 */
const conditionConfig = z
  .object({
    subject: z.enum(CONDITION_SUBJECTS),
    operand: z.string().trim().max(200).optional(),
    value: z.string().trim().max(500).optional(),
  })
  .superRefine((config, ctx) => {
    const requireOperand = (message: string) => {
      if (!config.operand) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['operand'] });
      }
    };

    if (config.subject === 'contact_field') {
      requireOperand('Choose which contact field to compare.');
      if (config.value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide a value to compare against.',
          path: ['value'],
        });
      }
    } else if (config.subject === 'tag_presence') {
      requireOperand('Choose a tag.');
      if (config.operand && !idSchema.safeParse(config.operand).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose a valid tag.', path: ['operand'] });
      }
    } else if (config.subject === 'message_content') {
      requireOperand('Provide the text to look for.');
    } else if (config.subject === 'time_of_day') {
      requireOperand('Provide a window such as 09:00-17:00.');
      if (config.operand && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(config.operand)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Use a HH:mm-HH:mm window, e.g. 09:00-17:00.',
          path: ['operand'],
        });
      }
    }
  });

const sendWebhookConfig = z.object({
  url: httpUrlSchema,
  headers: z.record(z.string().max(1024)).default({}),
  body_template: z.string().max(4000).optional(),
});

const closeConversationConfig = z.object({}).strip();

/** Step types the engine can execute after the step-1.3 correction. */
export const AUTOMATION_STEP_TYPES = [
  'send_message',
  'send_template',
  'add_tag',
  'remove_tag',
  'assign_conversation',
  'update_contact_field',
  'create_deal',
  'wait',
  'condition',
  'send_webhook',
  'close_conversation',
] as const;
export type AutomationStepType = (typeof AUTOMATION_STEP_TYPES)[number];

const STEP_CONFIG_SCHEMAS = {
  send_message: sendMessageConfig,
  send_template: sendTemplateConfig,
  add_tag: tagConfig,
  remove_tag: tagConfig,
  assign_conversation: assignConversationConfig,
  update_contact_field: updateContactFieldConfig,
  create_deal: createDealConfig,
  wait: waitConfig,
  condition: conditionConfig,
  send_webhook: sendWebhookConfig,
  close_conversation: closeConversationConfig,
} as const;

export function stepConfigSchemaFor(stepType: AutomationStepType) {
  return STEP_CONFIG_SCHEMAS[stepType];
}

export type WaitStepConfig = z.infer<typeof waitConfig>;
export type ConditionStepConfig = z.infer<typeof conditionConfig>;
export type SendMessageStepConfig = z.infer<typeof sendMessageConfig>;
export type SendTemplateStepConfig = z.infer<typeof sendTemplateConfig>;
export type TagStepConfig = z.infer<typeof tagConfig>;
export type AssignConversationStepConfig = z.infer<typeof assignConversationConfig>;
export type UpdateContactFieldStepConfig = z.infer<typeof updateContactFieldConfig>;
export type CreateDealStepConfig = z.infer<typeof createDealConfig>;
export type SendWebhookStepConfig = z.infer<typeof sendWebhookConfig>;

/** Milliseconds a `wait` step parks for. Single definition. */
export function waitDurationMs(config: WaitStepConfig): number {
  const perUnit = config.unit === 'minutes' ? 60_000 : config.unit === 'hours' ? 3_600_000 : 86_400_000;
  return config.amount * perUnit;
}

// ── step tree ───────────────────────────────────────────────────────

const MAX_STEPS = 100;
const MAX_DEPTH = 5;

/**
 * Steps arrive as a tree; `condition` nodes carry `yes`/`no` branches. The
 * recursion is typed lazily because the shape is self-referential, and the
 * config is validated per `step_type` in the service so the error path can
 * name the offending step.
 */
export interface StepInput {
  step_type: AutomationStepType;
  step_config: Record<string, unknown>;
  branches?: { yes?: StepInput[]; no?: StepInput[] };
}

/**
 * Input type is `unknown` rather than `StepInput`: `step_config` has a
 * `.default({})`, so the parsed output is required while the accepted input
 * is optional, and a single-type `ZodType` cannot express both.
 */
export const stepInputSchema: z.ZodType<StepInput, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    step_type: z.enum(AUTOMATION_STEP_TYPES),
    step_config: z.record(z.unknown()).default({}),
    branches: z
      .object({
        yes: z.array(stepInputSchema).max(MAX_STEPS).optional(),
        no: z.array(stepInputSchema).max(MAX_STEPS).optional(),
      })
      .optional(),
  }),
);

export function countSteps(steps: StepInput[]): number {
  return steps.reduce(
    (total, step) =>
      total + 1 + countSteps(step.branches?.yes ?? []) + countSteps(step.branches?.no ?? []),
    0,
  );
}

export function maxStepDepth(steps: StepInput[], depth = 1): number {
  return steps.reduce((deepest, step) => {
    const branches = [...(step.branches?.yes ?? []), ...(step.branches?.no ?? [])];
    const branchDepth = branches.length > 0 ? maxStepDepth(branches, depth + 1) : depth;
    return Math.max(deepest, branchDepth);
  }, depth);
}

export const STEP_LIMITS = { maxSteps: MAX_STEPS, maxDepth: MAX_DEPTH } as const;

// ── requests ────────────────────────────────────────────────────────

export const listAutomationsQuerySchema = paginationQuerySchema.extend({
  isActive: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  triggerType: automationTriggerTypeSchema.optional(),
});
export type ListAutomationsQuery = z.infer<typeof listAutomationsQuerySchema>;

export const createAutomationBodySchema = z.object({
  name: requiredText(120, 'Automation name'),
  description: optionalText(500),
  triggerType: automationTriggerTypeSchema,
  triggerConfig: z.record(z.unknown()).default({}),
  steps: z.array(stepInputSchema).max(MAX_STEPS).default([]),
  /** Activation is validated; an invalid automation cannot be created live. */
  isActive: z.boolean().default(false),
});
export type CreateAutomationBody = z.infer<typeof createAutomationBodySchema>;

export const updateAutomationBodySchema = nonEmptyPatch(
  z.object({
    name: requiredText(120, 'Automation name').optional(),
    description: optionalText(500).optional(),
    triggerType: automationTriggerTypeSchema.optional(),
    triggerConfig: z.record(z.unknown()).optional(),
    steps: z.array(stepInputSchema).max(MAX_STEPS).optional(),
    isActive: z.boolean().optional(),
  }),
);
export type UpdateAutomationBody = z.infer<typeof updateAutomationBodySchema>;

export const automationParamsSchema = z.object({ id: idSchema });
export type AutomationParams = z.infer<typeof automationParamsSchema>;

export const listAutomationLogsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['success', 'partial', 'failed']).optional(),
});
export type ListAutomationLogsQuery = z.infer<typeof listAutomationLogsQuerySchema>;
