import { describe, expect, it } from 'vitest';

import { buildPaginationMeta, errorBody, successBody } from './api-response';
import { DatabaseError, NotFoundError, ValidationError } from './errors';

describe('response envelope', () => {
  it('always emits all five top-level keys on success', () => {
    const body = successBody({ id: '1' });
    expect(Object.keys(body).sort()).toEqual(['data', 'error', 'message', 'meta', 'success']);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
  });

  it('always emits all five top-level keys on failure', () => {
    const body = errorBody(new NotFoundError('Contact'));
    expect(Object.keys(body).sort()).toEqual(['data', 'error', 'message', 'meta', 'success']);
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
  });

  it('carries requestId, timestamp and duration in meta', () => {
    const body = successBody(null);
    expect(body.meta.requestId).toBeTypeOf('string');
    expect(Number.isNaN(Date.parse(body.meta.timestamp))).toBe(false);
    expect(body.meta.durationMs).toBeTypeOf('number');
  });

  it('surfaces the machine-readable code on errors', () => {
    expect(errorBody(new ValidationError('bad')).error.code).toBe('VALIDATION_ERROR');
    expect(errorBody(new NotFoundError()).error.code).toBe('NOT_FOUND');
  });

  it('includes details for client-fault errors', () => {
    const body = errorBody(new ValidationError('bad', { details: { issues: [] } }));
    expect(body.error.details).toEqual({ issues: [] });
  });

  it('withholds details for non-exposed errors', () => {
    const body = errorBody(new DatabaseError('deadlock', { details: { sql: 'SELECT *' } }));
    expect(body.error.details).toBeUndefined();
    expect(body.message).toBe('An unexpected error occurred.');
  });

  it('omits pagination unless supplied', () => {
    expect(successBody([]).meta.pagination).toBeUndefined();
  });
});

describe('buildPaginationMeta', () => {
  it('computes page counts and neighbours', () => {
    expect(buildPaginationMeta({ page: 2, pageSize: 25, total: 130 })).toEqual({
      page: 2,
      pageSize: 25,
      total: 130,
      totalPages: 6,
      hasNext: true,
      hasPrevious: true,
    });
  });

  it('handles an empty result set', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 25, total: 0 })).toEqual({
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    });
  });

  it('marks the last page as having no next', () => {
    const meta = buildPaginationMeta({ page: 4, pageSize: 10, total: 40 });
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrevious).toBe(true);
  });
});
