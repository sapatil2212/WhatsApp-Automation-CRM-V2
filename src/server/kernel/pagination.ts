/**
 * One pagination contract for the whole API.
 *
 * Offset pagination with a hard page-size ceiling. The old code had three
 * different schemes (`range(from,to)`, `limit`, and unbounded reads that
 * pulled entire tables into browser memory); this replaces all of them.
 */

import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PageBounds {
  skip: number;
  take: number;
}

export function toPageBounds(query: PaginationQuery): PageBounds {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function toPage<T>(items: T[], total: number, query: PaginationQuery): Page<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** Sort direction, shared by every list endpoint. */
export const sortDirectionSchema = z.enum(['asc', 'desc']).default('desc');
export type SortDirection = z.infer<typeof sortDirectionSchema>;
