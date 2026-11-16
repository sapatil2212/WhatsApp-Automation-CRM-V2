/**
 * Converts anything thrown anywhere in the request pipeline into a typed
 * `AppError`. This is the single place that knows how third-party error
 * shapes (Zod, Prisma) map onto our taxonomy — services and repositories
 * never do this mapping themselves.
 */

import { Prisma } from '@prisma/client';
import { ZodError, type ZodIssue } from 'zod';

import {
  AppError,
  ConflictError,
  DatabaseError,
  InternalError,
  NotFoundError,
  ValidationError,
  isAppError,
} from './errors';

export interface FieldIssue {
  path: string;
  message: string;
  code: string;
}

/** Flattens Zod issues into a stable, client-renderable shape. */
export function toFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue: ZodIssue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

export function validationErrorFromZod(error: ZodError, message = 'Request validation failed.'): ValidationError {
  return new ValidationError(message, {
    details: { issues: toFieldIssues(error) },
    cause: error,
  });
}

/**
 * Prisma error code reference:
 *   P2000 value too long          → 400
 *   P2002 unique constraint       → 409
 *   P2003 FK constraint           → 400 (caller referenced something invalid)
 *   P2011 null constraint         → 400
 *   P2025 record required but absent → 404
 * Everything else is an infrastructure failure and is not exposed.
 */
function fromPrismaKnownRequestError(error: Prisma.PrismaClientKnownRequestError): AppError {
  switch (error.code) {
    case 'P2000':
      return new ValidationError('A submitted value exceeds the maximum allowed length.', {
        details: { column: error.meta?.column_name ?? null },
        cause: error,
      });
    case 'P2002': {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : target ? [String(target)] : [];
      return new ConflictError(
        fields.length > 0
          ? `A record with this ${fields.join(', ')} already exists.`
          : 'A record with these values already exists.',
        { details: { fields }, cause: error },
      );
    }
    case 'P2003':
      return new ValidationError('A referenced record does not exist.', {
        details: { field: error.meta?.field_name ?? null },
        cause: error,
      });
    case 'P2011':
      return new ValidationError('A required value was not provided.', {
        details: { constraint: error.meta?.constraint ?? null },
        cause: error,
      });
    case 'P2025':
      return new NotFoundError('Record', { cause: error });
    default:
      return new DatabaseError(`Prisma error ${error.code}.`, { cause: error });
  }
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return validationErrorFromZod(error);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return fromPrismaKnownRequestError(error);
  }

  if (
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientInitializationError
  ) {
    return new DatabaseError('Database client error.', { cause: error });
  }

  if (error instanceof Error) {
    return new InternalError(error.message, { cause: error });
  }

  return new InternalError('Non-error value thrown.', { cause: error });
}
