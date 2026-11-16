import { describe, expect, it } from 'vitest';

import {
  countSteps,
  keywordTriggerConfigSchema,
  maxStepDepth,
  stepConfigSchemaFor,
  triggerConfigSchemaFor,
  waitDurationMs,
  type StepInput,
} from './automation.validator';

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function step(type: StepInput['step_type'], config: Record<string, unknown> = {}): StepInput {
  return { step_type: type, step_config: config };
}

describe('trigger configs', () => {
  it('requires at least one keyword for a keyword trigger', () => {
    expect(keywordTriggerConfigSchema.safeParse({ keywords: [] }).success).toBe(false);
    expect(keywordTriggerConfigSchema.safeParse({ keywords: ['hi'] }).success).toBe(true);
  });

  it('rejects blank keywords', () => {
    expect(keywordTriggerConfigSchema.safeParse({ keywords: ['  '] }).success).toBe(false);
  });

  it('defaults to contains matching, case-insensitive', () => {
    const parsed = keywordTriggerConfigSchema.parse({ keywords: ['hi'] });
    expect(parsed).toMatchObject({ match_type: 'contains', case_sensitive: false });
  });

  it('ignores config on triggers that take none', () => {
    const schema = triggerConfigSchemaFor('new_contact_created');
    expect(schema.parse({ stray: 'value' })).toEqual({});
  });
});

describe('wait step — the config the engine used to misread', () => {
  const schema = stepConfigSchemaFor('wait');

  it('accepts the canonical amount + unit shape', () => {
    expect(schema.safeParse({ amount: 2, unit: 'hours' }).success).toBe(true);
  });

  it('rejects the engine’s old `duration` key, which produced NaN', () => {
    expect(schema.safeParse({ duration: 2, unit: 'hours' }).success).toBe(false);
  });

  it('rejects a zero or negative wait', () => {
    expect(schema.safeParse({ amount: 0, unit: 'hours' }).success).toBe(false);
    expect(schema.safeParse({ amount: -1, unit: 'hours' }).success).toBe(false);
  });

  it('rejects an unknown unit', () => {
    expect(schema.safeParse({ amount: 1, unit: 'weeks' }).success).toBe(false);
  });

  it('converts to milliseconds for every unit', () => {
    expect(waitDurationMs({ amount: 5, unit: 'minutes' })).toBe(300_000);
    expect(waitDurationMs({ amount: 2, unit: 'hours' })).toBe(7_200_000);
    expect(waitDurationMs({ amount: 3, unit: 'days' })).toBe(259_200_000);
  });
});

describe('condition step — the config that always took the `no` branch', () => {
  const schema = stepConfigSchemaFor('condition');

  it('requires a field and value for contact_field', () => {
    expect(schema.safeParse({ subject: 'contact_field' }).success).toBe(false);
    expect(
      schema.safeParse({ subject: 'contact_field', operand: 'company', value: 'Acme' }).success,
    ).toBe(true);
  });

  it('requires a valid tag id for tag_presence', () => {
    expect(schema.safeParse({ subject: 'tag_presence', operand: 'not-a-uuid' }).success).toBe(false);
    expect(schema.safeParse({ subject: 'tag_presence', operand: UUID }).success).toBe(true);
  });

  it('requires text for message_content', () => {
    expect(schema.safeParse({ subject: 'message_content' }).success).toBe(false);
    expect(schema.safeParse({ subject: 'message_content', operand: 'refund' }).success).toBe(true);
  });

  it('requires a HH:mm-HH:mm window for time_of_day', () => {
    expect(schema.safeParse({ subject: 'time_of_day', operand: 'business hours' }).success).toBe(false);
    expect(schema.safeParse({ subject: 'time_of_day', operand: '09:00-17:00' }).success).toBe(true);
  });

  it('rejects the engine’s old condition_type key', () => {
    expect(schema.safeParse({ condition_type: 'tag', operator: 'has', tag_id: UUID }).success).toBe(false);
  });
});

describe('other step configs', () => {
  it('requires message text and enforces WhatsApp’s 4096 limit', () => {
    const schema = stepConfigSchemaFor('send_message');
    expect(schema.safeParse({ text: '' }).success).toBe(false);
    expect(schema.safeParse({ text: 'x'.repeat(4097) }).success).toBe(false);
    expect(schema.safeParse({ text: 'Hello' }).success).toBe(true);
  });

  it('requires a valid tag id for add_tag and remove_tag', () => {
    expect(stepConfigSchemaFor('add_tag').safeParse({ tag_id: '' }).success).toBe(false);
    expect(stepConfigSchemaFor('remove_tag').safeParse({ tag_id: UUID }).success).toBe(true);
  });

  it('requires an agent when assignment mode is specific', () => {
    const schema = stepConfigSchemaFor('assign_conversation');
    expect(schema.safeParse({ mode: 'specific' }).success).toBe(false);
    expect(schema.safeParse({ mode: 'specific', agent_id: UUID }).success).toBe(true);
    expect(schema.safeParse({ mode: 'round_robin' }).success).toBe(true);
  });

  it('restricts update_contact_field to writable built-in columns', () => {
    const schema = stepConfigSchemaFor('update_contact_field');
    expect(schema.safeParse({ field: 'name', value: 'Asha' }).success).toBe(true);
    expect(schema.safeParse({ field: 'phone', value: '999' }).success).toBe(false);
    expect(schema.safeParse({ field: 'tenantId', value: 'x' }).success).toBe(false);
  });

  it('requires pipeline, stage and title for create_deal, and defaults value', () => {
    const schema = stepConfigSchemaFor('create_deal');
    expect(schema.safeParse({ pipeline_id: UUID, stage_id: UUID }).success).toBe(false);
    const parsed = schema.parse({ pipeline_id: UUID, stage_id: UUID, title: 'New lead' });
    expect(parsed).toMatchObject({ value: 0, currency: 'USD' });
  });

  it('requires an http(s) webhook url', () => {
    const schema = stepConfigSchemaFor('send_webhook');
    expect(schema.safeParse({ url: 'ftp://x.com' }).success).toBe(false);
    expect(schema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(schema.safeParse({ url: 'https://hooks.example.com/x' }).success).toBe(true);
  });

  it('accepts an empty config for close_conversation', () => {
    expect(stepConfigSchemaFor('close_conversation').safeParse({}).success).toBe(true);
  });

  it('defaults template language and variables', () => {
    const parsed = stepConfigSchemaFor('send_template').parse({ template_name: 'welcome' });
    expect(parsed).toMatchObject({ language: 'en_US', variables: [] });
  });
});

describe('step tree measurement', () => {
  it('counts nested branch steps, not just roots', () => {
    const tree: StepInput[] = [
      {
        ...step('condition', { subject: 'message_content', operand: 'hi' }),
        branches: { yes: [step('send_message', { text: 'a' })], no: [step('close_conversation')] },
      },
      step('send_message', { text: 'b' }),
    ];
    expect(countSteps(tree)).toBe(4);
  });

  it('measures nesting depth', () => {
    const nested: StepInput[] = [
      {
        ...step('condition'),
        branches: {
          yes: [
            {
              ...step('condition'),
              branches: { yes: [step('send_message', { text: 'deep' })] },
            },
          ],
        },
      },
    ];
    expect(maxStepDepth(nested)).toBe(3);
  });

  it('reports depth 1 for a flat list', () => {
    expect(maxStepDepth([step('send_message', { text: 'a' })])).toBe(1);
  });

  it('reports zero for an empty tree', () => {
    expect(countSteps([])).toBe(0);
  });
});
