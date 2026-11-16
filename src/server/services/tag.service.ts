/**
 * Tag and custom-field-definition rules.
 *
 * Names are unique per tenant. The previous UI had no tag CRUD surface at
 * all beyond Settings and no uniqueness check anywhere, so duplicate tags
 * with different colours were common and the audience filter matched only
 * one of them.
 */

import { ConflictError, type TenantDb } from '../kernel';
import {
  toCustomFieldDto,
  toTagDto,
  type CustomFieldDto,
  type TagDto,
} from '../dtos/contact.dto';
import { CustomFieldRepository, TagRepository } from '../repositories/tag.repository';
import type {
  CreateCustomFieldBody,
  CreateTagBody,
  UpdateCustomFieldBody,
  UpdateTagBody,
} from '../validators/contact.validator';

export type TagServiceDeps = Pick<TagRepository, 'list' | 'create' | 'update' | 'delete' | 'findByName'>;

export class TagService {
  constructor(
    private readonly tags: TagServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string): TagService {
    return new TagService(new TagRepository(db), userId);
  }

  async list(): Promise<TagDto[]> {
    return (await this.tags.list()).map(toTagDto);
  }

  async create(body: CreateTagBody): Promise<TagDto> {
    const existing = await this.tags.findByName(body.name);
    if (existing) {
      throw new ConflictError('A tag with this name already exists.', {
        details: { tagId: existing.id },
      });
    }
    return toTagDto(await this.tags.create({ name: body.name, color: body.color, userId: this.userId }));
  }

  async update(id: string, body: UpdateTagBody): Promise<TagDto> {
    if (body.name !== undefined) {
      const existing = await this.tags.findByName(body.name);
      if (existing && existing.id !== id) {
        throw new ConflictError('Another tag already uses this name.', { details: { tagId: existing.id } });
      }
    }
    return toTagDto(await this.tags.update(id, body));
  }

  /**
   * Deleting a tag detaches it from every contact via the join table's
   * cascade. That is intentional and irreversible, so the controller
   * surfaces the affected contact count first (`contactCount` on the list
   * DTO) rather than the client guessing.
   */
  async delete(id: string): Promise<void> {
    await this.tags.delete(id);
  }
}

export type CustomFieldServiceDeps = Pick<
  CustomFieldRepository,
  'list' | 'create' | 'update' | 'delete' | 'findByName'
>;

export class CustomFieldService {
  constructor(
    private readonly fields: CustomFieldServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string): CustomFieldService {
    return new CustomFieldService(new CustomFieldRepository(db), userId);
  }

  async list(): Promise<CustomFieldDto[]> {
    return (await this.fields.list()).map(toCustomFieldDto);
  }

  async create(body: CreateCustomFieldBody): Promise<CustomFieldDto> {
    const existing = await this.fields.findByName(body.fieldName);
    if (existing) {
      throw new ConflictError('A custom field with this name already exists.', {
        details: { customFieldId: existing.id },
      });
    }
    return toCustomFieldDto(
      await this.fields.create({
        fieldName: body.fieldName,
        fieldType: body.fieldType,
        fieldOptions: body.fieldOptions,
        userId: this.userId,
      }),
    );
  }

  /**
   * `fieldType` is intentionally immutable. Changing it would silently
   * invalidate every stored value (a `select` field whose options no
   * longer include the stored string, a `number` field holding text).
   * Callers delete and recreate instead.
   */
  async update(id: string, body: UpdateCustomFieldBody): Promise<CustomFieldDto> {
    if (body.fieldName !== undefined) {
      const existing = await this.fields.findByName(body.fieldName);
      if (existing && existing.id !== id) {
        throw new ConflictError('Another custom field already uses this name.', {
          details: { customFieldId: existing.id },
        });
      }
    }
    return toCustomFieldDto(await this.fields.update(id, body));
  }

  async delete(id: string): Promise<void> {
    await this.fields.delete(id);
  }
}
