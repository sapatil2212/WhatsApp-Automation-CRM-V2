/**
 * Per-request ambient context, carried on an AsyncLocalStorage store.
 *
 * Why ALS instead of threading a context object through every call: the
 * logger, the tenant guard, and the error handler all need requestId /
 * tenantId / userId, and they sit at opposite ends of the call graph.
 * Passing it explicitly would mean touching every signature in the
 * codebase and would still be bypassable.
 *
 * Node runtime only. Route handlers in this app all touch Prisma, so
 * they already run on the Node runtime — never the Edge runtime.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  /** Route identifier for grouping logs, e.g. `contacts.list`. */
  readonly operation: string;
  readonly startedAt: number;
  userId?: string;
  tenantId?: string;
  /** Filled in once per request so repeated auth resolution is free. */
  authResolved?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(input: {
  operation: string;
  method: string;
  path: string;
  requestId?: string;
}): RequestContext {
  return {
    requestId: input.requestId ?? randomUUID(),
    method: input.method,
    path: input.path,
    operation: input.operation,
    startedAt: Date.now(),
  };
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Attaches identity to the ambient context so every subsequent log line
 * is automatically correlated. Safe to call when no context exists (unit
 * tests, background jobs started outside a request).
 */
export function setRequestIdentity(identity: { userId?: string; tenantId?: string }): void {
  const context = storage.getStore();
  if (!context) return;
  if (identity.userId !== undefined) context.userId = identity.userId;
  if (identity.tenantId !== undefined) context.tenantId = identity.tenantId;
}

export function elapsedMs(): number {
  const context = storage.getStore();
  return context ? Date.now() - context.startedAt : 0;
}

/** Header clients/proxies may set so traces span services. */
export const REQUEST_ID_HEADER = 'x-request-id';
