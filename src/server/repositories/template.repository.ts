/**
 * Message-template persistence.
 *
 * Note the uniqueness key: `(tenantId, name, language)`. Meta treats a
 * template as identified by name + language, so that triple is the natural
 * upsert key. The previous sync route keyed on `user_id` instead, which
 * meant two users in one tenant produced duplicate rows for the same Meta
 * template.
 */

import type { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const templateSelect = {
  id: true,
  name: true,
  category: true,
  language: true,
  headerType: true,
  headerContent: true,
  bodyText: true,
  footerText: true,
  buttons: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MessageTemplateSelect;

export type TemplateRow = Prisma.MessageTemplateGetPayload<{ select: typeof templateSelect }>;

export interface TemplateListFilter {
  search?: string;
  category?: string;
  status?: string;
  sendableOnly?: boolean;
}

export interface UpsertTemplateInput {
  name: string;
  language: string;
  category: string;
  headerType: string | null;
  headerContent: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: Prisma.InputJsonValue | undefined;
  status: string;
  userId: string;
}

export class TemplateRepository extends BaseRepository {
  protected readonly resourceName = 'Template';

  constructor(db: TenantDb) {
    super(db);
  }

  private buildWhere(filter: TemplateListFilter): Prisma.MessageTemplateWhereInput {
    const where: Prisma.MessageTemplateWhereInput = {};
    if (filter.category) where.category = filter.category;
    // `sendableOnly` wins over an explicit status so a picker cannot be
    // tricked into offering unapproved templates by passing both.
    if (filter.sendableOnly) where.status = 'Approved';
    else if (filter.status) where.status = filter.status;
    if (filter.search) {
      where.OR = [{ name: { contains: filter.search } }, { bodyText: { contains: filter.search } }];
    }
    return where;
  }

  async list(filter: TemplateListFilter, pagination: PaginationQuery): Promise<Page<TemplateRow>> {
    const where = this.buildWhere(filter);
    return this.paginate(
      ({ skip, take }) =>
        this.db.messageTemplate.findMany({
          where,
          select: templateSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.messageTemplate.count({ where }),
      pagination,
    );
  }

  async findById(id: string): Promise<TemplateRow> {
    return this.requireFound(await this.db.messageTemplate.findFirst({ where: { id }, select: templateSelect }));
  }

  async findByNameAndLanguage(name: string, language: string): Promise<TemplateRow | null> {
    return this.db.messageTemplate.findFirst({ where: { name, language }, select: templateSelect });
  }

  /**
   * Upsert on `(name, language)` within the tenant. Expressed as
   * find-then-write rather than `upsert` because the schema has no
   * composite unique index on that triple, so there is no unique selector
   * to hand Prisma.
   */
  async upsertByNameAndLanguage(input: UpsertTemplateInput): Promise<TemplateRow> {
    const existing = await this.db.messageTemplate.findFirst({
      where: { name: input.name, language: input.language },
      select: { id: true },
    });

    const data = {
      name: input.name,
      language: input.language,
      category: input.category,
      headerType: input.headerType,
      headerContent: input.headerContent,
      bodyText: input.bodyText,
      footerText: input.footerText,
      ...(input.buttons !== undefined ? { buttons: input.buttons } : {}),
      status: input.status,
    };

    if (existing) {
      await this.db.messageTemplate.updateMany({ where: { id: existing.id }, data });
      return this.findById(existing.id);
    }

    return this.db.messageTemplate.create({
      data: scoped({ ...data, userId: input.userId }),
      select: templateSelect,
    });
  }

  async updateStatus(id: string, status: string): Promise<void> {
    this.requireAffected(await this.db.messageTemplate.updateMany({ where: { id }, data: { status } }));
  }

  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.messageTemplate.deleteMany({ where: { id } }));
  }

  async countByStatus(): Promise<Record<string, number>> {
    const groups = await this.db.messageTemplate.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
  }
}
