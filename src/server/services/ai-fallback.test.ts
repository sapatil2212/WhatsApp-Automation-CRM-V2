import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifyTenant = vi.fn();
vi.mock('./booking-notify', () => ({ notifyTenant: (...args: unknown[]) => notifyTenant(...args) }));

const sendText = vi.fn(async () => ({ messageId: 'm1' }));
const resolveTarget = vi.fn(async () => ({ conversationId: 'conv-1', contactId: 'c-1', phone: '+1' }));
vi.mock('./outbound.service', () => ({
  OutboundMessageService: { create: () => ({ resolveTarget, sendText }) },
}));

import { AI_FALLBACK_TEXT, sendAiFallback } from './ai-fallback';

function db(recent: boolean) {
  return {
    message: { findFirst: vi.fn(async () => (recent ? { id: 'prev' } : null)) },
    conversation: { update: vi.fn(async () => ({})) },
  };
}

const base = {
  userId: 'u-1',
  tenantId: 't-1',
  transport: {} as never,
  contactId: 'c-1',
  conversationId: 'conv-1',
  customerLabel: 'Asha',
};

beforeEach(() => {
  notifyTenant.mockClear();
  sendText.mockClear();
});

describe('sendAiFallback', () => {
  it('sends the notice, opens the conversation and notifies staff', async () => {
    const d = db(false);
    const r = await sendAiFallback({ ...base, db: d as never });
    expect(r.sent).toBe(true);
    expect(sendText).toHaveBeenCalledWith(expect.anything(), AI_FALLBACK_TEXT);
    expect(d.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv-1' }, data: { status: 'open' } });
    expect(notifyTenant).toHaveBeenCalledTimes(1);
  });

  it('within 5 minutes of the last notice: no second message or alert, but the chat stays open', async () => {
    const d = db(true);
    const r = await sendAiFallback({ ...base, db: d as never });
    expect(r.sent).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
    expect(notifyTenant).not.toHaveBeenCalled();
    expect(d.conversation.update).toHaveBeenCalled();
  });

  it('looks back exactly 5 minutes for the previous notice', async () => {
    const d = db(false);
    const now = new Date('2026-06-01T12:00:00Z');
    await sendAiFallback({ ...base, db: d as never, now });
    const where = (d.message.findFirst.mock.calls[0] as unknown as [{ where: { createdAt: { gte: Date } } }])[0].where;
    expect(where.createdAt.gte.toISOString()).toBe('2026-06-01T11:55:00.000Z');
  });

  it('a failed send still opens the chat and alerts staff', async () => {
    sendText.mockRejectedValueOnce(new Error('outside 24h window'));
    const d = db(false);
    const r = await sendAiFallback({ ...base, db: d as never });
    expect(r.sent).toBe(false);
    expect(d.conversation.update).toHaveBeenCalled();
    expect(notifyTenant).toHaveBeenCalledTimes(1);
  });

  it('without WhatsApp connected it still hands the chat to a human', async () => {
    const d = db(false);
    const r = await sendAiFallback({ ...base, transport: null, db: d as never });
    expect(r.sent).toBe(false);
    expect(d.conversation.update).toHaveBeenCalled();
    expect(notifyTenant).toHaveBeenCalledTimes(1);
  });
});
