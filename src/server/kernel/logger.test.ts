import { afterEach, describe, expect, it, vi } from 'vitest';

import { redact, serializeError } from './logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('redact', () => {
  it('masks exact sensitive keys', () => {
    const out = redact({ email: 'a@b.c', password: 'hunter2', passwordHash: '$2b$10$x' }) as Record<string, unknown>;
    expect(out.email).toBe('a@b.c');
    expect(out.password).toBe('[redacted]');
    expect(out.passwordHash).toBe('[redacted]');
  });

  it('masks any key containing token, secret, password, apiKey or credential', () => {
    const out = redact({
      accessToken: 'x',
      refreshToken: 'y',
      metaAppSecret: 'z',
      someFutureApiKeyField: 'k',
      googleDriveCredentials: 'c',
      verifyToken: 'v',
    }) as Record<string, unknown>;
    expect(Object.values(out).every((value) => value === '[redacted]')).toBe(true);
  });

  it('masks nested values, not just the top level', () => {
    const out = redact({ config: { whatsapp: { accessToken: 'secret-token' } } }) as {
      config: { whatsapp: { accessToken: string } };
    };
    expect(out.config.whatsapp.accessToken).toBe('[redacted]');
  });

  it('redacts inside arrays of objects', () => {
    const out = redact([{ accessToken: 'a' }, { accessToken: 'b' }]) as Array<{ accessToken: string }>;
    expect(out.map((entry) => entry.accessToken)).toEqual(['[redacted]', '[redacted]']);
  });

  it('leaves non-sensitive scalars alone', () => {
    expect(redact({ count: 3, active: true, name: null })).toEqual({ count: 3, active: true, name: null });
  });

  it('serialises dates and bigints', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(redact({ at: date })).toEqual({ at: '2026-01-01T00:00:00.000Z' });
    // BigInt(10) rather than a `10n` literal: tsconfig targets ES2017.
    expect(redact({ n: BigInt(10) })).toEqual({ n: '10' });
  });

  it('truncates runaway nesting instead of recursing forever', () => {
    type Deep = { next?: Deep };
    const deep: Deep = {};
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });

  it('caps long arrays', () => {
    const out = redact(Array.from({ length: 500 }, (_, i) => i)) as number[];
    expect(out).toHaveLength(50);
  });
});

describe('serializeError', () => {
  it('captures name, message and stack', () => {
    const serialized = serializeError(new TypeError('bad type'));
    expect(serialized.name).toBe('TypeError');
    expect(serialized.message).toBe('bad type');
    expect(serialized.stack).toBeTypeOf('string');
  });

  it('unwraps the cause chain so the root failure is visible in logs', () => {
    const root = new Error('ECONNREFUSED');
    const wrapper = new Error('could not reach Meta', { cause: root });
    const serialized = serializeError(wrapper);
    expect(typeof serialized.cause === 'object' && serialized.cause?.message).toBe('ECONNREFUSED');
  });

  it('handles non-Error throws', () => {
    expect(serializeError('nope')).toEqual({ name: 'NonError', message: 'nope' });
  });
});
