/**
 * Controller helpers.
 *
 * A controller's whole job is: take validated input, call one service, shape
 * the result for the envelope. These two helpers cover the parts every
 * controller would otherwise repeat.
 *
 * Nothing here performs I/O, reads cookies, or touches Prisma — that is what
 * keeps `createHandler` the only place HTTP concerns live.
 */

import { HandlerResult, buildPaginationMeta, result, type Page } from '../kernel';

/**
 * Lifts a `Page<T>` into the envelope: items become `data`, and the counts
 * become `meta.pagination`. Clients therefore never have to guess whether a
 * list response is `{items}`, `{data}`, or a bare array — which the previous
 * API did all three of.
 */
export function paged<T>(page: Page<T>, message?: string): HandlerResult<T[]> {
  return result(page.items, {
    message,
    pagination: buildPaginationMeta({
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    }),
  });
}

/** `204`-style success for deletes, which have nothing meaningful to return. */
export function deleted(message: string): HandlerResult<{ deleted: true }> {
  return result({ deleted: true } as const, { message });
}
