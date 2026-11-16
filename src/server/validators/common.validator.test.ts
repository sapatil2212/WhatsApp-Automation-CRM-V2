import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  booleanQuerySchema,
  hexColorSchema,
  idListQuerySchema,
  idSchema,
  nonEmptyPatch,
  optionalEmailSchema,
  optionalHttpUrlSchema,
  optionalText,
  phoneSchema,
  requiredText,
  searchSchema,
} from './common.validator';

describe('idSchema', () => {
  it('accepts a uuid', () => {
    expect(idSchema.safeParse('3f2504e0-4f89-11d3-9a0c-0305e82c3301').success).toBe(true);
  });

  it('rejects arbitrary strings, so malformed ids never reach the database', () => {
    expect(idSchema.safeParse('1 OR 1=1').success).toBe(false);
    expect(idSchema.safeParse('').success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('strips formatting to the digits-only form Meta requires', () => {
    expect(phoneSchema.parse('+370 63 949 836')).toBe('37063949836');
    expect(phoneSchema.parse('(91) 98765-43210')).toBe('919876543210');
  });

  it('rejects numbers that could never be sent', () => {
    expect(phoneSchema.safeParse('12345').success).toBe(false);
    expect(phoneSchema.safeParse('not a phone').success).toBe(false);
    expect(phoneSchema.safeParse('').success).toBe(false);
  });

  it('rejects a leading zero country code', () => {
    expect(phoneSchema.safeParse('0123456789').success).toBe(false);
  });

  it('rejects numbers longer than E.164 allows', () => {
    expect(phoneSchema.safeParse('1234567890123456').success).toBe(false);
  });
});

describe('optionalText', () => {
  const schema = optionalText(10);

  it('normalises empty and whitespace-only input to null', () => {
    expect(schema.parse('')).toBeNull();
    expect(schema.parse('   ')).toBeNull();
  });

  it('normalises undefined and null to null, so the wire has one shape', () => {
    expect(schema.parse(undefined)).toBeNull();
    expect(schema.parse(null)).toBeNull();
  });

  it('trims retained values', () => {
    expect(schema.parse('  hi  ')).toBe('hi');
  });

  it('enforces the length cap', () => {
    expect(schema.safeParse('12345678901').success).toBe(false);
  });
});

describe('requiredText', () => {
  it('rejects whitespace-only values', () => {
    expect(requiredText(10, 'Name').safeParse('   ').success).toBe(false);
  });

  it('names the field in the error so the UI can show it verbatim', () => {
    const parsed = requiredText(10, 'Note').safeParse('');
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe('Note is required.');
  });
});

describe('optionalEmailSchema', () => {
  it('lowercases and trims', () => {
    expect(optionalEmailSchema.parse('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('treats empty string as absent', () => {
    expect(optionalEmailSchema.parse('')).toBeNull();
  });

  it('rejects malformed addresses', () => {
    expect(optionalEmailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('optionalHttpUrlSchema', () => {
  it('accepts http and https', () => {
    expect(optionalHttpUrlSchema.parse('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
  });

  it('rejects other schemes, closing a javascript: injection vector', () => {
    expect(optionalHttpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(optionalHttpUrlSchema.safeParse('file:///etc/passwd').success).toBe(false);
  });

  it('treats empty string as absent', () => {
    expect(optionalHttpUrlSchema.parse('')).toBeNull();
  });
});

describe('hexColorSchema', () => {
  it('accepts six-digit hex', () => {
    expect(hexColorSchema.parse('#3b82f6')).toBe('#3b82f6');
  });

  it('rejects shorthand and named colours', () => {
    expect(hexColorSchema.safeParse('#fff').success).toBe(false);
    expect(hexColorSchema.safeParse('red').success).toBe(false);
  });
});

describe('idListQuerySchema', () => {
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  it('parses a comma-separated query value', () => {
    expect(idListQuerySchema.parse(`${uuid},${uuid}`)).toEqual([uuid, uuid]);
  });

  it('accepts a repeated query parameter', () => {
    expect(idListQuerySchema.parse([uuid])).toEqual([uuid]);
  });

  it('treats an empty value as absent rather than an empty filter', () => {
    expect(idListQuerySchema.parse('')).toBeUndefined();
    expect(idListQuerySchema.parse(undefined)).toBeUndefined();
  });

  it('rejects a list containing a non-id', () => {
    expect(idListQuerySchema.safeParse(`${uuid},bogus`).success).toBe(false);
  });
});

describe('booleanQuerySchema', () => {
  it('coerces the string forms a query string can carry', () => {
    expect(booleanQuerySchema.parse('true')).toBe(true);
    expect(booleanQuerySchema.parse('false')).toBe(false);
    expect(booleanQuerySchema.parse(undefined)).toBeUndefined();
  });

  it('rejects anything ambiguous', () => {
    expect(booleanQuerySchema.safeParse('yes').success).toBe(false);
    expect(booleanQuerySchema.safeParse('1').success).toBe(false);
  });
});

describe('searchSchema', () => {
  it('treats blank input as no filter', () => {
    expect(searchSchema.parse('   ')).toBeUndefined();
  });

  it('caps length so search cannot be used as a DoS vector', () => {
    expect(searchSchema.safeParse('x'.repeat(121)).success).toBe(false);
  });
});

describe('nonEmptyPatch', () => {
  const schema = nonEmptyPatch(z.object({ name: z.string().optional(), color: z.string().optional() }));

  it('rejects an empty patch instead of silently succeeding', () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('accepts a single-field patch', () => {
    expect(schema.safeParse({ name: 'x' }).success).toBe(true);
  });
});
