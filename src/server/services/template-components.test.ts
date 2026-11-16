import { describe, expect, it } from 'vitest';

import { ValidationError } from '../kernel';
import {
  assertParamCount,
  assertValidTemplateName,
  buildTemplateComponents,
  normalizeTemplateName,
  placeholderCount,
  toLocalCategory,
  toLocalStatus,
  toMetaCategory,
  type TemplateDefinition,
} from './template-components';

function definition(overrides: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    name: 'order_update',
    category: 'Utility',
    language: 'en_US',
    headerType: 'none',
    bodyText: 'Your order is ready.',
    ...overrides,
  };
}

describe('normalizeTemplateName', () => {
  it('lowercases and underscores whitespace, rather than rejecting a natural name', () => {
    expect(normalizeTemplateName('  Order Update  ')).toBe('order_update');
    expect(normalizeTemplateName('Order   Update')).toBe('order_update');
  });
});

describe('assertValidTemplateName', () => {
  it('accepts Meta-legal names', () => {
    expect(() => assertValidTemplateName('order_update_2')).not.toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => assertValidTemplateName('')).toThrow(ValidationError);
  });

  it('rejects characters Meta will not accept', () => {
    expect(() => assertValidTemplateName('order-update')).toThrow(ValidationError);
    expect(() => assertValidTemplateName('OrderUpdate')).toThrow(ValidationError);
  });
});

describe('placeholderCount', () => {
  it('reports zero for a template with no variables', () => {
    expect(placeholderCount('Hello there')).toEqual({ max: 0, gapFree: true });
  });

  it('reports the highest index and gap-free numbering', () => {
    expect(placeholderCount('Hi {{1}}, order {{2}} ships {{3}}')).toEqual({ max: 3, gapFree: true });
  });

  it('detects a gap, which Meta rejects', () => {
    expect(placeholderCount('Hi {{1}}, ref {{3}}')).toEqual({ max: 3, gapFree: false });
  });

  it('detects numbering that does not start at 1', () => {
    expect(placeholderCount('Ref {{2}}')).toEqual({ max: 2, gapFree: false });
  });

  it('tolerates internal whitespace and repeated use of one variable', () => {
    expect(placeholderCount('{{ 1 }} and {{1}}')).toEqual({ max: 1, gapFree: true });
  });
});

describe('category and status mapping', () => {
  it('maps local categories to Meta and back', () => {
    expect(toMetaCategory('Utility')).toBe('UTILITY');
    expect(toMetaCategory('Authentication')).toBe('AUTHENTICATION');
    expect(toMetaCategory('anything else')).toBe('MARKETING');
    expect(toLocalCategory('UTILITY')).toBe('Utility');
    expect(toLocalCategory('MARKETING')).toBe('Marketing');
  });

  it('collapses every unsendable Meta status onto Rejected', () => {
    expect(toLocalStatus('APPROVED')).toBe('Approved');
    expect(toLocalStatus('REJECTED')).toBe('Rejected');
    expect(toLocalStatus('DISABLED')).toBe('Rejected');
    expect(toLocalStatus('PAUSED')).toBe('Rejected');
  });

  it('treats unknown or in-flight states as Pending', () => {
    expect(toLocalStatus('PENDING')).toBe('Pending');
    expect(toLocalStatus('IN_APPEAL')).toBe('Pending');
    expect(toLocalStatus('SOMETHING_NEW')).toBe('Pending');
  });
});

describe('buildTemplateComponents — body', () => {
  it('builds a minimal body-only template', () => {
    const built = buildTemplateComponents(definition());
    expect(built.components).toEqual([{ type: 'BODY', text: 'Your order is ready.' }]);
    expect(built.localButtons).toBeNull();
  });

  it('rejects an empty body', () => {
    expect(() => buildTemplateComponents(definition({ bodyText: '   ' }))).toThrow(ValidationError);
  });

  it('rejects a body over Meta’s length limit', () => {
    expect(() => buildTemplateComponents(definition({ bodyText: 'x'.repeat(2000) }))).toThrow(ValidationError);
  });

  it('rejects gapped body variables', () => {
    expect(() =>
      buildTemplateComponents(definition({ bodyText: 'Hi {{1}} ref {{3}}', bodyExample: ['a', 'b', 'c'] })),
    ).toThrow(ValidationError);
  });

  it('requires a sample for every body variable', () => {
    expect(() =>
      buildTemplateComponents(definition({ bodyText: 'Hi {{1}} and {{2}}', bodyExample: ['only-one'] })),
    ).toThrow(ValidationError);
  });

  it('rejects a blank sample', () => {
    expect(() =>
      buildTemplateComponents(definition({ bodyText: 'Hi {{1}}', bodyExample: ['  '] })),
    ).toThrow(ValidationError);
  });

  it('attaches samples in Meta’s nested array shape', () => {
    const built = buildTemplateComponents(
      definition({ bodyText: 'Hi {{1}}, ref {{2}}', bodyExample: ['Asha', 'A-1'] }),
    );
    expect(built.components[0]).toEqual({
      type: 'BODY',
      text: 'Hi {{1}}, ref {{2}}',
      example: { body_text: [['Asha', 'A-1']] },
    });
  });

  it('trims surplus samples down to the variable count', () => {
    const built = buildTemplateComponents(
      definition({ bodyText: 'Hi {{1}}', bodyExample: ['Asha', 'extra'] }),
    );
    expect(built.components[0]).toMatchObject({ example: { body_text: [['Asha']] } });
  });
});

describe('buildTemplateComponents — header', () => {
  it('builds a plain text header', () => {
    const built = buildTemplateComponents(definition({ headerType: 'text', headerText: 'Order update' }));
    expect(built.components[0]).toEqual({ type: 'HEADER', format: 'TEXT', text: 'Order update' });
  });

  it('rejects a text header with no text', () => {
    expect(() => buildTemplateComponents(definition({ headerType: 'text', headerText: '' }))).toThrow(
      ValidationError,
    );
  });

  it('allows exactly one header variable', () => {
    const built = buildTemplateComponents(
      definition({ headerType: 'text', headerText: 'Order {{1}}', headerTextExample: ['A-1'] }),
    );
    expect(built.components[0]).toMatchObject({ example: { header_text: ['A-1'] } });
  });

  it('rejects two header variables', () => {
    expect(() =>
      buildTemplateComponents(
        definition({ headerType: 'text', headerText: '{{1}} {{2}}', headerTextExample: ['a'] }),
      ),
    ).toThrow(ValidationError);
  });

  it('requires a sample for a header variable', () => {
    expect(() =>
      buildTemplateComponents(definition({ headerType: 'text', headerText: 'Order {{1}}' })),
    ).toThrow(ValidationError);
  });

  it('requires a sample media URL for a media header', () => {
    expect(() => buildTemplateComponents(definition({ headerType: 'image' }))).toThrow(ValidationError);
  });

  it('builds a media header with the sample handle', () => {
    const built = buildTemplateComponents(
      definition({ headerType: 'document', headerExample: 'https://cdn.example.com/a.pdf' }),
    );
    expect(built.components[0]).toEqual({
      type: 'HEADER',
      format: 'DOCUMENT',
      example: { header_handle: ['https://cdn.example.com/a.pdf'] },
    });
  });
});

describe('buildTemplateComponents — footer and buttons', () => {
  it('appends a footer when present', () => {
    const built = buildTemplateComponents(definition({ footerText: 'Reply STOP to opt out' }));
    expect(built.components.at(-1)).toEqual({ type: 'FOOTER', text: 'Reply STOP to opt out' });
  });

  it('omits an empty footer rather than sending a blank component', () => {
    const built = buildTemplateComponents(definition({ footerText: '   ' }));
    expect(built.components.some((component) => component.type === 'FOOTER')).toBe(false);
  });

  it('builds quick-reply buttons', () => {
    const built = buildTemplateComponents(
      definition({ buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }, { type: 'QUICK_REPLY', text: 'No' }] }),
    );
    expect(built.localButtons).toEqual([
      { type: 'QUICK_REPLY', text: 'Yes' },
      { type: 'QUICK_REPLY', text: 'No' },
    ]);
  });

  it('ignores buttons with no text instead of sending an invalid payload', () => {
    const built = buildTemplateComponents(
      definition({ buttons: [{ type: 'QUICK_REPLY', text: '  ' }] }),
    );
    expect(built.localButtons).toBeNull();
  });

  it('rejects a URL button with no link', () => {
    expect(() =>
      buildTemplateComponents(definition({ buttons: [{ type: 'URL', text: 'Track', url: '' }] })),
    ).toThrow(ValidationError);
  });

  it('rejects a non-http URL button, closing a javascript: vector', () => {
    expect(() =>
      buildTemplateComponents(
        definition({ buttons: [{ type: 'URL', text: 'Track', url: 'javascript:alert(1)' }] }),
      ),
    ).toThrow(ValidationError);
  });

  it('requires a sample suffix for a dynamic URL button', () => {
    expect(() =>
      buildTemplateComponents(
        definition({ buttons: [{ type: 'URL', text: 'Track', url: 'https://x.com/{{1}}' }] }),
      ),
    ).toThrow(ValidationError);
  });

  it('accepts a dynamic URL button with a sample', () => {
    const built = buildTemplateComponents(
      definition({
        buttons: [{ type: 'URL', text: 'Track', url: 'https://x.com/{{1}}', example: 'abc123' }],
      }),
    );
    expect(built.localButtons?.[0]).toEqual({
      type: 'URL',
      text: 'Track',
      url: 'https://x.com/{{1}}',
      example: ['abc123'],
    });
  });

  it('rejects a call button without a valid E.164 number', () => {
    expect(() =>
      buildTemplateComponents(
        definition({ buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phoneNumber: '12345' }] }),
      ),
    ).toThrow(ValidationError);
  });

  it('accepts a valid call button', () => {
    const built = buildTemplateComponents(
      definition({ buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phoneNumber: '+919876543210' }] }),
    );
    expect(built.localButtons?.[0]).toEqual({
      type: 'PHONE_NUMBER',
      text: 'Call',
      phone_number: '+919876543210',
    });
  });

  it('rejects more than one call button', () => {
    expect(() =>
      buildTemplateComponents(
        definition({
          buttons: [
            { type: 'PHONE_NUMBER', text: 'Call A', phoneNumber: '+919876543210' },
            { type: 'PHONE_NUMBER', text: 'Call B', phoneNumber: '+919876543211' },
          ],
        }),
      ),
    ).toThrow(ValidationError);
  });

  it('rejects over-long button text', () => {
    expect(() =>
      buildTemplateComponents(definition({ buttons: [{ type: 'QUICK_REPLY', text: 'x'.repeat(40) }] })),
    ).toThrow(ValidationError);
  });

  it('orders components header, body, footer, buttons', () => {
    const built = buildTemplateComponents(
      definition({
        headerType: 'text',
        headerText: 'Hi',
        footerText: 'Bye',
        buttons: [{ type: 'QUICK_REPLY', text: 'Ok' }],
      }),
    );
    expect(built.components.map((component) => component.type)).toEqual([
      'HEADER',
      'BODY',
      'FOOTER',
      'BUTTONS',
    ]);
  });
});

describe('assertParamCount', () => {
  it('accepts an exact match', () => {
    expect(() => assertParamCount('Hi {{1}} ref {{2}}', ['a', 'b'])).not.toThrow();
  });

  it('rejects too few values, before Meta returns #132000', () => {
    expect(() => assertParamCount('Hi {{1}} ref {{2}}', ['a'])).toThrow(ValidationError);
  });

  it('allows surplus values, which Meta ignores', () => {
    expect(() => assertParamCount('Hi {{1}}', ['a', 'b'])).not.toThrow();
  });

  it('accepts an empty list for a template with no variables', () => {
    expect(() => assertParamCount('No variables here', [])).not.toThrow();
  });
});
