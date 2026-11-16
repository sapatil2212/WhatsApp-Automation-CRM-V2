import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ConflictError,
  DatabaseError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from './errors';
import { normalizeError, toFieldIssues } from './normalize-error';

function prismaKnownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
    meta,
  });
}

describe('normalizeError', () => {
  it('passes AppError instances through untouched', () => {
    const original = new ForbiddenError('nope');
    expect(normalizeError(original)).toBe(original);
  });

  it('maps a ZodError to a ValidationError with field issues', () => {
    const schema = z.object({ phone: z.string().min(5), age: z.number() });
    const parsed = schema.safeParse({ phone: 'ab' });
    expect(parsed.success).toBe(false);

    const error = normalizeError(parsed.success ? null : parsed.error);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.status).toBe(400);
    const details = error.details as { issues: Array<{ path: string }> };
    expect(details.issues.map((issue) => issue.path).sort()).toEqual(['age', 'phone']);
  });

  it('maps P2002 unique violations to 409 with the conflicting fields', () => {
    const error = normalizeError(prismaKnownError('P2002', { target: ['tenantId', 'phone'] }));
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.status).toBe(409);
    expect(error.details).toEqual({ fields: ['tenantId', 'phone'] });
    expect(error.clientMessage()).toContain('tenantId, phone');
  });

  it('maps P2025 missing-record to a 404', () => {
    const error = normalizeError(prismaKnownError('P2025'));
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.status).toBe(404);
  });

  it('maps P2003 foreign-key failures to a 400', () => {
    const error = normalizeError(prismaKnownError('P2003', { field_name: 'contactId' }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.details).toEqual({ field: 'contactId' });
  });

  it('maps P2000 over-length values to a 400', () => {
    const error = normalizeError(prismaKnownError('P2000', { column_name: 'bodyText' }));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('maps unrecognised Prisma codes to a non-exposed DatabaseError', () => {
    const error = normalizeError(prismaKnownError('P1001'));
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.status).toBe(500);
    expect(error.expose).toBe(false);
    expect(error.clientMessage()).toBe('An unexpected error occurred.');
  });

  it('maps Prisma validation errors to DatabaseError, never leaking the query', () => {
    const error = normalizeError(
      new Prisma.PrismaClientValidationError('Unknown argument `whatsappMessageId`', { clientVersion: 'test' }),
    );
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.clientMessage()).not.toContain('whatsappMessageId');
  });

  it('wraps plain Errors as non-exposed InternalError but keeps the cause for logs', () => {
    const cause = new Error('socket hang up');
    const error = normalizeError(cause);
    expect(error).toBeInstanceOf(InternalError);
    expect(error.expose).toBe(false);
    expect(error.message).toBe('socket hang up');
    expect(error.clientMessage()).toBe('An unexpected error occurred.');
    expect((error as { cause?: unknown }).cause).toBe(cause);
  });

  it('handles non-Error throws', () => {
    const error = normalizeError('just a string');
    expect(error).toBeInstanceOf(InternalError);
  });
});

describe('error taxonomy', () => {
  it('never exposes internal or database messages', () => {
    expect(new InternalError('table users does not exist').clientMessage()).toBe('An unexpected error occurred.');
    expect(new DatabaseError('deadlock on shard 3').clientMessage()).toBe('An unexpected error occurred.');
  });

  it('exposes client-fault messages so the UI can render them', () => {
    expect(new ValidationError('phone is required').clientMessage()).toBe('phone is required');
    expect(new ForbiddenError('agents cannot send broadcasts').clientMessage()).toBe(
      'agents cannot send broadcasts',
    );
  });

  it('makes NotFound indistinguishable from cross-tenant access', () => {
    expect(new NotFoundError('Contact').clientMessage()).toBe('Contact not found.');
  });

  it('carries a retry hint on rate limits', () => {
    const error = new RateLimitError(42);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(42);
  });
});

describe('toFieldIssues', () => {
  it('labels root-level issues explicitly', () => {
    const parsed = z.string().safeParse(123);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(toFieldIssues(parsed.error)[0].path).toBe('(root)');
  });

  it('joins nested paths with dots', () => {
    const schema = z.object({ audience: z.object({ tagIds: z.array(z.string()) }) });
    const parsed = schema.safeParse({ audience: { tagIds: [1] } });
    if (parsed.success) throw new Error('expected failure');
    expect(toFieldIssues(parsed.error)[0].path).toBe('audience.tagIds.0');
  });
});
