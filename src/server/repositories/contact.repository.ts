/**
 * Contact persistence.
 *
 * Every method here runs on a tenant-scoped client, so there is no
 * `tenantId` argument and no way to omit one. Compare with the code this
 * replaces, where `contactTag`, `contactCustomValue`, and `customField`
 * had no tenant filter at all and any authenticated user could strip tags
 * from another tenant's contacts.
 */

import type { Prisma } from '@prisma/client';

import type { TenantDb } from '../kernel';
import { scoped, type Page, type PaginationQuery } from '../kernel';
import { BaseRepository } from './base.repository';

/** Relations the list view needs. */
const listInclude = {
  tags: { include: { tag: true } },
} satisfies Prisma.ContactInclude;

/** Relations the detail view needs. */
const detailInclude = {
  tags: { include: { tag: true } },
  customValues: {
    include: { customField: { select: { fieldName: true, fieldType: true } } },
  },
  notes: {
    orderBy: { createdAt: 'desc' },
    take: 100,
  },
  conversations: { select: { id: true }, orderBy: { lastMessageAt: 'desc' }, take: 1 },
  deals: { select: { id: true }, where: { status: 'active' } },
} satisfies Prisma.ContactInclude;

export type ContactListRow = Prisma.ContactGetPayload<{ include: typeof listInclude }>;
export type ContactDetailRow = Prisma.ContactGetPayload<{ include: typeof detailInclude }>;

export interface ContactListFilter {
  search?: string;
  tagIds?: string[];
  sortBy: 'createdAt' | 'updatedAt' | 'name' | 'phone';
  sortDirection: 'asc' | 'desc';
}

export class ContactRepository extends BaseRepository {
  protected readonly resourceName = 'Contact';

  constructor(db: TenantDb) {
    super(db);
  }

  /**
   * `mode: 'insensitive'` is deliberately absent: it is a PostgreSQL-only
   * feature and throws `PrismaClientValidationError` on MySQL. The old
   * code emitted it from two shims, which is why contact search returned
   * "Failed to load contacts". MySQL's default collation is already
   * case-insensitive.
   */
  private buildWhere(filter: ContactListFilter): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = {};

    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search } },
        { phone: { contains: filter.search } },
        { email: { contains: filter.search } },
        { company: { contains: filter.search } },
      ];
    }

    if (filter.tagIds && filter.tagIds.length > 0) {
      // `some` rather than a join per tag: a contact matching any of the
      // selected tags is the behaviour the tag filter UI implies.
      where.tags = { some: { tagId: { in: filter.tagIds } } };
    }

    return where;
  }

  async list(filter: ContactListFilter, pagination: PaginationQuery): Promise<Page<ContactListRow>> {
    const where = this.buildWhere(filter);
    // Secondary sort on id keeps pagination stable when the primary key
    // ties (e.g. many contacts imported in the same second).
    const orderBy: Prisma.ContactOrderByWithRelationInput[] = [
      { [filter.sortBy]: filter.sortDirection } as Prisma.ContactOrderByWithRelationInput,
      { id: 'asc' },
    ];

    return this.paginate(
      ({ skip, take }) => this.db.contact.findMany({ where, include: listInclude, orderBy, skip, take }),
      () => this.db.contact.count({ where }),
      pagination,
    );
  }

  async findDetail(id: string): Promise<ContactDetailRow> {
    return this.requireFound(await this.db.contact.findFirst({ where: { id }, include: detailInclude }));
  }

  async findByPhone(phone: string): Promise<{ id: string } | null> {
    return this.db.contact.findFirst({ where: { phone }, select: { id: true } });
  }

  /**
   * Candidates whose phone ends with the same trailing digits.
   *
   * Exists only for rows written before phone numbers were normalised on the
   * way in: `+370 639 49836` and `37063949836` are the same person but not the
   * same string. `@@unique([tenantId, phone])` makes the exact lookup the fast
   * path, and this bounded suffix scan is the fallback — the previous webhook
   * loaded every contact in the tenant on *every* inbound message and matched
   * in JavaScript.
   */
  async findByPhoneSuffix(phone: string, limit = 200): Promise<Array<{ id: string; phone: string }>> {
    const suffix = phone.slice(-8);
    if (suffix.length < 8) return [];
    return this.db.contact.findMany({
      where: { phone: { endsWith: suffix } },
      select: { id: true, phone: true },
      take: limit,
    });
  }

  /** Phone → id for a batch, used by the importer to detect duplicates. */
  async mapPhonesToIds(phones: string[]): Promise<Map<string, string>> {
    if (phones.length === 0) return new Map();
    const rows = await this.db.contact.findMany({
      where: { phone: { in: [...new Set(phones)] } },
      select: { id: true, phone: true },
    });
    return new Map(rows.map((row) => [row.phone, row.id]));
  }

  async create(data: {
    phone: string;
    name: string | null;
    email: string | null;
    company: string | null;
    avatarUrl: string | null;
    userId: string;
  }): Promise<ContactListRow> {
    return this.db.contact.create({ data: scoped(data), include: listInclude });
  }

  async update(
    id: string,
    data: Partial<{
      phone: string;
      name: string | null;
      email: string | null;
      company: string | null;
      avatarUrl: string | null;
    }>,
  ): Promise<ContactListRow> {
    // updateMany first so a cross-tenant id yields 0 rows → 404, rather
    // than Prisma's P2025 with a different message.
    this.requireAffected(await this.db.contact.updateMany({ where: { id }, data }));
    return this.db.contact.findFirstOrThrow({ where: { id }, include: listInclude });
  }

  async delete(id: string): Promise<void> {
    this.requireAffected(await this.db.contact.deleteMany({ where: { id } }));
  }

  async exists(id: string): Promise<boolean> {
    return (await this.db.contact.count({ where: { id } })) > 0;
  }

  // ── tag links ─────────────────────────────────────────────────────

  /**
   * Replaces a contact's tag set. Runs in a transaction so a failure
   * cannot leave the contact with no tags — the previous
   * delete-then-insert was unguarded and lost data when the insert threw.
   */
  async replaceTags(contactId: string, tagIds: string[]): Promise<void> {
    const unique = [...new Set(tagIds)];
    await this.db.$transaction(async (tx) => {
      await tx.contactTag.deleteMany({ where: { contactId } });
      if (unique.length > 0) {
        await tx.contactTag.createMany({
          data: unique.map((tagId) => ({ contactId, tagId })),
        });
      }
    });
  }

  async addTags(contactId: string, tagIds: string[]): Promise<void> {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return;
    const existing = await this.db.contactTag.findMany({
      where: { contactId, tagId: { in: unique } },
      select: { tagId: true },
    });
    const already = new Set(existing.map((row) => row.tagId));
    const toAdd = unique.filter((tagId) => !already.has(tagId));
    if (toAdd.length === 0) return;
    await this.db.contactTag.createMany({ data: toAdd.map((tagId) => ({ contactId, tagId })) });
  }

  async removeTag(contactId: string, tagId: string): Promise<void> {
    await this.db.contactTag.deleteMany({ where: { contactId, tagId } });
  }

  /**
   * Whether a tag is currently attached. Used by automation and flow
   * `condition` steps, which previously counted rows through the compat shim
   * with no tenant predicate at all.
   */
  async hasTag(contactId: string, tagId: string): Promise<boolean> {
    return (await this.db.contactTag.count({ where: { contactId, tagId } })) > 0;
  }

  /** Single custom value, for a `condition` step comparing a custom field. */
  async findCustomValue(contactId: string, customFieldId: string): Promise<string | null> {
    const row = await this.db.contactCustomValue.findFirst({
      where: { contactId, customFieldId },
      select: { value: true },
    });
    return row?.value ?? null;
  }

  // ── custom values ─────────────────────────────────────────────────

  /**
   * Upserts the supplied values and clears the ones explicitly set to
   * null, in one transaction. The old implementation deleted every value
   * then re-inserted, so an error mid-way wiped the contact's data.
   */
  async setCustomValues(
    contactId: string,
    values: Array<{ customFieldId: string; value: string | null }>,
  ): Promise<void> {
    if (values.length === 0) return;

    await this.db.$transaction(async (tx) => {
      const toClear = values.filter((entry) => entry.value === null).map((entry) => entry.customFieldId);
      const toSet = values.filter((entry): entry is { customFieldId: string; value: string } => entry.value !== null);

      if (toClear.length > 0) {
        await tx.contactCustomValue.deleteMany({
          where: { contactId, customFieldId: { in: toClear } },
        });
      }

      for (const entry of toSet) {
        await tx.contactCustomValue.upsert({
          where: { contactId_customFieldId: { contactId, customFieldId: entry.customFieldId } },
          create: { contactId, customFieldId: entry.customFieldId, value: entry.value },
          update: { value: entry.value },
        });
      }
    });
  }

  // ── notes ─────────────────────────────────────────────────────────

  async listNotes(contactId: string) {
    return this.db.contactNote.findMany({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async createNote(data: { contactId: string; userId: string; noteText: string }) {
    return this.db.contactNote.create({ data: scoped(data) });
  }

  async deleteNote(contactId: string, noteId: string): Promise<void> {
    this.requireAffected(await this.db.contactNote.deleteMany({ where: { id: noteId, contactId } }));
  }
}
