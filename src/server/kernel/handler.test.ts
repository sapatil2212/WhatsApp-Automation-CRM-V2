import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { ApiBody } from './api-response';
import { ConflictError, ForbiddenError } from './errors';
import { createHandler, result } from './handler';
import { REQUEST_ID_HEADER } from './request-context';

// `cookies()` throws outside a Next request scope, which would turn every
// auth assertion into a 500 and hide what we are actually testing. An
// empty cookie jar is the "anonymous caller" case.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

function request(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

async function call(handler: (req: NextRequest, ctx?: never) => Promise<Response>, req: NextRequest) {
  const response = await handler(req, undefined as never);
  const body = (await response.json()) as ApiBody<unknown>;
  return { response, body };
}

describe('createHandler — success path', () => {
  const handler = createHandler({
    operation: 'test.echo',
    auth: 'public',
    response: z.object({ echoed: z.string() }),
    handle: async () => ({ echoed: 'hi' }),
  });

  it('wraps the payload in the standard envelope', async () => {
    const { response, body } = await call(handler, request('/api/test'));
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, message: 'OK', data: { echoed: 'hi' }, error: null });
  });

  it('sets no-store so API responses are never edge-cached', async () => {
    const { response } = await call(handler, request('/api/test'));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('propagates an inbound x-request-id for distributed tracing', async () => {
    const { response, body } = await call(
      handler,
      request('/api/test', { headers: { [REQUEST_ID_HEADER]: 'trace-abc' } }),
    );
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('trace-abc');
    expect(body.meta.requestId).toBe('trace-abc');
  });

  it('generates a requestId when none is supplied', async () => {
    const { body } = await call(handler, request('/api/test'));
    expect(body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('honours per-call message, status and pagination overrides', async () => {
    const paged = createHandler({
      operation: 'test.paged',
      auth: 'public',
      response: z.array(z.string()),
      handle: async () =>
        result(['a'], {
          message: 'Contacts retrieved.',
          status: 201,
          pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1, hasNext: false, hasPrevious: false },
        }),
    });
    const { response, body } = await call(paged, request('/api/test'));
    expect(response.status).toBe(201);
    expect(body.message).toBe('Contacts retrieved.');
    expect(body.meta.pagination?.total).toBe(1);
  });
});

describe('createHandler — request validation', () => {
  const handler = createHandler({
    operation: 'test.validate',
    auth: 'public',
    query: z.object({ page: z.coerce.number().int().min(1) }),
    body: z.object({ name: z.string().min(2) }),
    response: z.object({ ok: z.literal(true) }),
    handle: async () => ({ ok: true as const }),
  });

  it('rejects an invalid body with 400 and field-level issues', async () => {
    const { response, body } = await call(
      handler,
      request('/api/test?page=1', { method: 'POST', body: { name: 'x' } }),
    );
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Invalid request body.');
    const details = body.error?.details as { issues: Array<{ path: string }> };
    expect(details.issues[0].path).toBe('name');
  });

  it('rejects invalid query parameters', async () => {
    const { response, body } = await call(
      handler,
      request('/api/test?page=0', { method: 'POST', body: { name: 'ok' } }),
    );
    expect(response.status).toBe(400);
    expect(body.message).toBe('Invalid query parameters.');
  });

  it('rejects a malformed JSON body without throwing a 500', async () => {
    const req = new NextRequest(new URL('/api/test?page=1', 'http://localhost'), {
      method: 'POST',
      body: '{not json',
      headers: { 'content-type': 'application/json' },
    });
    const { response, body } = await call(handler, req);
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('coerces validated query values before the handler sees them', async () => {
    const typed = createHandler({
      operation: 'test.coerce',
      auth: 'public',
      query: z.object({ page: z.coerce.number() }),
      response: z.object({ page: z.number() }),
      handle: async ({ query }) => ({ page: query.page }),
    });
    const { body } = await call(typed, request('/api/test?page=7'));
    expect((body.data as { page: number }).page).toBe(7);
  });
});

describe('createHandler — response contract', () => {
  it('strips fields absent from the response DTO, so a leak cannot ship', async () => {
    const handler = createHandler({
      operation: 'test.leak',
      auth: 'public',
      response: z.object({ id: z.string(), email: z.string() }),
      handle: async () => ({ id: '1', email: 'a@b.c', passwordHash: '$2b$10$leak' }) as never,
    });
    const { body } = await call(handler, request('/api/test'));
    expect(body.data).toEqual({ id: '1', email: 'a@b.c' });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('fails closed with a 500 when the handler violates its own DTO', async () => {
    const handler = createHandler({
      operation: 'test.contract',
      auth: 'public',
      response: z.object({ count: z.number() }),
      handle: async () => ({ count: 'not-a-number' }) as never,
    });
    const { response, body } = await call(handler, request('/api/test'));
    expect(response.status).toBe(500);
    expect(body.error?.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('An unexpected error occurred.');
  });
});

describe('createHandler — global error handling', () => {
  it('maps a thrown AppError to its status and code', async () => {
    const handler = createHandler({
      operation: 'test.forbidden',
      auth: 'public',
      response: z.null(),
      handle: async () => {
        throw new ForbiddenError('agents cannot send broadcasts');
      },
    });
    const { response, body } = await call(handler, request('/api/test'));
    expect(response.status).toBe(403);
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(body.message).toBe('agents cannot send broadcasts');
  });

  it('maps an unexpected throw to a 500 without leaking the message', async () => {
    const handler = createHandler({
      operation: 'test.boom',
      auth: 'public',
      response: z.null(),
      handle: async () => {
        throw new Error('connection string postgres://user:pw@host');
      },
    });
    const { response, body } = await call(handler, request('/api/test'));
    expect(response.status).toBe(500);
    expect(body.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('postgres://');
  });

  it('keeps the envelope shape on failure', async () => {
    const handler = createHandler({
      operation: 'test.conflict',
      auth: 'public',
      response: z.null(),
      handle: async () => {
        throw new ConflictError('duplicate phone');
      },
    });
    const { body } = await call(handler, request('/api/test'));
    expect(Object.keys(body).sort()).toEqual(['data', 'error', 'message', 'meta', 'success']);
    expect(body.data).toBeNull();
    expect(body.meta.requestId).toBeTypeOf('string');
  });

  it('rejects unauthenticated callers on tenant routes', async () => {
    const handler = createHandler({
      operation: 'test.tenant',
      auth: 'tenant',
      response: z.null(),
      handle: async () => null,
    });
    const { response, body } = await call(handler, request('/api/test'));
    expect(response.status).toBe(401);
    expect(body.error?.code).toBe('UNAUTHENTICATED');
  });

  it('rejects cron routes without the shared secret', async () => {
    const handler = createHandler({
      operation: 'test.cron',
      auth: 'cron',
      response: z.null(),
      handle: async () => null,
    });
    const { response } = await call(handler, request('/api/test'));
    // 500 when the secret is unconfigured, 401 when supplied and wrong —
    // either way the handler body never runs.
    expect([401, 500]).toContain(response.status);
  });
});
