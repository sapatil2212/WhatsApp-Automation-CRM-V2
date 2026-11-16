/**
 * Typed error hierarchy.
 *
 * Every failure that crosses an API boundary is an `AppError`. Anything
 * else that reaches the global handler is a bug and gets normalised into
 * `InternalError` with the original attached as `cause` (logged, never
 * sent to the client).
 *
 * Rules:
 *  - `code` is a stable machine-readable string. Clients switch on it.
 *  - `status` is the HTTP status the global handler will emit.
 *  - `expose` decides whether `message` is safe to show a user. Internal
 *    and database errors are never exposed; they get a generic message.
 *  - `details` is structured, already-safe context (field errors, ids).
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'TENANT_CONTEXT_MISSING',
  'DATABASE_ERROR',
  'EXTERNAL_API_ERROR',
  'NOT_IMPLEMENTED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorOptions {
  message?: string;
  details?: unknown;
  cause?: unknown;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;
  /** Whether `message` may be shown to the caller. */
  readonly expose: boolean = true;
  readonly details?: unknown;

  constructor(message: string, options?: AppErrorOptions) {
    super(options?.message ?? message);
    this.name = new.target.name;
    this.details = options?.details;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    Error.captureStackTrace?.(this, new.target);
  }

  /** Message safe for the wire. */
  clientMessage(): string {
    return this.expose ? this.message : 'An unexpected error occurred.';
  }
}

/** 400 — request failed schema validation or a domain invariant. */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly status = 400;

  constructor(message = 'Request validation failed.', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 401 — no valid session. */
export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED' as const;
  readonly status = 401;

  constructor(message = 'Authentication required.', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 403 — authenticated but not permitted. */
export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN' as const;
  readonly status = 403;

  constructor(message = 'You do not have permission to perform this action.', options?: AppErrorOptions) {
    super(message, options);
  }
}

/**
 * 404 — resource absent *or* outside the caller's tenant. Deliberately
 * indistinguishable so tenant ids can't be probed for existence.
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly status = 404;

  constructor(resource = 'Resource', options?: AppErrorOptions) {
    super(`${resource} not found.`, options);
  }
}

/** 409 — uniqueness or state conflict. */
export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const;
  readonly status = 409;

  constructor(message = 'The request conflicts with the current state.', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 429 — throttled. */
export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED' as const;
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, options?: AppErrorOptions) {
    super('Rate limit exceeded.', options);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * 403 — a session exists but carries no tenant. Distinct from Forbidden
 * so the client can route the user to onboarding rather than show a
 * permission error.
 */
export class TenantContextMissingError extends AppError {
  readonly code = 'TENANT_CONTEXT_MISSING' as const;
  readonly status = 403;

  constructor(message = 'No workspace is associated with this account.', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 500 — the database rejected or failed the operation. Never exposed. */
export class DatabaseError extends AppError {
  readonly code = 'DATABASE_ERROR' as const;
  readonly status = 500;
  readonly expose = false;

  constructor(message = 'Database operation failed.', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 502 — an upstream provider (Meta, Gemini, SMTP) failed. */
export class ExternalApiError extends AppError {
  readonly code = 'EXTERNAL_API_ERROR' as const;
  readonly status = 502;
  readonly provider: string;

  constructor(provider: string, message?: string, options?: AppErrorOptions) {
    super(message ?? `Upstream request to ${provider} failed.`, options);
    this.provider = provider;
  }
}

/** 501 — route exists but the capability is not built yet. */
export class NotImplementedError extends AppError {
  readonly code = 'NOT_IMPLEMENTED' as const;
  readonly status = 501;

  constructor(message = 'This capability is not implemented.', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 500 — anything unanticipated. Never exposed. */
export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR' as const;
  readonly status = 500;
  readonly expose = false;

  constructor(message = 'Internal server error.', options?: AppErrorOptions) {
    super(message, options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
