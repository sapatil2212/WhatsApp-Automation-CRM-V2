/**
 * Route handler factory — the single entry point for every API route.
 *
 * Responsibilities, in order:
 *   1. Establish the ambient request context (requestId, operation).
 *   2. Resolve + enforce the auth mode.
 *   3. Validate params / query / body with Zod. Nothing reaches a service
 *      un-parsed.
 *   4. Invoke the controller.
 *   5. Validate the result against the response DTO. Because Zod object
 *      schemas strip unknown keys, the DTO doubles as a serialisation
 *      allowlist — a service that accidentally returns a `passwordHash`
 *      cannot leak it.
 *   6. Wrap in the standard envelope.
 *   7. Catch everything, normalise it, log it once, and emit the error
 *      envelope. No route ever writes its own try/catch again.
 *
 * A route file becomes three lines:
 *
 *   export const GET = createHandler({ ... })
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { ZodType, ZodTypeDef } from 'zod';

import { jsonError, jsonSuccess, type PaginationMeta } from './api-response';
import {
  requireAuthContext,
  requireCronSecret,
  requireSuperAdmin,
  resolveAuthContext,
  type AuthContext,
} from './auth-context';
import { tenantDb, type TenantDb } from './db';
import { InternalError, RateLimitError, ValidationError } from './errors';
import { checkRateLimit, type RateLimitOptions } from '@/lib/rate-limit';
import { logger } from './logger';
import { normalizeError, validationErrorFromZod } from './normalize-error';
import {
  REQUEST_ID_HEADER,
  createRequestContext,
  elapsedMs,
  runWithRequestContext,
} from './request-context';

/** How a route authenticates. */
export type AuthMode =
  /** Requires a session *and* a tenant. Provides `ctx` and `db`. */
  | 'tenant'
  /** Requires a session; tenant optional (onboarding, account routes). */
  | 'session'
  /** Requires the `x-cron-secret` header. */
  | 'cron'
  /** Requires the operator session cookie. */
  | 'superAdmin'
  /** No auth (webhooks with their own signature check, public reads). */
  | 'public';

export interface HandlerInput<TParams, TQuery, TBody, TMode extends AuthMode> {
  params: TParams;
  query: TQuery;
  body: TBody;
  request: NextRequest;
  /** Present only when mode is `tenant`. */
  ctx: TMode extends 'tenant' ? AuthContext : AuthContext | null;
  /** Tenant-scoped Prisma client. Present only when mode is `tenant`. */
  db: TMode extends 'tenant' ? TenantDb : TenantDb | null;
}

/** Return this from a handler when you need to override envelope fields. */
export class HandlerResult<TData> {
  constructor(
    readonly data: TData,
    readonly options?: { message?: string; status?: number; pagination?: PaginationMeta },
  ) {}
}

export function result<TData>(
  data: TData,
  options?: { message?: string; status?: number; pagination?: PaginationMeta },
): HandlerResult<TData> {
  return new HandlerResult(data, options);
}

/**
 * Request schemas are declared over an `unknown` input.
 *
 * `ZodType<T>` defaults its input type to `T`, which makes any schema using
 * `.default()`, `.transform()` or `.coerce` unassignable — their input differs
 * from their output. Since params, query and body genuinely arrive as
 * untrusted `unknown`, that is the honest signature, and it is what lets a
 * controller declare `page: z.coerce.number().default(1)`.
 */
type RequestSchema<T> = ZodType<T, ZodTypeDef, unknown>;

export interface HandlerConfig<TParams, TQuery, TBody, TData, TMode extends AuthMode> {
  /** Stable operation id for logs and metrics, e.g. `contacts.list`. */
  operation: string;
  auth: TMode;
  /** Dynamic route segments. */
  params?: RequestSchema<TParams>;
  /** Query string. Values arrive as strings — use `z.coerce`. */
  query?: RequestSchema<TQuery>;
  /** JSON body. Omit for GET/DELETE. */
  body?: RequestSchema<TBody>;
  /**
   * Response DTO. Required — this is what makes the API typed, and it
   * doubles as a serialisation allowlist.
   */
  response: RequestSchema<TData>;
  /** Default success message. */
  message?: string;
  /** Default success status. */
  status?: number;
  /** Optional rate limit configuration for this endpoint. */
  rateLimit?: RateLimitOptions & {
    key?: (input: { request: NextRequest; ctx: AuthContext | null }) => string;
  };
  handle: (input: HandlerInput<TParams, TQuery, TBody, TMode>) => Promise<TData | HandlerResult<TData>>;
}

type RouteSecondArg<TRaw> = { params: Promise<TRaw> } | undefined;

async function parseBody(request: NextRequest): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength === '0') return undefined;

  const text = await request.text();
  if (text.trim().length === 0) return undefined;

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ValidationError('Request body is not valid JSON.', { cause: error });
  }
}

function queryToObject(request: NextRequest): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  });
  return out;
}

function validate<T>(schema: ZodType<T, ZodTypeDef, unknown> | undefined, value: unknown, label: string): T {
  if (!schema) return undefined as T;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error, `Invalid ${label}.`);
  }
  return parsed.data;
}

export function createHandler<
  TData,
  TMode extends AuthMode = 'tenant',
  TParams = undefined,
  TQuery = undefined,
  TBody = undefined,
>(config: HandlerConfig<TParams, TQuery, TBody, TData, TMode>) {
  return async function route(request: NextRequest, secondArg?: RouteSecondArg<unknown>): Promise<NextResponse> {
    const context = createRequestContext({
      operation: config.operation,
      method: request.method,
      path: request.nextUrl.pathname,
      requestId: request.headers.get(REQUEST_ID_HEADER) ?? undefined,
    });

    return runWithRequestContext(context, async () => {
      try {
        // ── auth ─────────────────────────────────────────────────────
        let authContext: AuthContext | null = null;
        switch (config.auth) {
          case 'tenant':
            authContext = await requireAuthContext();
            break;
          case 'session':
            authContext = await resolveAuthContext();
            break;
          case 'cron':
            requireCronSecret(request.headers.get('x-cron-secret'));
            break;
          case 'superAdmin':
            await requireSuperAdmin();
            break;
          case 'public':
            break;
          default: {
            const exhaustive: never = config.auth;
            throw new InternalError(`Unknown auth mode: ${String(exhaustive)}`);
          }
        }

        // ── rate limit ───────────────────────────────────────────────
        if (config.rateLimit) {
          const limiterKey = config.rateLimit.key
            ? config.rateLimit.key({ request, ctx: authContext })
            : `${authContext?.userId ?? request.headers.get('x-forwarded-for') ?? 'anon'}:${config.operation}`;
          
          const check = checkRateLimit(limiterKey, config.rateLimit);
          if (!check.success) {
            const retryAfterSec = Math.max(1, Math.ceil((check.reset - Date.now()) / 1000));
            throw new RateLimitError(retryAfterSec);
          }
        }

        // ── validation ───────────────────────────────────────────────
        const rawParams = secondArg?.params ? await secondArg.params : {};
        const params = validate(config.params, rawParams, 'route parameters');
        const query = validate(config.query, queryToObject(request), 'query parameters');
        const body = config.body
          ? validate(config.body, await parseBody(request), 'request body')
          : (undefined as TBody);

        // ── execute ──────────────────────────────────────────────────
        const db = authContext ? tenantDb(authContext.tenantId) : null;

        const raw = await config.handle({
          params,
          query,
          body,
          request,
          ctx: authContext as HandlerInput<TParams, TQuery, TBody, TMode>['ctx'],
          db: db as HandlerInput<TParams, TQuery, TBody, TMode>['db'],
        });

        const handlerResult = raw instanceof HandlerResult ? raw : new HandlerResult(raw);

        // ── response contract ────────────────────────────────────────
        const parsed = config.response.safeParse(handlerResult.data);
        if (!parsed.success) {
          // A response that violates its own DTO is a server bug, not a
          // client error. Fail closed rather than emit an unvalidated
          // payload of unknown shape.
          logger.error('response DTO violation', {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          });
          throw new InternalError('Response did not match its declared contract.', { cause: parsed.error });
        }

        const response = jsonSuccess(parsed.data, {
          message: handlerResult.options?.message ?? config.message,
          status: handlerResult.options?.status ?? config.status,
          pagination: handlerResult.options?.pagination,
        });

        logger.info('request completed', { status: response.status });
        return response;
      } catch (caught) {
        const error = normalizeError(caught);

        // 5xx is our fault and gets a stack; 4xx is the caller's and is
        // logged at warn without one, so the error stream stays signal.
        if (error.status >= 500) {
          logger.error('request failed', { code: error.code, status: error.status, err: error });
        } else {
          logger.warn('request rejected', {
            code: error.code,
            status: error.status,
            reason: error.message,
            details: error.details,
          });
        }

        return jsonError(error);
      } finally {
        // Guard against a handler that silently hangs a connection.
        if (elapsedMs() > 5_000) {
          logger.warn('slow request', { thresholdMs: 5_000 });
        }
      }
    });
  };
}

/**
 * Escape hatch for routes that must control the raw HTTP response —
 * Meta's webhook challenge (plain text), media proxying (binary), OAuth
 * redirects. Still gets context, logging, and the global error handler;
 * only the envelope is bypassed.
 */
export function createRawHandler<TMode extends AuthMode = 'public'>(config: {
  operation: string;
  auth: TMode;
  handle: (input: { request: NextRequest; ctx: AuthContext | null }) => Promise<Response>;
}) {
  return async function route(request: NextRequest): Promise<Response> {
    const context = createRequestContext({
      operation: config.operation,
      method: request.method,
      path: request.nextUrl.pathname,
      requestId: request.headers.get(REQUEST_ID_HEADER) ?? undefined,
    });

    return runWithRequestContext(context, async () => {
      try {
        let authContext: AuthContext | null = null;
        if (config.auth === 'tenant') authContext = await requireAuthContext();
        else if (config.auth === 'session') authContext = await resolveAuthContext();
        else if (config.auth === 'cron') requireCronSecret(request.headers.get('x-cron-secret'));
        else if (config.auth === 'superAdmin') await requireSuperAdmin();

        const response = await config.handle({ request, ctx: authContext });
        logger.info('raw request completed', { status: response.status });
        return response;
      } catch (caught) {
        const error = normalizeError(caught);
        if (error.status >= 500) {
          logger.error('raw request failed', { code: error.code, err: error });
        } else {
          logger.warn('raw request rejected', { code: error.code, reason: error.message });
        }
        return jsonError(error);
      }
    });
  };
}
