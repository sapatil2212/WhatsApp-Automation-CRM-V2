/**
 * Structured logger.
 *
 * One line of JSON per event on stdout/stderr, automatically enriched
 * with the ambient request context (requestId, tenantId, userId,
 * durationMs). Log aggregators (CloudWatch, Loki, Datadog) ingest this
 * without a parser.
 *
 * Deliberately dependency-free: the interface is a strict subset of
 * pino's, so swapping the sink later is a one-file change and no call
 * site moves.
 *
 * Two hard rules:
 *  1. Never log a secret. `redact()` strips known-sensitive keys at any
 *     depth, so an accidentally-spread config object is safe.
 *  2. Never log a raw customer message body. Pass lengths or ids.
 */

import { elapsedMs, getRequestContext } from './request-context';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * `LOG_LEVEL=silent` drops every record. Used by the test suite (negative
 * tests deliberately trigger 500s, and their stack traces would drown the
 * runner output) and available as an operational kill switch.
 */
const SILENT = process.env.LOG_LEVEL?.toLowerCase() === 'silent';

function resolveMinLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && (LOG_LEVELS as readonly string[]).includes(configured)) {
    return configured as LogLevel;
  }
  if (process.env.NODE_ENV === 'test') return 'error';
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const MIN_LEVEL = resolveMinLevel();

/**
 * Keys whose values are replaced with `[redacted]`. Matched
 * case-insensitively against the whole key, plus a substring pass for
 * `*token*` / `*secret*` / `*password*` so future field names are
 * covered without editing this list.
 */
const REDACTED_KEYS = new Set(
  [
    'password',
    'passwordhash',
    'authorization',
    'cookie',
    'setcookie',
    'accesstoken',
    'refreshtoken',
    'verifytoken',
    'metaappsecret',
    'apikey',
    'aiapikey',
    'encryptionkey',
    'jwtsecret',
    'smtppassword',
    'paymentgatewaykey',
    'paymentgatewaysecret',
    'googledrivecredentials',
  ].map((k) => k.toLowerCase()),
);

const REDACTED_SUBSTRINGS = ['token', 'secret', 'password', 'apikey', 'credential'];

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;

function shouldRedact(key: string): boolean {
  const lower = key.toLowerCase();
  if (REDACTED_KEYS.has(lower)) return true;
  return REDACTED_SUBSTRINGS.some((needle) => lower.includes(needle));
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      out[key] = shouldRedact(key) ? REDACTED : redact(source[key], depth + 1);
    }
    return out;
  }

  if (typeof value === 'bigint') return value.toString();
  return value;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError | string;
}

export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return { name: 'NonError', message: String(error) };
  }
  // Stacks are always kept: these records go to the log sink, never to a
  // client response. The global handler is what decides what the caller
  // sees.
  const out: SerializedError = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && depth < 3) {
    out.cause = cause instanceof Error ? serializeError(cause, depth + 1) : String(cause);
  }
  return out;
}

export interface LogFields {
  [key: string]: unknown;
  err?: unknown;
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (SILENT) return;
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL]) return;

  const context = getRequestContext();
  const { err, ...rest } = fields ?? {};

  const record: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg: message,
  };

  if (context) {
    record.requestId = context.requestId;
    record.operation = context.operation;
    record.method = context.method;
    record.path = context.path;
    record.durationMs = elapsedMs();
    if (context.tenantId) record.tenantId = context.tenantId;
    if (context.userId) record.userId = context.userId;
  }

  if (Object.keys(rest).length > 0) {
    Object.assign(record, redact(rest) as Record<string, unknown>);
  }

  if (err !== undefined) {
    record.err = serializeError(err);
  }

  const line = safeStringify(record);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

function safeStringify(record: Record<string, unknown>): string {
  try {
    return JSON.stringify(record);
  } catch {
    // Circular reference somewhere in the fields — fall back to the
    // primitives we always control so the event is never lost.
    return JSON.stringify({
      level: record.level,
      time: record.time,
      msg: record.msg,
      requestId: record.requestId,
      serializationError: true,
    });
  }
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that merges `bindings` into every record. */
  child(bindings: LogFields): Logger;
}

function makeLogger(bindings: LogFields = {}): Logger {
  const merge = (fields?: LogFields): LogFields | undefined => {
    if (!fields) return Object.keys(bindings).length > 0 ? bindings : undefined;
    return { ...bindings, ...fields };
  };
  return {
    debug: (message, fields) => emit('debug', message, merge(fields)),
    info: (message, fields) => emit('info', message, merge(fields)),
    warn: (message, fields) => emit('warn', message, merge(fields)),
    error: (message, fields) => emit('error', message, merge(fields)),
    child: (extra) => makeLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = makeLogger();

/** Convenience for module-scoped loggers: `const log = getLogger('flows.engine')`. */
export function getLogger(component: string): Logger {
  return logger.child({ component });
}
