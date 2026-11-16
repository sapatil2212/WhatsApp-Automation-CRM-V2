import { describe, expect, it } from 'vitest';

import {
  contactDetailDtoSchema,
  contactDtoSchema,
  customFieldDtoSchema,
  tagDtoSchema,
  toContactDetailDto,
  toContactDto,
  toContactNoteDto,
  toCustomFieldDto,
  toTagDto,
} from './contact.dto';

const now = new Date('2026-05-22T10:30:00.000Z');

const tagRow = { id: 'tag-1', name: 'VIP', color: '#3b82f6', createdAt: now };

describe('toTagDto', () => {
  it('matches its own schema', () => {
    expect(tagDtoSchema.safeParse(toTagDto(tagRow)).success).toBe(true);
  });

  it('reports null contactCount when the count was not selected', () => {
    expect(toTagDto(tagRow).contactCount).toBeNull();
  });

  it('surfaces the contact count when present, so deletes can warn first', () => {
    expect(toTagDto({ ...tagRow, _count: { contacts: 12 } }).contactCount).toBe(12);
  });
});

describe('toContactDto', () => {
  const row = {
    id: 'contact-1',
    phone: '919876543210',
    name: 'Asha',
    email: null,
    company: null,
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
    tags: [{ tag: tagRow }],
  };

  it('matches its own schema', () => {
    expect(contactDtoSchema.safeParse(toContactDto(row)).success).toBe(true);
  });

  it('flattens the tag join table into a plain tag list', () => {
    expect(toContactDto(row).tags).toEqual([toTagDto(tagRow)]);
  });

  it('emits an empty tag list rather than undefined when tags were not included', () => {
    expect(toContactDto({ ...row, tags: undefined }).tags).toEqual([]);
  });

  it('never leaks ownership columns to the client', () => {
    const dto = toContactDto({ ...row, tenantId: 'tenant-1', userId: 'user-1' } as typeof row);
    expect(Object.keys(dto)).not.toContain('tenantId');
    expect(Object.keys(dto)).not.toContain('userId');
  });

  it('serialises dates as ISO strings', () => {
    expect(toContactDto(row).createdAt).toBe('2026-05-22T10:30:00.000Z');
  });
});

describe('toContactDetailDto', () => {
  const row = {
    id: 'contact-1',
    phone: '919876543210',
    name: 'Asha',
    email: 'asha@example.com',
    company: 'Acme',
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
    tags: [{ tag: tagRow }],
    customValues: [
      { customFieldId: 'cf-1', value: 'gold', customField: { fieldName: 'Tier', fieldType: 'text' } },
    ],
    notes: [{ id: 'n-1', contactId: 'contact-1', userId: 'u-1', noteText: 'Called back', createdAt: now }],
    conversations: [{ id: 'conv-1' }],
    deals: [{ id: 'd-1' }, { id: 'd-2' }],
  };

  it('matches its own schema', () => {
    expect(contactDetailDtoSchema.safeParse(toContactDetailDto(row)).success).toBe(true);
  });

  it('exposes the newest conversation id so the UI can deep-link to the inbox', () => {
    expect(toContactDetailDto(row).conversationId).toBe('conv-1');
  });

  it('reports null when the contact has never had a conversation', () => {
    expect(toContactDetailDto({ ...row, conversations: [] }).conversationId).toBeNull();
  });

  it('counts open deals', () => {
    expect(toContactDetailDto(row).openDealCount).toBe(2);
  });

  it('resolves the custom field name and type from the joined definition', () => {
    expect(toContactDetailDto(row).customValues[0]).toEqual({
      customFieldId: 'cf-1',
      fieldName: 'Tier',
      fieldType: 'text',
      value: 'gold',
    });
  });
});

describe('toCustomFieldDto', () => {
  it('matches its own schema', () => {
    const dto = toCustomFieldDto({
      id: 'cf-1',
      fieldName: 'Tier',
      fieldType: 'select',
      fieldOptions: ['gold', 'silver'],
      createdAt: now,
    });
    expect(customFieldDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto.fieldOptions).toEqual(['gold', 'silver']);
  });

  it('degrades an unknown legacy field type to text instead of failing the response', () => {
    const dto = toCustomFieldDto({
      id: 'cf-2',
      fieldName: 'Legacy',
      fieldType: 'multiselect',
      fieldOptions: null,
      createdAt: now,
    });
    expect(dto.fieldType).toBe('text');
    expect(dto.fieldOptions).toEqual([]);
  });

  it('drops non-string entries from a malformed options column', () => {
    const dto = toCustomFieldDto({
      id: 'cf-3',
      fieldName: 'Mixed',
      fieldType: 'select',
      fieldOptions: ['a', 3, null],
      createdAt: now,
    });
    expect(dto.fieldOptions).toEqual(['a']);
  });
});

describe('toContactNoteDto', () => {
  it('always exposes an author block, even when the profile join is absent', () => {
    const dto = toContactNoteDto({
      id: 'n-1',
      contactId: 'c-1',
      userId: 'u-1',
      noteText: 'hi',
      createdAt: now,
    });
    expect(dto.author).toEqual({ userId: 'u-1', fullName: null });
  });
});
