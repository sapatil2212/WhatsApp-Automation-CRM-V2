import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../kernel';
import { BroadcastService, MAX_AUDIENCE_SIZE, type BroadcastServiceDeps } from './broadcast.service';

const now = new Date('2026-05-22T10:00:00.000Z');

function broadcastRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bc-1',
    name: 'Summer sale',
    templateName: 'summer_sale',
    templateLanguage: 'en_US',
    templateVariables: { '1': 'Asha' },
    audienceFilter: { type: 'all' },
    scheduledAt: null,
    status: 'draft',
    totalRecipients: 3,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    repliedCount: 0,
    failedCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface ClaimedRecipient {
  id: string;
  contactId: string;
  contact: { id: string; phone: string; name: string | null } | null;
}

interface RecordResultInput {
  broadcastId: string;
  recipientId: string;
  status: 'sent' | 'failed';
  at: Date;
  errorMessage?: string | null;
}

function makeDeps() {
  const broadcasts = {
    list: vi.fn(),
    findById: vi.fn(async () => broadcastRow()),
    create: vi.fn(async () => broadcastRow()),
    update: vi.fn(async () => broadcastRow()),
    transitionStatus: vi.fn(async () => true),
    delete: vi.fn(async () => undefined),
    addRecipients: vi.fn(async (_id: string, ids: string[]) => ids.length),
    listRecipients: vi.fn(),
    claimPendingBatch: vi.fn(async (): Promise<ClaimedRecipient[]> => []),
    countPending: vi.fn(async () => 0),
    // Explicit signature so `mock.calls[0][0]` is typed rather than `[]`.
    recordRecipientResult: vi.fn(async (_input: RecordResultInput): Promise<void> => undefined),
    advanceRecipientStatus: vi.fn(async () => true),
    findRecipientByWhatsappMessageId: vi.fn(
      async (): Promise<{ id: string; broadcastId: string; status: string } | null> => null,
    ),
    findRecipientsForContact: vi.fn(),
    findDueScheduled: vi.fn(async (): Promise<Array<{ id: string; status: string }>> => []),
  };
  const audience = {
    buildWhere: vi.fn(),
    count: vi.fn(async () => 3),
    countBeforeExclusions: vi.fn(async () => 5),
    sample: vi.fn(async () => [{ id: 'c-1', phone: '9199', name: 'Asha' }]),
    // Without the annotation `nextCursor` infers as `null` and every
    // cursor-bearing mockResolvedValueOnce below fails to type-check.
    pageIds: vi.fn(
      async (): Promise<{ ids: string[]; nextCursor: string | null }> => ({
        ids: ['c-1', 'c-2', 'c-3'],
        nextCursor: null,
      }),
    ),
  };
  const templates = { assertSendable: vi.fn(async () => ({}) as never) };
  const transport = {
    sendTemplate: vi.fn(async () => ({ whatsappMessageId: 'wamid.X' })),
  };
  return { broadcasts, audience, templates, transport } as unknown as BroadcastServiceDeps & {
    broadcasts: typeof broadcasts;
    audience: typeof audience;
    templates: typeof templates;
    transport: typeof transport;
  };
}

let deps: ReturnType<typeof makeDeps>;
let service: BroadcastService;

beforeEach(() => {
  deps = makeDeps();
  service = new BroadcastService(deps, 'user-1');
});

describe('previewAudience', () => {
  it('reports reach, exclusions and a sample', async () => {
    expect(await service.previewAudience({ type: 'all' })).toEqual({
      reach: 3,
      excluded: 2,
      sample: [{ id: 'c-1', phone: '9199', name: 'Asha' }],
    });
  });

  it('never reports negative exclusions', async () => {
    deps.audience.countBeforeExclusions.mockResolvedValueOnce(1);
    expect((await service.previewAudience({ type: 'all' })).excluded).toBe(0);
  });
});

describe('create', () => {
  const body = {
    name: 'Summer sale',
    templateName: 'summer_sale',
    templateLanguage: 'en_US',
    templateVariables: ['Asha'],
    audience: { type: 'all' as const },
  };

  it('refuses a template that is not approved, before anything is written', async () => {
    deps.templates.assertSendable.mockRejectedValueOnce(new ConflictError('not approved'));
    await expect(service.create(body)).rejects.toBeInstanceOf(ConflictError);
    expect(deps.broadcasts.create).not.toHaveBeenCalled();
  });

  it('refuses an audience that matches nobody', async () => {
    deps.audience.count.mockResolvedValueOnce(0);
    await expect(service.create(body)).rejects.toBeInstanceOf(ValidationError);
    expect(deps.broadcasts.create).not.toHaveBeenCalled();
  });

  it('refuses an audience above the per-campaign ceiling', async () => {
    deps.audience.count.mockResolvedValueOnce(MAX_AUDIENCE_SIZE + 1);
    await expect(service.create(body)).rejects.toBeInstanceOf(ValidationError);
  });

  it('freezes the audience into recipient rows at creation time', async () => {
    await service.create(body);
    expect(deps.broadcasts.addRecipients).toHaveBeenCalledWith('bc-1', ['c-1', 'c-2', 'c-3']);
  });

  it('materialises in batches, following the keyset cursor', async () => {
    deps.audience.pageIds
      .mockResolvedValueOnce({ ids: ['c-1', 'c-2'], nextCursor: 'c-2' })
      .mockResolvedValueOnce({ ids: ['c-3'], nextCursor: null });

    await service.create(body);
    expect(deps.audience.pageIds).toHaveBeenNthCalledWith(1, { type: 'all' }, 500, undefined);
    expect(deps.audience.pageIds).toHaveBeenNthCalledWith(2, { type: 'all' }, 500, 'c-2');
    expect(deps.broadcasts.addRecipients).toHaveBeenCalledTimes(2);
  });

  it('stores positional variables in the map shape the column already uses', async () => {
    await service.create({ ...body, templateVariables: ['Asha', 'A-1'] });
    expect(deps.broadcasts.create).toHaveBeenCalledWith(
      expect.objectContaining({ templateVariables: { '1': 'Asha', '2': 'A-1' } }),
    );
  });

  it('starts as draft with no schedule, and scheduled with one', async () => {
    await service.create(body);
    expect(deps.broadcasts.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));

    deps.broadcasts.create.mockClear();
    const future = new Date(Date.now() + 3_600_000);
    await service.create({ ...body, scheduledAt: future });
    expect(deps.broadcasts.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'scheduled', scheduledAt: future }),
    );
  });
});

describe('update', () => {
  it('refuses to edit a campaign that has started', async () => {
    deps.broadcasts.findById.mockResolvedValueOnce(broadcastRow({ status: 'sending' }) as never);
    await expect(service.update('bc-1', { name: 'x' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to edit a sent campaign', async () => {
    deps.broadcasts.findById.mockResolvedValueOnce(broadcastRow({ status: 'sent' }) as never);
    await expect(service.update('bc-1', { name: 'x' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses an audience change, which would desync the frozen recipient set', async () => {
    await expect(service.update('bc-1', { audience: { type: 'all' } })).rejects.toBeInstanceOf(ConflictError);
  });

  it('re-checks template approval when the template changes', async () => {
    await service.update('bc-1', { templateName: 'other_template' });
    expect(deps.templates.assertSendable).toHaveBeenCalled();
  });

  it('clearing the schedule returns the campaign to draft', async () => {
    await service.update('bc-1', { scheduledAt: null });
    expect(deps.broadcasts.update).toHaveBeenCalledWith(
      'bc-1',
      expect.objectContaining({ scheduledAt: null, status: 'draft' }),
    );
  });
});

describe('delete', () => {
  it('refuses while sending', async () => {
    deps.broadcasts.findById.mockResolvedValueOnce(broadcastRow({ status: 'sending' }) as never);
    await expect(service.delete('bc-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows deleting a sent campaign, keeping the report removable', async () => {
    deps.broadcasts.findById.mockResolvedValueOnce(broadcastRow({ status: 'sent' }) as never);
    await service.delete('bc-1');
    expect(deps.broadcasts.delete).toHaveBeenCalledWith('bc-1');
  });
});

describe('start', () => {
  it('claims the campaign with a conditional status update', async () => {
    await service.start('bc-1');
    expect(deps.broadcasts.transitionStatus).toHaveBeenCalledWith('bc-1', 'draft', 'sending');
  });

  it('rejects a second concurrent start', async () => {
    deps.broadcasts.transitionStatus.mockResolvedValueOnce(false);
    await expect(service.start('bc-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to restart a sent campaign', async () => {
    deps.broadcasts.findById.mockResolvedValueOnce(broadcastRow({ status: 'sent' }) as never);
    await expect(service.start('bc-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('re-validates template approval at start, not just at creation', async () => {
    await service.start('bc-1');
    expect(deps.templates.assertSendable).toHaveBeenCalledWith('summer_sale', 'en_US', ['Asha']);
  });
});

describe('dispatch', () => {
  beforeEach(() => {
    deps.broadcasts.findById.mockResolvedValue(broadcastRow({ status: 'sending' }) as never);
  });

  it('refuses when the campaign is not in sending', async () => {
    deps.broadcasts.findById.mockResolvedValue(broadcastRow({ status: 'draft' }) as never);
    await expect(service.dispatch('bc-1', 50)).rejects.toBeInstanceOf(ConflictError);
  });

  it('sends each claimed recipient and records the result', async () => {
    deps.broadcasts.claimPendingBatch.mockResolvedValueOnce([
      { id: 'r-1', contactId: 'c-1', contact: { id: 'c-1', phone: '9199', name: 'A' } },
      { id: 'r-2', contactId: 'c-2', contact: { id: 'c-2', phone: '9188', name: 'B' } },
    ] as never);

    const result = await service.dispatch('bc-1', 50);
    expect(deps.transport.sendTemplate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ attempted: 2, sent: 2, failed: 0 });
  });

  it('records Meta’s message id so the delivery webhook can correlate later', async () => {
    deps.broadcasts.claimPendingBatch.mockResolvedValueOnce([
      { id: 'r-1', contactId: 'c-1', contact: { id: 'c-1', phone: '9199', name: 'A' } },
    ] as never);

    await service.dispatch('bc-1', 50);
    expect(deps.broadcasts.recordRecipientResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', whatsappMessageId: 'wamid.X' }),
    );
  });

  it('passes the stored template variables to every send', async () => {
    deps.broadcasts.claimPendingBatch.mockResolvedValueOnce([
      { id: 'r-1', contactId: 'c-1', contact: { id: 'c-1', phone: '9199', name: 'A' } },
    ] as never);

    await service.dispatch('bc-1', 50);
    expect(deps.transport.sendTemplate).toHaveBeenCalledWith({
      to: '9199',
      templateName: 'summer_sale',
      language: 'en_US',
      params: ['Asha'],
    });
  });

  it('records a per-recipient failure and keeps going', async () => {
    deps.broadcasts.claimPendingBatch.mockResolvedValueOnce([
      { id: 'r-1', contactId: 'c-1', contact: { id: 'c-1', phone: '9199', name: 'A' } },
      { id: 'r-2', contactId: 'c-2', contact: { id: 'c-2', phone: '9188', name: 'B' } },
    ] as never);
    deps.transport.sendTemplate.mockRejectedValueOnce(new Error('#131030 not in allowed list'));

    const result = await service.dispatch('bc-1', 50);
    expect(result).toMatchObject({ attempted: 2, sent: 1, failed: 1 });
    expect(deps.broadcasts.recordRecipientResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: '#131030 not in allowed list' }),
    );
  });

  it('fails a recipient with no phone number without calling Meta', async () => {
    deps.broadcasts.claimPendingBatch.mockResolvedValueOnce([
      { id: 'r-1', contactId: 'c-1', contact: { id: 'c-1', phone: '', name: null } },
    ] as never);

    const result = await service.dispatch('bc-1', 50);
    expect(deps.transport.sendTemplate).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it('reports hasMore while recipients remain, so the caller loops', async () => {
    deps.broadcasts.countPending.mockResolvedValueOnce(120);
    expect((await service.dispatch('bc-1', 50)).hasMore).toBe(true);
    expect(deps.broadcasts.transitionStatus).not.toHaveBeenCalled();
  });

  it('finalises the campaign on the pass that drains the queue', async () => {
    deps.broadcasts.countPending.mockResolvedValueOnce(0);
    deps.broadcasts.findById.mockResolvedValue(
      broadcastRow({ status: 'sending', totalRecipients: 2, sentCount: 2 }) as never,
    );

    const result = await service.dispatch('bc-1', 50);
    expect(result.hasMore).toBe(false);
    expect(deps.broadcasts.transitionStatus).toHaveBeenCalledWith('bc-1', 'sending', 'sent');
  });

  it('marks a campaign failed when nothing got out — not sent', async () => {
    deps.broadcasts.countPending.mockResolvedValueOnce(0);
    deps.broadcasts.findById.mockResolvedValue(
      broadcastRow({ status: 'sending', totalRecipients: 2, sentCount: 0, failedCount: 2 }) as never,
    );

    await service.dispatch('bc-1', 50);
    expect(deps.broadcasts.transitionStatus).toHaveBeenCalledWith('bc-1', 'sending', 'failed');
  });

  it('refuses to dispatch without a transport', async () => {
    const noTransport = new BroadcastService({ ...deps, transport: undefined }, 'user-1');
    await expect(noTransport.dispatch('bc-1', 50)).rejects.toBeInstanceOf(ValidationError);
  });

  it('truncates a very long upstream error so it fits the column', async () => {
    deps.broadcasts.claimPendingBatch.mockResolvedValueOnce([
      { id: 'r-1', contactId: 'c-1', contact: { id: 'c-1', phone: '9199', name: 'A' } },
    ] as never);
    deps.transport.sendTemplate.mockRejectedValueOnce(new Error('x'.repeat(900)));

    await service.dispatch('bc-1', 50);
    const call = deps.broadcasts.recordRecipientResult.mock.calls[0][0];
    expect(call.errorMessage).toHaveLength(500);
  });
});

describe('applyDeliveryStatusByWhatsappMessageId', () => {
  it('resolves the recipient from Meta’s id and applies the transition', async () => {
    deps.broadcasts.findRecipientByWhatsappMessageId.mockResolvedValueOnce({
      id: 'r-1',
      broadcastId: 'bc-1',
      status: 'sent',
    } as never);

    const applied = await service.applyDeliveryStatusByWhatsappMessageId({
      whatsappMessageId: 'wamid.X',
      incomingStatus: 'delivered',
      at: now,
    });

    expect(applied).toBe(true);
    expect(deps.broadcasts.advanceRecipientStatus).toHaveBeenCalledWith({
      recipientId: 'r-1',
      broadcastId: 'bc-1',
      from: 'sent',
      to: 'delivered',
      at: now,
    });
  });

  it('ignores a message id that belongs to no campaign — an ordinary inbox message', async () => {
    deps.broadcasts.findRecipientByWhatsappMessageId.mockResolvedValueOnce(null as never);

    const applied = await service.applyDeliveryStatusByWhatsappMessageId({
      whatsappMessageId: 'wamid.INBOX',
      incomingStatus: 'read',
      at: now,
    });

    expect(applied).toBe(false);
    expect(deps.broadcasts.advanceRecipientStatus).not.toHaveBeenCalled();
  });

  it('drops an out-of-order callback for a campaign recipient', async () => {
    deps.broadcasts.findRecipientByWhatsappMessageId.mockResolvedValueOnce({
      id: 'r-1',
      broadcastId: 'bc-1',
      status: 'read',
    } as never);

    const applied = await service.applyDeliveryStatusByWhatsappMessageId({
      whatsappMessageId: 'wamid.X',
      incomingStatus: 'delivered',
      at: now,
    });

    expect(applied).toBe(false);
  });
});

describe('applyDeliveryStatus', () => {
  it('applies a forward transition', async () => {
    const applied = await service.applyDeliveryStatus({
      recipientId: 'r-1',
      broadcastId: 'bc-1',
      currentStatus: 'sent',
      incomingStatus: 'delivered',
      at: now,
    });
    expect(applied).toBe(true);
    expect(deps.broadcasts.advanceRecipientStatus).toHaveBeenCalled();
  });

  it('drops a backwards transition without touching the database', async () => {
    const applied = await service.applyDeliveryStatus({
      recipientId: 'r-1',
      broadcastId: 'bc-1',
      currentStatus: 'read',
      incomingStatus: 'delivered',
      at: now,
    });
    expect(applied).toBe(false);
    expect(deps.broadcasts.advanceRecipientStatus).not.toHaveBeenCalled();
  });
});
