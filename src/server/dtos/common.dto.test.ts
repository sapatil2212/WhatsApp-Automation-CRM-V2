import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  toDateOnly,
  toIso,
  toIsoOrNull,
  toJson,
  toJsonArray,
  toJsonObject,
  toNumber,
  toNumberOrNull,
  toStringArray,
} from './common.dto';

describe('date serialisation', () => {
  it('converts a Date to ISO-8601', () => {
    expect(toIso(new Date('2026-05-22T10:30:00.000Z'))).toBe('2026-05-22T10:30:00.000Z');
  });

  it('passes through an existing ISO string', () => {
    expect(toIso('2026-05-22T10:30:00.000Z')).toBe('2026-05-22T10:30:00.000Z');
  });

  it('maps null and undefined to null', () => {
    expect(toIsoOrNull(null)).toBeNull();
    expect(toIsoOrNull(undefined)).toBeNull();
  });

  it('reduces @db.Date columns to YYYY-MM-DD', () => {
    expect(toDateOnly(new Date('2026-05-22T00:00:00.000Z'))).toBe('2026-05-22');
  });
});

describe('decimal serialisation', () => {
  it('converts a Prisma Decimal to a number, which JSON can represent', () => {
    // A raw Decimal serialises to {} through JSON.stringify — the bug this
    // helper exists to prevent.
    const decimal = new Prisma.Decimal('1499.50');
    expect(JSON.parse(JSON.stringify({ v: decimal })).v).not.toBe(1499.5);
    expect(toNumber(decimal)).toBe(1499.5);
  });

  it('defaults null to 0 for non-nullable money columns', () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined, 7)).toBe(7);
  });

  it('preserves null for nullable money columns', () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(new Prisma.Decimal('0'))).toBe(0);
  });

  it('falls back rather than emitting NaN', () => {
    expect(toNumber({ toString: () => 'not a number' })).toBe(0);
  });
});

describe('json serialisation', () => {
  it('normalises Prisma JSON null sentinels to null', () => {
    expect(toJson(Prisma.DbNull)).toBeNull();
    expect(toJson(Prisma.JsonNull)).toBeNull();
    expect(toJson(undefined)).toBeNull();
  });

  it('round-trips plain objects and arrays', () => {
    expect(toJson({ a: [1, 'two', true, null] })).toEqual({ a: [1, 'two', true, null] });
  });

  it('coerces a non-object into an empty object shape', () => {
    expect(toJsonObject('a string')).toEqual({});
    expect(toJsonObject(null)).toEqual({});
    expect(toJsonObject([1, 2])).toEqual({});
  });

  it('coerces a non-array into an empty array shape', () => {
    expect(toJsonArray({ a: 1 })).toEqual([]);
    expect(toJsonArray(null)).toEqual([]);
  });

  it('filters a mixed JSON array down to strings', () => {
    expect(toStringArray(['a', 1, null, 'b', { c: 1 }])).toEqual(['a', 'b']);
  });

  it('returns an empty array for a null keyword column', () => {
    expect(toStringArray(null)).toEqual([]);
  });
});
