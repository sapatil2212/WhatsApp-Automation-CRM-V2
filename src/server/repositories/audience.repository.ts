/**
 * Audience resolution.
 *
 * Turns a typed `Audience` into a Prisma `where` clause, then either counts
 * it or streams matching contact ids in bounded batches.
 *
 * The previous implementation ran in the browser: it fetched
 * `.from('contacts').select('*')` with no pagination, held every contact in
 * memory, and filtered client-side. For a tenant with 50 000 contacts that
 * is a 50 000-row payload to a phone. Here the filter runs in the database
 * and only ids cross a boundary, in pages.
 */

import type { Prisma } from '@prisma/client';

import type { TenantDb } from '../kernel';
import type { Audience } from '../dtos/broadcast.dto';
import { BaseRepository } from './base.repository';

export class AudienceRepository extends BaseRepository {
  protected readonly resourceName = 'Audience';

  constructor(db: TenantDb) {
    super(db);
  }

  /**
   * Exclusions are expressed as `NOT { tags: { some } }` so a contact
   * carrying any excluded tag drops out, which is what "exclude these
   * segments" means to a marketer.
   */
  buildWhere(audience: Audience): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = {};
    const excludeTagIds = 'excludeTagIds' in audience ? audience.excludeTagIds : [];

    if (audience.type === 'tags') {
      where.tags = { some: { tagId: { in: audience.tagIds } } };
    } else if (audience.type === 'customField') {
      const valueFilter: Prisma.StringNullableFilter =
        audience.operator === 'contains' ? { contains: audience.value } : { equals: audience.value };

      if (audience.operator === 'isNot') {
        // "is not X" must include contacts with no value for the field at
        // all, otherwise the segment silently omits them.
        where.NOT = {
          customValues: {
            some: { customFieldId: audience.customFieldId, value: { equals: audience.value } },
          },
        };
      } else {
        where.customValues = {
          some: { customFieldId: audience.customFieldId, value: valueFilter },
        };
      }
    }

    if (excludeTagIds.length > 0) {
      const exclusion: Prisma.ContactWhereInput = {
        tags: { some: { tagId: { in: excludeTagIds } } },
      };
      where.NOT = where.NOT ? [where.NOT as Prisma.ContactWhereInput, exclusion] : exclusion;
    }

    // A contact with no phone number can never be messaged; excluding it
    // here keeps it out of the reach figure the user is shown.
    where.phone = { not: '' };

    return where;
  }

  async count(audience: Audience): Promise<number> {
    return this.db.contact.count({ where: this.buildWhere(audience) });
  }

  /** Count before exclusions, so the UI can show what was filtered out. */
  async countBeforeExclusions(audience: Audience): Promise<number> {
    const excludeTagIds = 'excludeTagIds' in audience ? audience.excludeTagIds : [];
    if (excludeTagIds.length === 0) return this.count(audience);
    const without: Audience =
      audience.type === 'all' ? audience : { ...audience, excludeTagIds: [] };
    return this.db.contact.count({ where: this.buildWhere(without) });
  }

  async sample(audience: Audience, take: number) {
    return this.db.contact.findMany({
      where: this.buildWhere(audience),
      select: { id: true, phone: true, name: true },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * Keyset pagination over contact ids, ordered by primary key.
   *
   * Offset pagination would drift while the campaign is materialising —
   * a contact created mid-run shifts every subsequent page and rows get
   * skipped or duplicated. Keying on `id > cursor` is stable regardless of
   * concurrent writes.
   */
  async pageIds(
    audience: Audience,
    batchSize: number,
    cursor?: string,
  ): Promise<{ ids: string[]; nextCursor: string | null }> {
    const rows = await this.db.contact.findMany({
      where: {
        ...this.buildWhere(audience),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });

    return {
      ids: rows.map((row) => row.id),
      nextCursor: rows.length === batchSize ? rows[rows.length - 1].id : null,
    };
  }
}
