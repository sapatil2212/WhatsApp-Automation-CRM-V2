import { describe, expect, it } from 'vitest';

import { normalizeDraft } from '@/lib/ai/template-draft';
import { buildComponents } from './template-payload';
import {
  DEFAULT_AUTH_OPTIONS,
  normalizeTemplateName,
  renumberPlaceholders,
  urlButtonExample,
  validateTemplate,
  type TemplateDraft,
} from './template-rules';

const base: TemplateDraft = {
  name: 'order_shipped',
  category: 'Utility',
  language: 'en_US',
  header_type: 'none',
  header_text: '',
  header_example: '',
  header_text_example: '',
  body_text: 'Hi {{1}}, your order {{2}} has shipped and will arrive soon.',
  body_example: ['Priya', 'ORD-1'],
  footer_text: '',
  buttons: [],
};
const ids = (t: TemplateDraft) => validateTemplate(t).map((i) => i.id);

describe('validateTemplate', () => {
  it('accepts a valid utility template', () => {
    expect(validateTemplate(base).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags missing samples, gaps and edge variables', () => {
    expect(ids({ ...base, body_example: ['Priya'] })).toContain('VAR_EXAMPLES');
    expect(ids({ ...base, body_text: 'Hi {{1}}, order {{3}} shipped today.' })).toContain('VAR_SEQUENCE');
    expect(ids({ ...base, body_text: '{{1}} your order shipped', body_example: ['x'] })).toContain('VAR_EDGES');
    expect(ids({ ...base, body_text: 'Your order shipped {{1}}.', body_example: ['x'] })).toContain('VAR_EDGES');
  });

  it('rejects emoji in header and button labels', () => {
    expect(ids({ ...base, header_type: 'text', header_text: 'Shipped 📦' })).toContain('HEADER_EMOJI');
    expect(ids({ ...base, buttons: [{ type: 'QUICK_REPLY', text: 'Yes 👍' }] })).toContain('BTN_0_FMT');
  });

  it('validates URL and phone buttons and grouping', () => {
    expect(ids({ ...base, buttons: [{ type: 'URL', text: 'Track', url: 'http://x.com' }] })).toContain('BTN_0_URL');
    expect(ids({ ...base, buttons: [{ type: 'URL', text: 'Track', url: 'https://x.com/{{1}}/a' }] })).toContain('BTN_0_URLVAR');
    expect(ids({ ...base, buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phone_number: '98765' }] })).toContain('BTN_0_PHONE');
    expect(
      ids({
        ...base,
        buttons: [
          { type: 'QUICK_REPLY', text: 'A' },
          { type: 'URL', text: 'B', url: 'https://x.com' },
          { type: 'QUICK_REPLY', text: 'C' },
        ],
      }),
    ).toContain('BTN_GROUPING');
  });

  it('authentication templates only validate OTP options', () => {
    expect(validateTemplate({ ...base, category: 'Authentication', body_text: '', auth: DEFAULT_AUTH_OPTIONS })).toEqual([]);
  });
});

describe('helpers', () => {
  it('normalizes names', () => {
    expect(normalizeTemplateName('Order Shipped! (v2)')).toBe('order_shipped_v2');
  });
  it('renumbers placeholders in order of appearance', () => {
    expect(renumberPlaceholders('A {{3}} B {{1}} C {{3}}', ['one', '', 'three'])).toEqual({
      text: 'A {{1}} B {{2}} C {{1}}',
      examples: ['three', 'one'],
    });
  });
  it('builds full sample URLs for dynamic buttons', () => {
    expect(urlButtonExample('https://x.com/t/{{1}}', 'ABC')).toBe('https://x.com/t/ABC');
    expect(urlButtonExample('https://x.com/t/{{1}}', 'https://x.com/t/Z')).toBe('https://x.com/t/Z');
  });
});

describe('buildComponents', () => {
  it('builds Meta authentication payload', () => {
    const { components } = buildComponents({ ...base, category: 'Authentication', auth: DEFAULT_AUTH_OPTIONS });
    expect(components).toEqual([
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 10 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
    ]);
  });
  it('adds body examples and URL example', () => {
    const { components } = buildComponents({
      ...base,
      buttons: [{ type: 'URL', text: 'Track', url: 'https://x.com/t/{{1}}', example: 'ORD-1' }],
    });
    expect(components[0]).toEqual({ type: 'BODY', text: base.body_text, example: { body_text: [['Priya', 'ORD-1']] } });
    expect(components[1]).toEqual({
      type: 'BUTTONS',
      buttons: [{ type: 'URL', text: 'Track', url: 'https://x.com/t/{{1}}', example: ['https://x.com/t/ORD-1'] }],
    });
  });
});

describe('normalizeDraft (AI output)', () => {
  const req = { description: 'order shipped', category: 'auto' as const, language: 'en_US' };
  it('repairs typical model output', () => {
    const d = normalizeDraft(
      {
        name: 'Order Shipped',
        category: 'UTILITY',
        header_type: 'text',
        header_text: 'Order Shipped 📦',
        body_text: 'Hi {{2}}, order {{1}} shipped.',
        body_example: ['ORD-1', 'Priya'],
        footer_text: '',
        buttons: [
          { type: 'URL', text: 'Track 🚚', url: 'http://insecure.com' },
          { type: 'QUICK_REPLY', text: 'Thanks', url: '' },
          { type: 'QUICK_REPLY', text: '' },
        ],
      },
      req,
    )!;
    expect(d.name).toBe('order_shipped');
    expect(d.category).toBe('Utility');
    expect(d.header_text).toBe('Order Shipped');
    expect(d.body_text).toBe('Hi {{1}}, order {{2}} shipped.');
    expect(d.body_example).toEqual(['Priya', 'ORD-1']);
    expect(d.buttons).toEqual([{ type: 'QUICK_REPLY', text: 'Thanks' }]);
  });
  it('drops variable-free body examples like [""]', () => {
    const d = normalizeDraft({ name: 'x', category: 'Marketing', body_text: 'Big sale this weekend!', body_example: [''] }, req)!;
    expect(d.body_example).toEqual([]);
  });
});
