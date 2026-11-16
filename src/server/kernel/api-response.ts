/**
 * The one response shape every endpoint returns.
 *
 *   { success, message, data, meta, error }
 *
 * Both branches always carry all five keys, so clients never have to
 * probe for existence — `success` alone discriminates the union.
 *
 * `meta` always carries requestId + timestamp + durationMs, which makes
 * every client-reported bug traceable to a single log line.
 */

import { NextResponse } from 'next/server';

import type { AppError } from './errors';
import { RateLimitError } from './errors';
import { REQUEST_ID_HEADER, elapsedMs, getRequestContext } from './request-context';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface ApiMeta {
  requestId: string;
  timestamp: string;
  durationMs: number;
  pagination?: PaginationMeta;
}

export interface ApiSuccessBody<TData> {
  success: true;
  message: string;
  data: TData;
  meta: ApiMeta;
  error: null;
}

export interface ApiErrorDetail {
  code: string;
  details?: unknown;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  data: null;
  meta: ApiMeta;
  error: ApiErrorDetail;
}

export type ApiBody<TData> = ApiSuccessBody<TData> | ApiErrorBody;

export function buildPaginationMeta(input: { page: number; pageSize: number; total: number }): PaginationMeta {
  const totalPages = input.pageSize > 0 ? Math.ceil(input.total / input.pageSize) : 0;
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages,
    hasNext: input.page < totalPages,
    hasPrevious: input.page > 1,
  };
}

function baseMeta(pagination?: PaginationMeta): ApiMeta {
  const context = getRequestContext();
  return {
    requestId: context?.requestId ?? 'no-request-context',
    timestamp: new Date().toISOString(),
    durationMs: elapsedMs(),
    ...(pagination ? { pagination } : {}),
  };
}

function withStandardHeaders(response: NextResponse, extra?: Record<string, string>): NextResponse {
  const context = getRequestContext();
  if (context) response.headers.set(REQUEST_ID_HEADER, context.requestId);
  // API responses are per-caller and must never be shared by a CDN.
  response.headers.set('Cache-Control', 'no-store');
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export function successBody<TData>(
  data: TData,
  options?: { message?: string; pagination?: PaginationMeta },
): ApiSuccessBody<TData> {
  return {
    success: true,
    message: options?.message ?? 'OK',
    data,
    meta: baseMeta(options?.pagination),
    error: null,
  };
}

export function errorBody(error: AppError): ApiErrorBody {
  return {
    success: false,
    message: error.clientMessage(),
    data: null,
    meta: baseMeta(),
    error: {
      code: error.code,
      // `details` on non-exposed errors is withheld: DatabaseError and
      // InternalError carry driver internals we must not leak.
      ...(error.expose && error.details !== undefined ? { details: error.details } : {}),
    },
  };
}

export function jsonSuccess<TData>(
  data: TData,
  options?: { message?: string; status?: number; pagination?: PaginationMeta; headers?: Record<string, string> },
): NextResponse {
  return withStandardHeaders(
    NextResponse.json(successBody(data, options), { status: options?.status ?? 200 }),
    options?.headers,
  );
}

export function jsonError(error: AppError): NextResponse {
  const headers: Record<string, string> = {};
  if (error instanceof RateLimitError) {
    headers['Retry-After'] = String(error.retryAfterSeconds);
  }
  return withStandardHeaders(NextResponse.json(errorBody(error), { status: error.status }), headers);
}
