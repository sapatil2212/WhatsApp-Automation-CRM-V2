/**
 * Kernel barrel.
 *
 * Application code imports from `@/server/kernel` only. Deep imports into
 * individual kernel files are reserved for the kernel's own modules and
 * its tests, which keeps the public surface small enough to keep stable.
 */

export {
  ERROR_CODES,
  AppError,
  ConflictError,
  DatabaseError,
  ExternalApiError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  NotImplementedError,
  RateLimitError,
  TenantContextMissingError,
  UnauthenticatedError,
  ValidationError,
  isAppError,
  type ErrorCode,
  type AppErrorOptions,
} from './errors';

export { normalizeError, toFieldIssues, validationErrorFromZod, type FieldIssue } from './normalize-error';

export {
  buildPaginationMeta,
  errorBody,
  jsonError,
  jsonSuccess,
  successBody,
  type ApiBody,
  type ApiErrorBody,
  type ApiErrorDetail,
  type ApiMeta,
  type ApiSuccessBody,
  type PaginationMeta,
} from './api-response';

export { getLogger, logger, redact, serializeError, type LogFields, type LogLevel, type Logger } from './logger';

export {
  REQUEST_ID_HEADER,
  elapsedMs,
  getRequestContext,
  setRequestIdentity,
  type RequestContext,
} from './request-context';

export { scoped, systemDb, tenantDb, type TenantDb } from './db';

export { TENANT_SCOPES, getTenantScope, type TenantScope } from './tenant-scope';

export {
  requireAuthContext,
  requireCronSecret,
  requirePrincipal,
  requireSuperAdmin,
  resolveAuthContext,
  resolvePrincipal,
  type AuthContext,
  type PrincipalContext,
} from './auth-context';

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginationQuerySchema,
  sortDirectionSchema,
  toPage,
  toPageBounds,
  type Page,
  type PageBounds,
  type PaginationQuery,
  type SortDirection,
} from './pagination';

export {
  HandlerResult,
  createHandler,
  createRawHandler,
  result,
  type AuthMode,
  type HandlerConfig,
  type HandlerInput,
} from './handler';

export {
  RATE_LIMITS,
  checkRateLimit,
  type RateLimitOptions,
  type RateLimitResult,
} from '@/lib/rate-limit';
