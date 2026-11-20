import { describe, expect, it } from 'vitest';

import { normalizePlan, type AssistContext } from '@/lib/ai/campaign-assist';
import {
  buildSendComponents,
  fromStoredVariables,
  renderBody,
  resolveMapping,
  templateSlots,
  toStoredVariables,
  validatePersonalization,
} from './personalization';

const tpl = {
  bodyText: 'Hi {{1}}, enjoy {{2}} off until {{3}}. Hi again {{1}}!',
  headerType: 'text',
  headerContent: 'Offer for {{1}}',
  buttons: [
    { type: 'QUICK_REPLY', text: 'Stop' },
    { type: 'URL', text: 'Shop', url: 'https://shop.example.com/c/{{1}}' },
  ],
};

describe('templateSlots', () => {
  it('lists header, unique body vars in order, and dynamic URL buttons', () => {
    expect(templateSlots(tpl).map((s) => s.key)).toEqual(['header_1', 'body_1', 'body_2', 'body_3', 'button_1']);
  });
  it('detects media headers', () => {
    expect(templateSlots({ bodyText: 'Hello', headerType: 'image' }).map((s) => s.key)).toEqual(['header_media']);
  });
});

describe('resolveMapping', () => {
  const contact = { name: '  Priya   Sharma ', phone: '9199', custom: { f1: 'Gold' } };
  it('resolves contact fields, first names and custom fields', () => {
    expect(resolveMapping({ source: 'first_name', fallback: 'there' }, contact)).toBe('Priya');
    expect(resolveMapping({ source: 'custom_field', value: 'f1', fallback: '-' }, contact)).toBe('Gold');
  });
  it('falls back when data is missing and strips newlines', () => {
    expect(resolveMapping({ source: 'email', fallback: 'n/a' }, contact)).toBe('n/a');
    expect(resolveMapping({ source: 'static', value: 'a\nb' }, contact)).toBe('a b');
  });
});

describe('validatePersonalization', () => {
  const slots = templateSlots(tpl);
  it('requires a value or fallback for every slot', () => {
    const issues = validatePersonalization(slots, {
      header_1: { source: 'first_name' },
      body_1: { source: 'first_name', fallback: 'there' },
      body_2: { source: 'static', value: '20%' },
    });
    expect(issues.map((i) => i.key)).toEqual(['header_1', 'body_3', 'button_1']);
  });
});

describe('buildSendComponents', () => {
  it('builds header, body and button parameters for one contact', () => {
    const p = {
      header_1: { source: 'first_name' as const, fallback: 'you' },
      body_1: { source: 'first_name' as const, fallback: 'there' },
      body_2: { source: 'static' as const, value: '20%' },
      body_3: { source: 'static' as const, value: '5 Nov' },
      button_1: { source: 'static' as const, value: 'DIWALI' },
    };
    expect(buildSendComponents(tpl, p, { name: null })).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'you' }] },
      { type: 'body', parameters: [{ type: 'text', text: 'there' }, { type: 'text', text: '20%' }, { type: 'text', text: '5 Nov' }] },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'DIWALI' }] },
    ]);
    expect(renderBody(tpl, p, { name: 'Asha K' })).toBe('Hi Asha, enjoy 20% off until 5 Nov. Hi again Asha!');
  });
  it('sends media headers as links', () => {
    const c = buildSendComponents({ bodyText: 'Hi', headerType: 'image' }, { header_media: { source: 'static', value: 'https://x.io/a.png' } }, {});
    expect(c[0]).toEqual({ type: 'header', parameters: [{ type: 'image', image: { link: 'https://x.io/a.png' } }] });
  });
});

describe('stored variables', () => {
  it('round-trips and stays readable by legacy readers', () => {
    const slots = templateSlots(tpl);
    const p = { body_1: { source: 'first_name' as const, fallback: 'there' }, body_2: { source: 'static' as const, value: '20%' } };
    const stored = toStoredVariables(slots, p);
    expect(stored['1']).toBe('there');
    expect(stored['2']).toBe('20%');
    expect(fromStoredVariables(stored)).toEqual(p);
    expect(fromStoredVariables({ '1': 'Asha' })).toEqual({ body_1: { source: 'static', value: 'Asha' } });
  });
});

describe('normalizePlan', () => {
  const ctx: AssistContext = {
    templates: [{ id: 't1', name: 'sale', language: 'en', category: 'Marketing', headerType: 'none', headerContent: null, bodyText: 'Hi {{1}}, {{2}} off!', footerText: null, buttons: [] }],
    tags: [{ id: 'g1', name: 'VIP', contactCount: 10 }, { id: 'g2', name: 'Unsubscribed', contactCount: 3 }],
    customFields: [],
    totalContacts: 100,
    now: new Date().toISOString(),
    timezone: 'UTC',
  };
  it('keeps only real ids and repairs mappings', () => {
    const plan = normalizePlan({
      name: 'Sale',
      templateId: 't1',
      audience: { type: 'tags', tagIds: ['g1', 'nope'], excludeTagIds: ['g2', 'g1'] },
      personalization: { body_1: { source: 'first_name' }, body_2: { source: 'custom_field', value: 'missing', fallback: '20%' } },
      schedule: { mode: 'later', at: '2000-01-01T00:00:00Z' },
    }, ctx)!;
    expect(plan.audience).toMatchObject({ type: 'tags', tagIds: ['g1'], excludeTagIds: ['g2'] });
    expect(plan.personalization.body_1).toEqual({ source: 'first_name', fallback: 'there' });
    expect(plan.personalization.body_2).toEqual({ source: 'static', value: '20%' });
    expect(plan.schedule).toMatchObject({ mode: 'now', at: null });
  });
  it('asks for a new template when the id is unknown', () => {
    const plan = normalizePlan({ templateId: 'zzz', newTemplateBrief: 'A shipping update' }, ctx)!;
    expect(plan.templateId).toBeNull();
    expect(plan.newTemplateBrief).toBe('A shipping update');
  });
});
