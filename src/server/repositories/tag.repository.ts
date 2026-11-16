/**
 * Tag and custom-field-definition persistence.
 *
 * Both were previously reachable through the compat endpoint with no
 * tenant filter (`tag` was scoped, `customField` and `contactTag` were
 * not), so tags could be enumerated and deleted across tenants.
 */

import type { Prisma } from '@prisma/client';

import { scoped, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const tagWithCount = {
  _count: { select: { contacts: true } },
} satisfies Prisma.TagInclude;

export type TagRow = Prisma.TagGetPayload<{ include: typeof tagWithCount }>;

export class TagRepository extends BaseRepository {
  protected readonly resourceName = 'Tag';

  constructor(db: TenantDb) {
    super(db);
  }

  async list(): Promise<TagRow[]> {
    return this.db.tag.findMany({ include: tagWithCount, orderBy: { name: 'asc' } });
  }

  async findById(id: string): Promise<TagRow> {
    return this.requireFound(await this.db.tag.findFirst({ where: { id }, include: tagWithCount }));
  }

  async findByName(name: string): Promise<{ id: string } | null> {
    return this.db.tag.findFirst({ where: { name }, select: { id: true } });
  }

  /** Confirms every id belongs to this tenant before they are linked. */
  async countOwned(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.db.tag.count({ where: { id: { in: [...new Set(ids)] } } });
  }

  async create(data: { name: string; color: string; userId: string }): Promise<TagRow> {
    return this.db.tag.create({ data: scoped(data), include: tagWithCount });
  }

  async update(id: string, data: Partial<{ name: string; color: string }>): Promise<TagRow> {
    this.requireAffected(await this.db.tag.updateMany({ where: { id }, data }));
    return this.db.tag.findFirstOrThrow({ where: { id }, include: tagWithCount });
  }

  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.tag.deleteMany({ where: { id } }));
  }
}

const customFieldSelect = {
  id: true,
  fieldName: true,
  fieldType: true,
  fieldOptions: true,
  createdAt: true,
} satisfies Prisma.CustomFieldSelect;

export type CustomFieldRow = Prisma.CustomFieldGetPayload<{ select: typeof customFieldSelect }>;

export class CustomFieldRepository extends BaseRepository {
  protected readonly resourceName = 'Custom field';

  constructor(db: TenantDb) {
    super(db);
  }

  async list(): Promise<CustomFieldRow[]> {
    return this.db.customField.findMany({ select: customFieldSelect, orderBy: { fieldName: 'asc' } });
  }

  async findByName(fieldName: string): Promise<{ id: string } | null> {
    return this.db.customField.findFirst({ where: { fieldName }, select: { id: true } });
  }

  async countOwned(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.db.customField.count({ where: { id: { in: [...new Set(ids)] } } });
  }

  async create(data: {
    fieldName: string;
    fieldType: string;
    fieldOptions: string[];
    userId: string;
  }): Promise<CustomFieldRow> {
    return this.db.customField.create({
      data: scoped({
        fieldName: data.fieldName,
        fieldType: data.fieldType,
        fieldOptions: data.fieldOptions,
        userId: data.userId,
      }),
      select: customFieldSelect,
    });
  }

  async update(id: string, data: Partial<{ fieldName: string; fieldOptions: string[] }>): Promise<CustomFieldRow> {
    this.requireAffected(
      await this.db.customField.updateMany({
        where: { id },
        data: {
          ...(data.fieldName !== undefined ? { fieldName: data.fieldName } : {}),
          ...(data.fieldOptions !== undefined ? { fieldOptions: data.fieldOptions } : {}),
        },
      }),
    );
    return this.db.customField.findFirstOrThrow({ where: { id }, select: customFieldSelect });
  }

  /** Cascades to `ContactCustomValue` via the schema's onDelete: Cascade. */
  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.customField.deleteMany({ where: { id } }));
  }
}
