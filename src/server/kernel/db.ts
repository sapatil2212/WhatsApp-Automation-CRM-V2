/**
 * Database access.
 *
 * Two entry points, and only two:
 *
 *   tenantDb(tenantId)  — every request-scoped query. A Prisma client
 *                         extension rewrites `where` / `data` on every
 *                         operation so tenant isolation cannot be
 *                         forgotten, bypassed, or overwritten by caller
 *                         input. Models absent from TENANT_SCOPES are
 *                         rejected outright (deny by default).
 *
 *   systemDb            — the unguarded client. Legitimate uses are
 *                         authentication (User/RefreshToken lookups),
 *                         the WhatsApp webhook (runs before a tenant is
 *                         known), signup provisioning, and cron sweeps.
 *                         Every call site must justify itself in a
 *                         comment.
 *
 * Guard semantics per scope kind:
 *
 *   direct        reads/writes get `where.tenantId = tenantId`;
 *                 creates get `data.tenantId = tenantId`.
 *   parent        reads/writes get `where.<relation> = { tenantId }`;
 *                 creates pre-verify the FK's owner in one query.
 *   scalarParent  reads/writes get `where.<fk> = { in: ownedIds }`.
 *   global        rejected — use systemDb.
 *
 * Known bypass: `$queryRaw` / `$executeRaw` are not intercepted by
 * Prisma extensions. Raw SQL is therefore banned outside systemDb; the
 * repository base class does not expose it.
 */

import { Prisma, PrismaClient } from '@prisma/client';

import { ForbiddenError, InternalError, NotFoundError } from './errors';
import { getLogger } from './logger';
import {
  BULK_WRITE_OPERATIONS,
  CREATE_OPERATIONS,
  READ_OPERATIONS,
  UNIQUE_OPERATIONS,
  getTenantScope,
} from './tenant-scope';

const log = getLogger('kernel.db');

const globalForPrisma = globalThis as unknown as {
  __systemPrisma?: PrismaClient;
  __tenantClients?: Map<string, TenantDb>;
};

/**
 * Unguarded client.
 *
 * Prisma's `query` log channel is deliberately left off: it prints
 * interpolated parameters, which would put access tokens and password
 * hashes into the log stream. Driver failures surface as thrown errors
 * and are logged by the global handler through `normalizeError`, so the
 * `error` channel would only duplicate them.
 */
export const systemDb: PrismaClient = globalForPrisma.__systemPrisma ?? new PrismaClient();

if (!globalForPrisma.__systemPrisma) {
  globalForPrisma.__systemPrisma = systemDb;
}

type AnyArgs = Record<string, unknown>;

function asRecord(value: unknown): AnyArgs {
  return value && typeof value === 'object' ? (value as AnyArgs) : {};
}

/**
 * Resolves the BusinessProfile ids a tenant owns. Only needed for
 * BusinessAILog, whose owner column has no relation field in the schema.
 * Memoised per tenant client instance — a tenant's set of business
 * profiles changes at most once during onboarding.
 */
function makeOwnedIdResolver(tenantId: string) {
  const cache = new Map<string, Promise<string[]>>();
  return (parentModel: string): Promise<string[]> => {
    const cached = cache.get(parentModel);
    if (cached) return cached;

    let promise: Promise<string[]>;
    if (parentModel === 'BusinessProfile') {
      promise = systemDb.businessProfile
        .findMany({ where: { tenantId }, select: { id: true } })
        .then((rows) => rows.map((row) => row.id));
    } else {
      promise = Promise.reject(
        new InternalError(`No owned-id resolver registered for parent model "${parentModel}".`),
      );
    }
    cache.set(parentModel, promise);
    return promise;
  };
}

/**
 * Confirms a set of parent-row ids all belong to this tenant before an
 * insert is allowed to reference them. Runs against systemDb so it can
 * read the parent's tenantId without recursing through the guard.
 */
async function assertParentsOwned(input: {
  tenantId: string;
  model: string;
  parentModel: string;
  foreignKey: string;
  ids: string[];
}): Promise<void> {
  const unique = [...new Set(input.ids)];
  if (unique.length === 0) return;

  const delegate = (systemDb as unknown as Record<string, { count?: (args: unknown) => Promise<number> }>)[
    lowerFirst(input.parentModel)
  ];
  if (!delegate?.count) {
    throw new InternalError(`Cannot verify tenant ownership: unknown parent model "${input.parentModel}".`);
  }

  const owned = await delegate.count({
    where: { id: { in: unique }, tenantId: input.tenantId },
  });

  if (owned !== unique.length) {
    log.warn('rejected cross-tenant write', {
      model: input.model,
      parentModel: input.parentModel,
      foreignKey: input.foreignKey,
      requested: unique.length,
      owned,
    });
    throw new NotFoundError(input.parentModel);
  }
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function collectForeignKeys(data: unknown, foreignKey: string): string[] {
  const rows = Array.isArray(data) ? data : [data];
  const ids: string[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    const value = record[foreignKey];
    if (typeof value === 'string' && value.length > 0) {
      ids.push(value);
    }
  }
  return ids;
}

/**
 * Builds the guarded client. The returned value is a normal Prisma
 * client as far as callers are concerned — same delegates, same types,
 * same `$transaction`.
 */
function buildTenantClient(tenantId: string) {
  const resolveOwnedIds = makeOwnedIdResolver(tenantId);

  return systemDb.$extends({
    name: `tenant-scope:${tenantId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scope = getTenantScope(model);

          // Deny by default. A new model in schema.prisma that nobody
          // classified must fail loudly rather than leak.
          if (!scope) {
            throw new InternalError(
              `Model "${model}" has no tenant scope declared. Add it to TENANT_SCOPES in src/server/kernel/tenant-scope.ts.`,
            );
          }

          if (scope.kind === 'global') {
            throw new ForbiddenError(
              `Model "${model}" is not tenant-scoped (${scope.reason}) and cannot be accessed through tenantDb. Use systemDb with an explicit justification.`,
            );
          }

          const mutableArgs = asRecord(args);

          // ── creates ──────────────────────────────────────────────
          if (CREATE_OPERATIONS.has(operation)) {
            if (scope.kind === 'direct') {
              const data = mutableArgs.data;
              if (Array.isArray(data)) {
                mutableArgs.data = data.map((row) => ({ ...asRecord(row), tenantId }));
              } else {
                mutableArgs.data = { ...asRecord(data), tenantId };
              }
            } else {
              await assertParentsOwned({
                tenantId,
                model,
                parentModel: scope.parentModel,
                foreignKey: scope.foreignKey,
                ids: collectForeignKeys(mutableArgs.data, scope.foreignKey),
              });
            }
            return query(mutableArgs);
          }

          // ── upsert: guard the lookup, scope the insert ────────────
          if (operation === 'upsert') {
            mutableArgs.where = await applyWhereGuard({
              tenantId,
              scope,
              where: mutableArgs.where,
              resolveOwnedIds,
            });
            if (scope.kind === 'direct') {
              mutableArgs.create = { ...asRecord(mutableArgs.create), tenantId };
            } else if (scope.kind === 'parent' || scope.kind === 'scalarParent') {
              await assertParentsOwned({
                tenantId,
                model,
                parentModel: scope.parentModel,
                foreignKey: scope.foreignKey,
                ids: collectForeignKeys(mutableArgs.create, scope.foreignKey),
              });
            }
            return query(mutableArgs);
          }

          // ── everything else is filtered through `where` ───────────
          if (
            READ_OPERATIONS.has(operation) ||
            BULK_WRITE_OPERATIONS.has(operation) ||
            UNIQUE_OPERATIONS.has(operation)
          ) {
            mutableArgs.where = await applyWhereGuard({
              tenantId,
              scope,
              where: mutableArgs.where,
              resolveOwnedIds,
            });
            return query(mutableArgs);
          }

          throw new InternalError(
            `Operation "${operation}" on model "${model}" is not covered by the tenant guard. Extend src/server/kernel/tenant-scope.ts.`,
          );
        },
      },
    },
  });
}

/**
 * Applies the guard *after* spreading the caller's filters, so a caller
 * that passes `tenantId` (or a relation filter on the owner) can never
 * widen the scope — our value always wins. This ordering is the fix for
 * the overwrite flaw in the old compat endpoint.
 *
 * Exported for unit testing: this function is the entire security
 * boundary, so it is verified directly rather than only through
 * integration.
 */
export async function applyWhereGuard(input: {
  tenantId: string;
  scope: NonNullable<ReturnType<typeof getTenantScope>>;
  where: unknown;
  resolveOwnedIds: (parentModel: string) => Promise<string[]>;
}): Promise<AnyArgs> {
  const where = { ...asRecord(input.where) };

  switch (input.scope.kind) {
    case 'direct':
      where.tenantId = input.tenantId;
      return where;
    case 'parent': {
      const existing = asRecord(where[input.scope.relation]);
      where[input.scope.relation] = { ...existing, tenantId: input.tenantId };
      return where;
    }
    case 'scalarParent': {
      const ownedIds = await input.resolveOwnedIds(input.scope.parentModel);
      where[input.scope.foreignKey] = { in: ownedIds };
      return where;
    }
    default:
      throw new InternalError('Unreachable tenant scope kind.');
  }
}

export type TenantDb = ReturnType<typeof buildTenantClient>;

/**
 * Declares that a create payload is complete because the tenant guard
 * supplies the ownership columns.
 *
 * Prisma generates `tenantId` as a required field on create inputs. It is
 * genuinely required at the database level, but a repository must not
 * provide it — the whole point of `tenantDb` is that no application code
 * chooses a tenant. `$extends` cannot rewrite Prisma's *input types*, only
 * runtime behaviour, so this asserts what the extension guarantees.
 *
 * This is the only sanctioned cast in the data layer. It is named so it
 * shows up in review, and it is a no-op at runtime: passing a `tenantId`
 * here would still be overwritten by the guard.
 */
export function scoped<TData extends object>(data: TData): TData & { tenantId: string } {
  return data as TData & { tenantId: string };
}

/**
 * Returns the guarded client for a tenant. Cached because the extension
 * closure captures nothing but the immutable tenantId, so reuse is safe
 * and avoids rebuilding the delegate proxies on every request.
 */
export function tenantDb(tenantId: string): TenantDb {
  if (!tenantId) {
    throw new InternalError('tenantDb requires a tenantId.');
  }
  const cache = (globalForPrisma.__tenantClients ??= new Map<string, TenantDb>());
  const existing = cache.get(tenantId);
  if (existing) return existing;

  // Bounded so a long-lived process serving many tenants cannot grow
  // without limit. Eviction is trivially safe: the next call rebuilds.
  if (cache.size >= 256) cache.clear();

  const client = buildTenantClient(tenantId);
  cache.set(tenantId, client);
  return client;
}

/** Re-exported so repositories can type transaction callbacks. */
export type { Prisma };
