/**
 * Repository base.
 *
 * A repository owns *persistence for one aggregate* and nothing else: no
 * HTTP concerns, no authorisation decisions, no external API calls. It
 * receives an already tenant-scoped client, so a repository physically
 * cannot read another tenant's rows — there is no `tenantId` parameter to
 * get wrong, and no raw-SQL escape hatch exposed.
 *
 * Services compose repositories; controllers call services. Nothing skips
 * a layer.
 */

import { NotFoundError } from '../kernel/errors';
import type { TenantDb } from '../kernel/db';
import { type Page, type PaginationQuery, toPage } from '../kernel/pagination';

export abstract class BaseRepository {
  /**
   * Tenant-guarded Prisma client. Protected, not public: callers outside
   * the repository must not issue ad-hoc queries, or the repository stops
   * being the single place that knows this aggregate's shape.
   */
  protected readonly db: TenantDb;

  /** Human-readable aggregate name used in NotFound messages. */
  protected abstract readonly resourceName: string;

  constructor(db: TenantDb) {
    this.db = db;
  }

  /**
   * Runs a `findMany` + `count` pair inside one transaction so the total
   * cannot drift from the page contents under concurrent writes.
   */
  protected async paginate<TItem>(
    fetchPage: (bounds: { skip: number; take: number }) => Promise<TItem[]>,
    countAll: () => Promise<number>,
    query: PaginationQuery,
  ): Promise<Page<TItem>> {
    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await Promise.all([fetchPage({ skip, take: query.pageSize }), countAll()]);
    return toPage(items, total, query);
  }

  /** Throws a tenant-safe 404 when a lookup came back empty. */
  protected requireFound<TValue>(value: TValue | null | undefined): TValue {
    if (value === null || value === undefined) {
      throw new NotFoundError(this.resourceName);
    }
    return value;
  }

  /**
   * Asserts a bulk write actually matched something. The tenant guard
   * turns "row belongs to another tenant" into "zero rows affected", so
   * this is what converts that into a 404 instead of a silent no-op —
   * the exact failure mode that made the old broadcast status updates
   * disappear without an error.
   */
  protected requireAffected(result: { count: number }): void {
    if (result.count === 0) {
      throw new NotFoundError(this.resourceName);
    }
  }
}
