/**
 * Portfolio showcase persistence.
 *
 * The route this replaces had the weakest authorisation in the codebase:
 * `isAuthorized()` accepted *any* non-empty `accessToken` cookie without
 * calling `verifyAccessToken`, and `PUT`/`DELETE` then operated on a raw
 * `id` with no tenant filter — so a garbage cookie could edit or delete any
 * tenant's items. Its `getAuthContext()` fallback was worse: when no session
 * resolved it ran `prisma.user.findFirst()` and adopted whatever tenant came
 * back first.
 *
 * Here there is no fallback and no id-only write: the guard scopes every
 * query, and the kernel resolves identity in exactly one place.
 */

import type { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const portfolioSelect = {
  id: true,
  title: true,
  description: true,
  thumbnailUrl: true,
  metadataTags: true,
  projectLinks: true,
  previewMedia: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PortfolioItemSelect;

export type PortfolioItemRow = Prisma.PortfolioItemGetPayload<{ select: typeof portfolioSelect }>;

export class PortfolioRepository extends BaseRepository {
  protected readonly resourceName = 'Portfolio item';

  constructor(db: TenantDb) {
    super(db);
  }

  async list(pagination: PaginationQuery): Promise<Page<PortfolioItemRow>> {
    return this.paginate(
      ({ skip, take }) =>
        this.db.portfolioItem.findMany({
          select: portfolioSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.portfolioItem.count(),
      pagination,
    );
  }

  async findById(id: string): Promise<PortfolioItemRow> {
    return this.requireFound(
      await this.db.portfolioItem.findFirst({ where: { id }, select: portfolioSelect }),
    );
  }

  async create(input: {
    title: string;
    description: string | null;
    thumbnailUrl: string | null;
    metadataTags: Prisma.InputJsonValue;
    projectLinks: Prisma.InputJsonValue;
    previewMedia: Prisma.InputJsonValue;
    userId: string;
  }): Promise<PortfolioItemRow> {
    return this.db.portfolioItem.create({ data: scoped(input), select: portfolioSelect });
  }

  async update(id: string, data: Prisma.PortfolioItemUpdateManyMutationInput): Promise<PortfolioItemRow> {
    this.requireAffected(await this.db.portfolioItem.updateMany({ where: { id }, data }));
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.portfolioItem.deleteMany({ where: { id } }));
  }
}
