/**
 * Contact business rules.
 *
 * A service owns invariants that outlive any single HTTP route:
 *  - a phone number is unique within a tenant,
 *  - tag and custom-field ids referenced by a write must belong to the
 *    caller's tenant,
 *  - an import is idempotent under the caller's chosen duplicate policy.
 *
 * The service never touches cookies, `NextRequest`, or `NextResponse`, so
 * the same code path serves the HTTP API, the CSV importer, and (later)
 * the webhook's contact-upsert.
 */

import { ConflictError, NotFoundError, ValidationError, type TenantDb } from '../kernel';
import { type Page, type PaginationQuery } from '../kernel';
import {
  toContactDetailDto,
  toContactDto,
  toContactNoteDto,
  type ContactDetailDto,
  type ContactDto,
  type ContactImportResultDto,
  type ContactNoteDto,
} from '../dtos/contact.dto';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { ContactRepository, type ContactListFilter } from '../repositories/contact.repository';
import { CustomFieldRepository, TagRepository } from '../repositories/tag.repository';
import type {
  CreateContactBody,
  CreateContactNoteBody,
  ImportContactsBody,
  ListContactsQuery,
  SetContactCustomValuesBody,
  UpdateContactBody,
} from '../validators/contact.validator';

/**
 * Collaborators are injected rather than constructed internally, so the
 * business rules above can be unit-tested against fakes with no database.
 * Use `ContactService.create(db, userId)` for the wired-up instance.
 */
export interface ContactServiceDeps {
  contacts: Pick<
    ContactRepository,
    | 'list'
    | 'findDetail'
    | 'findByPhone'
    | 'mapPhonesToIds'
    | 'create'
    | 'update'
    | 'delete'
    | 'exists'
    | 'replaceTags'
    | 'addTags'
    | 'setCustomValues'
    | 'listNotes'
    | 'createNote'
    | 'deleteNote'
  >;
  tags: Pick<TagRepository, 'countOwned'>;
  customFields: Pick<CustomFieldRepository, 'countOwned'>;
}

export class ContactService {
  private readonly contacts: ContactServiceDeps['contacts'];
  private readonly tags: ContactServiceDeps['tags'];
  private readonly customFields: ContactServiceDeps['customFields'];

  constructor(
    deps: ContactServiceDeps,
    private readonly userId: string,
  ) {
    this.contacts = deps.contacts;
    this.tags = deps.tags;
    this.customFields = deps.customFields;
  }

  static create(db: TenantDb, userId: string): ContactService {
    return new ContactService(
      {
        contacts: new ContactRepository(db),
        tags: new TagRepository(db),
        customFields: new CustomFieldRepository(db),
      },
      userId,
    );
  }

  async list(query: ListContactsQuery): Promise<Page<ContactDto>> {
    const filter: ContactListFilter = {
      search: query.search,
      tagIds: query.tagIds,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
    };
    const pagination: PaginationQuery = { page: query.page, pageSize: query.pageSize };
    const page = await this.contacts.list(filter, pagination);
    return { ...page, items: page.items.map(toContactDto) };
  }

  async getDetail(id: string): Promise<ContactDetailDto> {
    return toContactDetailDto(await this.contacts.findDetail(id));
  }

  /**
   * Rejects tag ids the tenant does not own. Without this the guard would
   * still stop the *read*, but `createMany` on the join table would fail
   * with an opaque foreign-key error instead of a clear 404.
   */
  private async assertTagsOwned(tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return;
    const unique = [...new Set(tagIds)];
    if ((await this.tags.countOwned(unique)) !== unique.length) {
      throw new NotFoundError('Tag');
    }
  }

  private async assertCustomFieldsOwned(fieldIds: string[]): Promise<void> {
    if (fieldIds.length === 0) return;
    const unique = [...new Set(fieldIds)];
    if ((await this.customFields.countOwned(unique)) !== unique.length) {
      throw new NotFoundError('Custom field');
    }
  }

  async create(body: CreateContactBody): Promise<ContactDto> {
    const existing = await this.contacts.findByPhone(body.phone);
    if (existing) {
      // 409 with the existing id so the client can offer "open the
      // existing contact" instead of a dead end.
      throw new ConflictError('A contact with this phone number already exists.', {
        details: { contactId: existing.id, phone: body.phone },
      });
    }

    await this.assertTagsOwned(body.tagIds ?? []);

    const contact = await this.contacts.create({
      phone: body.phone,
      name: body.name,
      email: body.email,
      company: body.company,
      avatarUrl: body.avatarUrl,
      userId: this.userId,
    });

    if (body.tagIds && body.tagIds.length > 0) {
      await this.contacts.replaceTags(contact.id, body.tagIds);
      return toContactDto(await this.contacts.findDetail(contact.id));
    }

    return toContactDto(contact);
  }

  async update(id: string, body: UpdateContactBody): Promise<ContactDto> {
    if (!(await this.contacts.exists(id))) throw new NotFoundError('Contact');

    if (body.phone !== undefined) {
      const existing = await this.contacts.findByPhone(body.phone);
      if (existing && existing.id !== id) {
        throw new ConflictError('Another contact already uses this phone number.', {
          details: { contactId: existing.id, phone: body.phone },
        });
      }
    }

    if (body.tagIds !== undefined) {
      await this.assertTagsOwned(body.tagIds);
    }

    const { tagIds, ...scalars } = body;
    if (Object.keys(scalars).length > 0) {
      await this.contacts.update(id, scalars);
    }
    if (tagIds !== undefined) {
      await this.contacts.replaceTags(id, tagIds);
    }

    return toContactDto(await this.contacts.findDetail(id));
  }

  async delete(id: string): Promise<void> {
    await this.contacts.delete(id);
  }

  async setCustomValues(id: string, body: SetContactCustomValuesBody): Promise<ContactDetailDto> {
    if (!(await this.contacts.exists(id))) throw new NotFoundError('Contact');
    await this.assertCustomFieldsOwned(body.values.map((entry) => entry.customFieldId));
    await this.contacts.setCustomValues(id, body.values);
    return this.getDetail(id);
  }

  async listNotes(id: string): Promise<ContactNoteDto[]> {
    if (!(await this.contacts.exists(id))) throw new NotFoundError('Contact');
    const notes = await this.contacts.listNotes(id);
    return notes.map(toContactNoteDto);
  }

  async addNote(id: string, body: CreateContactNoteBody): Promise<ContactNoteDto> {
    if (!(await this.contacts.exists(id))) throw new NotFoundError('Contact');
    const note = await this.contacts.createNote({
      contactId: id,
      userId: this.userId,
      noteText: body.noteText,
    });
    return toContactNoteDto(note);
  }

  async deleteNote(id: string, noteId: string): Promise<void> {
    await this.contacts.deleteNote(id, noteId);
  }

  /**
   * Bulk import.
   *
   * Behaviour the previous importer lacked entirely: phone normalisation,
   * format validation, in-file duplicate detection, cross-run duplicate
   * detection, and a per-row error report. Rows are validated up front so
   * one bad row cannot abort the batch.
   */
  async import(body: ImportContactsBody): Promise<ContactImportResultDto> {
    await this.assertTagsOwned(body.tagIds);

    const errors: ContactImportResultDto['errors'] = [];
    const seenInFile = new Set<string>();

    interface Candidate {
      row: number;
      phone: string;
      name: string | null;
      email: string | null;
      company: string | null;
    }

    const candidates: Candidate[] = [];

    body.rows.forEach((raw, index) => {
      const rowNumber = index + 1;
      const phone = sanitizePhoneForMeta(raw.phone);

      if (!isValidE164(phone)) {
        errors.push({ row: rowNumber, phone: raw.phone || null, reason: 'Invalid phone number format.' });
        return;
      }
      if (seenInFile.has(phone)) {
        errors.push({ row: rowNumber, phone, reason: 'Duplicate phone number within this file.' });
        return;
      }
      seenInFile.add(phone);

      candidates.push({
        row: rowNumber,
        phone,
        name: raw.name?.trim() || null,
        email: raw.email?.trim().toLowerCase() || null,
        company: raw.company?.trim() || null,
      });
    });

    const existingByPhone = await this.contacts.mapPhonesToIds(candidates.map((entry) => entry.phone));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const existingId = existingByPhone.get(candidate.phone);

      try {
        if (existingId) {
          if (body.onDuplicate === 'skip') {
            skipped += 1;
            continue;
          }
          await this.contacts.update(existingId, {
            // Only overwrite with a value that was actually supplied —
            // an import must never blank out data it has nothing for.
            ...(candidate.name !== null ? { name: candidate.name } : {}),
            ...(candidate.email !== null ? { email: candidate.email } : {}),
            ...(candidate.company !== null ? { company: candidate.company } : {}),
          });
          if (body.tagIds.length > 0) await this.contacts.addTags(existingId, body.tagIds);
          updated += 1;
          continue;
        }

        const contact = await this.contacts.create({
          phone: candidate.phone,
          name: candidate.name,
          email: candidate.email,
          company: candidate.company,
          avatarUrl: null,
          userId: this.userId,
        });
        if (body.tagIds.length > 0) await this.contacts.addTags(contact.id, body.tagIds);
        created += 1;
      } catch (error) {
        errors.push({
          row: candidate.row,
          phone: candidate.phone,
          reason: error instanceof Error ? error.message : 'Unknown error.',
        });
      }
    }

    return {
      created,
      updated,
      skipped,
      failed: errors.length,
      errors: errors.slice(0, 200),
    };
  }

  /**
   * Export feed. Deliberately not paginated at the DTO level — the
   * controller streams pages — but capped per call so a single request
   * cannot pull an unbounded table into memory, which is what the old
   * broadcast audience resolver did.
   */
  async page(pagination: PaginationQuery): Promise<Page<ContactDto>> {
    return this.list({
      ...pagination,
      search: undefined,
      tagIds: undefined,
      sortBy: 'createdAt',
      sortDirection: 'asc',
    });
  }

  /** Guard used by other services (broadcasts, deals) before referencing a contact. */
  async assertExists(id: string): Promise<void> {
    if (!(await this.contacts.exists(id))) throw new NotFoundError('Contact');
  }

  /** Surfaces a clear error when a tenant has no contacts to act on. */
  async assertAnyExist(): Promise<void> {
    const page = await this.contacts.list(
      { sortBy: 'createdAt', sortDirection: 'desc' },
      { page: 1, pageSize: 1 },
    );
    if (page.total === 0) {
      throw new ValidationError('This workspace has no contacts yet.');
    }
  }
}
