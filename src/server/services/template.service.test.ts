import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, ExternalApiError, NotFoundError, ValidationError } from '../kernel';
import {
  TemplateService,
  type MetaTemplateSummary,
  type TemplateServiceDeps,
} from './template.service';

const now = new Date('2026-05-22T10:00:00.000Z');

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'order_update',
    category: 'Utility',
    language: 'en_US',
    headerType: null,
    headerContent: null,
    bodyText: 'Hi {{1}}, your order is ready.',
    footerText: null,
    buttons: null,
    status: 'Approved',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDeps() {
  const templates = {
    list: vi.fn(),
    findById: vi.fn(async () => templateRow()),
    findByNameAndLanguage: vi.fn(async () => templateRow()),
    upsertByNameAndLanguage: vi.fn(async () => templateRow()),
    updateStatus: vi.fn(),
    delete: vi.fn(async () => undefined),
    countByStatus: vi.fn(),
  };
  // Explicit return type: an inferred `templates: never[]` from the
  // default mock would reject every `mockResolvedValueOnce` below.
  const transport = {
    submit: vi.fn(async () => ({ status: 'PENDING' })),
    remove: vi.fn(async () => undefined),
    listAll: vi.fn(
      async (): Promise<{ templates: MetaTemplateSummary[]; truncated: boolean }> => ({
        templates: [],
        truncated: false,
      }),
    ),
  };
  return { templates, transport } as unknown as TemplateServiceDeps & {
    templates: typeof templates;
    transport: typeof transport;
  };
}

let deps: ReturnType<typeof makeDeps>;
let service: TemplateService;

beforeEach(() => {
  deps = makeDeps();
  service = new TemplateService(deps, 'user-1');
});

describe('assertSendable', () => {
  it('accepts an approved template with the right number of variables', async () => {
    const dto = await service.assertSendable('order_update', 'en_US', ['Asha']);
    expect(dto.sendable).toBe(true);
    expect(dto.variableCount).toBe(1);
  });

  it('404s when the template is not in the local catalog', async () => {
    deps.templates.findByNameAndLanguage.mockResolvedValueOnce(null as never);
    await expect(service.assertSendable('missing', 'en_US')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a Draft template — the gate the broadcast wizard never had', async () => {
    deps.templates.findByNameAndLanguage.mockResolvedValueOnce(templateRow({ status: 'Draft' }) as never);
    await expect(service.assertSendable('order_update', 'en_US', ['Asha'])).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses a Pending template', async () => {
    deps.templates.findByNameAndLanguage.mockResolvedValueOnce(templateRow({ status: 'Pending' }) as never);
    await expect(service.assertSendable('order_update', 'en_US', ['Asha'])).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses a Rejected template and names the status', async () => {
    deps.templates.findByNameAndLanguage.mockResolvedValueOnce(templateRow({ status: 'Rejected' }) as never);
    await service.assertSendable('order_update', 'en_US', ['Asha']).catch((error: ConflictError) => {
      expect(error.details).toMatchObject({ status: 'Rejected' });
    });
  });

  it('rejects a send with too few variable values, before Meta does', async () => {
    await expect(service.assertSendable('order_update', 'en_US', [])).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('submit', () => {
  const body = {
    name: 'Order Update',
    category: 'Utility' as const,
    language: 'en_US',
    headerType: 'none' as const,
    bodyText: 'Your order is ready.',
  };

  it('normalises the name before submitting to Meta', async () => {
    await service.submit(body);
    expect(deps.transport.submit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'order_update', category: 'UTILITY' }),
    );
  });

  it('persists only after Meta accepts', async () => {
    deps.transport.submit.mockRejectedValueOnce(new Error('body too long'));
    await expect(service.submit(body)).rejects.toBeInstanceOf(ExternalApiError);
    expect(deps.templates.upsertByNameAndLanguage).not.toHaveBeenCalled();
  });

  it('surfaces Meta’s reason rather than a generic failure', async () => {
    deps.transport.submit.mockRejectedValueOnce(new Error('sample missing for {{1}}'));
    await service.submit(body).catch((error: ExternalApiError) => {
      expect(error.message).toContain('sample missing for {{1}}');
      expect(error.status).toBe(502);
    });
  });

  it('stores the status Meta reported, not an assumed one', async () => {
    deps.transport.submit.mockResolvedValueOnce({ status: 'APPROVED' });
    await service.submit(body);
    expect(deps.templates.upsertByNameAndLanguage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Approved' }),
    );
  });

  it('rejects an invalid template before any network call', async () => {
    await expect(service.submit({ ...body, bodyText: '   ' })).rejects.toBeInstanceOf(ValidationError);
    expect(deps.transport.submit).not.toHaveBeenCalled();
  });

  it('stores header content only for a text header', async () => {
    await service.submit({ ...body, headerType: 'text', headerText: 'Update' });
    expect(deps.templates.upsertByNameAndLanguage).toHaveBeenCalledWith(
      expect.objectContaining({ headerType: 'text', headerContent: 'Update' }),
    );

    deps.templates.upsertByNameAndLanguage.mockClear();
    await service.submit({ ...body, headerType: 'image', headerExample: 'https://x.com/a.png' });
    expect(deps.templates.upsertByNameAndLanguage).toHaveBeenCalledWith(
      expect.objectContaining({ headerType: 'image', headerContent: null }),
    );
  });

  it('fails with a clear message when WhatsApp is not connected', async () => {
    const noTransport = new TemplateService({ templates: deps.templates }, 'user-1');
    await expect(noTransport.submit(body)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('syncFromMeta', () => {
  it('counts inserts and updates separately', async () => {
    deps.transport.listAll.mockResolvedValueOnce({
      templates: [
        {
          name: 'existing',
          language: 'en_US',
          category: 'MARKETING',
          status: 'APPROVED',
          components: [{ type: 'BODY', text: 'hello' }],
        },
        {
          name: 'brand_new',
          language: 'en_US',
          category: 'UTILITY',
          status: 'PENDING',
          components: [{ type: 'BODY', text: 'hi' }],
        },
      ],
      truncated: false,
    });
    deps.templates.findByNameAndLanguage
      .mockResolvedValueOnce(templateRow() as never)
      .mockResolvedValueOnce(null as never);

    expect(await service.syncFromMeta()).toEqual({
      inserted: 1,
      updated: 1,
      failed: 0,
      truncated: false,
    });
  });

  it('keeps going when one remote template is malformed', async () => {
    deps.transport.listAll.mockResolvedValueOnce({
      templates: [
        { name: 'bad', language: 'en_US', category: 'MARKETING', status: 'APPROVED', components: [] },
        { name: 'good', language: 'en_US', category: 'MARKETING', status: 'APPROVED', components: [] },
      ],
      truncated: false,
    });
    deps.templates.upsertByNameAndLanguage
      .mockRejectedValueOnce(new Error('bad row'))
      .mockResolvedValueOnce(templateRow() as never);

    const result = await service.syncFromMeta();
    expect(result.failed).toBe(1);
    expect(result.inserted + result.updated).toBe(1);
  });

  it('parses Meta components back into flat storage fields', async () => {
    deps.transport.listAll.mockResolvedValueOnce({
      templates: [
        {
          name: 'rich',
          language: 'en_US',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Header here' },
            { type: 'BODY', text: 'Body here' },
            { type: 'FOOTER', text: 'Footer here' },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ok' }] },
          ],
        },
      ],
      truncated: false,
    });
    deps.templates.findByNameAndLanguage.mockResolvedValueOnce(null as never);

    await service.syncFromMeta();
    expect(deps.templates.upsertByNameAndLanguage).toHaveBeenCalledWith(
      expect.objectContaining({
        headerType: 'text',
        headerContent: 'Header here',
        bodyText: 'Body here',
        footerText: 'Footer here',
        category: 'Utility',
        status: 'Approved',
      }),
    );
  });

  it('reports truncation so the operator knows the catalog is incomplete', async () => {
    deps.transport.listAll.mockResolvedValueOnce({ templates: [], truncated: true });
    expect((await service.syncFromMeta()).truncated).toBe(true);
  });

  it('surfaces an upstream listing failure as a 502', async () => {
    deps.transport.listAll.mockRejectedValueOnce(new Error('token expired'));
    await expect(service.syncFromMeta()).rejects.toBeInstanceOf(ExternalApiError);
  });
});

describe('delete', () => {
  it('removes upstream then locally for a submitted template', async () => {
    await service.delete('tpl-1');
    expect(deps.transport.remove).toHaveBeenCalledWith({ name: 'order_update' });
    expect(deps.templates.delete).toHaveBeenCalledWith('tpl-1');
  });

  it('skips the upstream call for a local Draft', async () => {
    deps.templates.findById.mockResolvedValueOnce(templateRow({ status: 'Draft' }) as never);
    await service.delete('tpl-1');
    expect(deps.transport.remove).not.toHaveBeenCalled();
    expect(deps.templates.delete).toHaveBeenCalled();
  });

  it('still deletes locally when Meta reports the template is already gone', async () => {
    deps.transport.remove.mockRejectedValueOnce(new Error('not found'));
    await service.delete('tpl-1');
    expect(deps.templates.delete).toHaveBeenCalledWith('tpl-1');
  });
});
