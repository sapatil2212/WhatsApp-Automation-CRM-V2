import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, paginationQuerySchema, toPage, toPageBounds } from './pagination';

describe('paginationQuerySchema', () => {
  it('applies defaults when the client sends nothing', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('coerces string query values', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '10' })).toEqual({ page: 3, pageSize: 10 });
  });

  it('refuses a page size above the ceiling, so a client cannot request the whole table', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
  });

  it('refuses non-positive pages', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '-1' }).success).toBe(false);
  });

  it('refuses fractional pages', () => {
    expect(paginationQuerySchema.safeParse({ page: '1.5' }).success).toBe(false);
  });
});

describe('toPageBounds', () => {
  it('maps page 1 to a zero offset', () => {
    expect(toPageBounds({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
  });

  it('maps later pages to the right offset', () => {
    expect(toPageBounds({ page: 4, pageSize: 10 })).toEqual({ skip: 30, take: 10 });
  });
});

describe('toPage', () => {
  it('carries the query back so the controller can build meta', () => {
    expect(toPage(['a', 'b'], 42, { page: 2, pageSize: 2 })).toEqual({
      items: ['a', 'b'],
      total: 42,
      page: 2,
      pageSize: 2,
    });
  });
});
