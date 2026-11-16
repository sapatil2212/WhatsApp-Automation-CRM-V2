import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, NotFoundError } from '../kernel';
import { ContactService, type ContactServiceDeps } from './contact.service';

const now = new Date('2026-05-22T10:30:00.000Z');

function contactRow(overrides: Partial<{ id: string; phone: string; name: string | null }> = {}) {
  return {
    id: overrides.id ?? 'contact-1',
    phone: overrides.phone ?? '919876543210',
    name: overrides.name ?? null,
    email: null,
    company: null,
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
    tags: [],
  };
}

function makeDeps() {
  const contacts = {
    list: vi.fn(),
    findDetail: vi.fn(async () => ({
      ...contactRow(),
      customValues: [],
      notes: [],
      conversations: [],
      deals: [],
    })),
    findByPhone: vi.fn(async () => null),
    mapPhonesToIds: vi.fn(async () => new Map<string, string>()),
    create: vi.fn(async () => contactRow()),
    update: vi.fn(async () => contactRow()),
    delete: vi.fn(async () => undefined),
    exists: vi.fn(async () => true),
    replaceTags: vi.fn(async () => undefined),
    addTags: vi.fn(async () => undefined),
    setCustomValues: vi.fn(async () => undefined),
    listNotes: vi.fn(async () => []),
    createNote: vi.fn(),
    deleteNote: vi.fn(async () => undefined),
  };
  const tags = { countOwned: vi.fn(async (ids: string[]) => ids.length) };
  const customFields = { countOwned: vi.fn(async (ids: string[]) => ids.length) };
  return { contacts, tags, customFields } as unknown as ContactServiceDeps & {
    contacts: typeof contacts;
    tags: typeof tags;
    customFields: typeof customFields;
  };
}

let deps: ReturnType<typeof makeDeps>;
let service: ContactService;

beforeEach(() => {
  deps = makeDeps();
  service = new ContactService(deps, 'user-1');
});

describe('create', () => {
  it('rejects a duplicate phone with 409 and the existing id', async () => {
    deps.contacts.findByPhone.mockResolvedValueOnce({ id: 'existing-1' } as never);

    await expect(
      service.create({
        phone: '919876543210',
        name: null,
        email: null,
        company: null,
        avatarUrl: null,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(deps.contacts.create).not.toHaveBeenCalled();
  });

  it('surfaces the existing contact id so the UI can offer to open it', async () => {
    deps.contacts.findByPhone.mockResolvedValueOnce({ id: 'existing-1' } as never);
    await service
      .create({ phone: '919876543210', name: null, email: null, company: null, avatarUrl: null })
      .catch((error: ConflictError) => {
        expect(error.details).toEqual({ contactId: 'existing-1', phone: '919876543210' });
      });
  });

  it('refuses tag ids the tenant does not own, before writing anything', async () => {
    deps.tags.countOwned.mockResolvedValueOnce(1); // asked for 2, owns 1

    await expect(
      service.create({
        phone: '919876543210',
        name: null,
        email: null,
        company: null,
        avatarUrl: null,
        tagIds: ['tag-mine', 'tag-theirs'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(deps.contacts.create).not.toHaveBeenCalled();
  });

  it('creates without touching the tag join table when no tags were supplied', async () => {
    await service.create({ phone: '919876543210', name: 'A', email: null, company: null, avatarUrl: null });
    expect(deps.contacts.create).toHaveBeenCalledOnce();
    expect(deps.contacts.replaceTags).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  it('404s when the contact is absent or belongs to another tenant', async () => {
    deps.contacts.exists.mockResolvedValueOnce(false);
    await expect(service.update('contact-1', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('allows a phone update that resolves to the same contact', async () => {
    deps.contacts.findByPhone.mockResolvedValueOnce({ id: 'contact-1' } as never);
    await expect(service.update('contact-1', { phone: '919876543210' })).resolves.toBeDefined();
  });

  it('rejects a phone update that collides with a different contact', async () => {
    deps.contacts.findByPhone.mockResolvedValueOnce({ id: 'contact-2' } as never);
    await expect(service.update('contact-1', { phone: '919876543210' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('replaces tags when tagIds is supplied and leaves them alone when it is not', async () => {
    await service.update('contact-1', { tagIds: ['tag-1'] });
    expect(deps.contacts.replaceTags).toHaveBeenCalledWith('contact-1', ['tag-1']);

    deps.contacts.replaceTags.mockClear();
    await service.update('contact-1', { name: 'B' });
    expect(deps.contacts.replaceTags).not.toHaveBeenCalled();
  });

  it('clears every tag when an empty list is sent explicitly', async () => {
    await service.update('contact-1', { tagIds: [] });
    expect(deps.contacts.replaceTags).toHaveBeenCalledWith('contact-1', []);
  });

  it('does not issue a scalar update when only tags changed', async () => {
    await service.update('contact-1', { tagIds: ['tag-1'] });
    expect(deps.contacts.update).not.toHaveBeenCalled();
  });
});

describe('setCustomValues', () => {
  it('refuses custom field ids the tenant does not own', async () => {
    deps.customFields.countOwned.mockResolvedValueOnce(0);
    await expect(
      service.setCustomValues('contact-1', { values: [{ customFieldId: 'cf-theirs', value: 'x' }] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(deps.contacts.setCustomValues).not.toHaveBeenCalled();
  });

  it('404s for a contact outside the tenant before validating fields', async () => {
    deps.contacts.exists.mockResolvedValueOnce(false);
    await expect(service.setCustomValues('contact-1', { values: [] })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('import', () => {
  const base = { onDuplicate: 'skip' as const, tagIds: [] };

  it('normalises phone formatting before comparing, so the same number is not imported twice', async () => {
    const result = await service.import({
      ...base,
      rows: [{ phone: '+91 98765 43210' }, { phone: '919876543210' }],
    });
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].reason).toBe('Duplicate phone number within this file.');
  });

  it('reports invalid rows by row number instead of aborting the batch', async () => {
    const result = await service.import({
      ...base,
      rows: [{ phone: 'garbage' }, { phone: '919876543210' }],
    });
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([{ row: 1, phone: 'garbage', reason: 'Invalid phone number format.' }]);
  });

  it('skips existing contacts under the skip policy', async () => {
    deps.contacts.mapPhonesToIds.mockResolvedValueOnce(new Map([['919876543210', 'contact-1']]));
    const result = await service.import({ ...base, rows: [{ phone: '919876543210', name: 'New Name' }] });
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1, failed: 0 });
    expect(deps.contacts.update).not.toHaveBeenCalled();
  });

  it('updates existing contacts under the update policy', async () => {
    deps.contacts.mapPhonesToIds.mockResolvedValueOnce(new Map([['919876543210', 'contact-1']]));
    const result = await service.import({
      ...base,
      onDuplicate: 'update',
      rows: [{ phone: '919876543210', name: 'New Name' }],
    });
    expect(result).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(deps.contacts.update).toHaveBeenCalledWith('contact-1', { name: 'New Name' });
  });

  it('never blanks out a field the import file has no value for', async () => {
    deps.contacts.mapPhonesToIds.mockResolvedValueOnce(new Map([['919876543210', 'contact-1']]));
    await service.import({ ...base, onDuplicate: 'update', rows: [{ phone: '919876543210' }] });
    expect(deps.contacts.update).toHaveBeenCalledWith('contact-1', {});
  });

  it('applies the requested tags to both created and updated contacts', async () => {
    deps.contacts.mapPhonesToIds.mockResolvedValueOnce(new Map([['919999999999', 'contact-9']]));
    await service.import({
      onDuplicate: 'update',
      tagIds: ['tag-1'],
      rows: [{ phone: '919876543210' }, { phone: '919999999999' }],
    });
    expect(deps.contacts.addTags).toHaveBeenCalledWith('contact-1', ['tag-1']);
    expect(deps.contacts.addTags).toHaveBeenCalledWith('contact-9', ['tag-1']);
  });

  it('validates tag ownership once, up front, rather than per row', async () => {
    deps.tags.countOwned.mockResolvedValueOnce(0);
    await expect(
      service.import({ onDuplicate: 'skip', tagIds: ['tag-theirs'], rows: [{ phone: '919876543210' }] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(deps.contacts.create).not.toHaveBeenCalled();
  });

  it('records a per-row failure when one insert throws, and keeps going', async () => {
    deps.contacts.create
      .mockRejectedValueOnce(new Error('deadlock'))
      .mockResolvedValueOnce(contactRow({ id: 'contact-2' }) as never);

    const result = await service.import({
      ...base,
      rows: [{ phone: '919876543210' }, { phone: '919999999999' }],
    });
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({ row: 1, reason: 'deadlock' });
  });

  it('caps the error report so a fully-invalid file cannot produce an unbounded response', async () => {
    const result = await service.import({
      ...base,
      rows: Array.from({ length: 300 }, () => ({ phone: 'bad' })),
    });
    expect(result.failed).toBe(300);
    expect(result.errors).toHaveLength(200);
  });

  it('normalises email casing on import', async () => {
    await service.import({ ...base, rows: [{ phone: '919876543210', email: 'A@B.COM' }] });
    expect(deps.contacts.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@b.com' }));
  });
});
