import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toMetricDelta } from '../dtos/dashboard.dto';
import { DashboardService, type DashboardServiceDeps } from './dashboard.service';

const NOW = new Date('2026-05-22T12:00:00.000Z');

interface BroadcastSums {
  totalRecipients: number | null;
  sentCount: number | null;
  deliveredCount: number | null;
  readCount: number | null;
  repliedCount: number | null;
  failedCount: number | null;
}

interface ActivityContact {
  id: string;
  name: string | null;
  phone: string;
  createdAt: Date;
}

interface ActivityConversation {
  id: string;
  lastMessageText: string | null;
  lastMessageAt: Date | null;
  status: string;
  contact: { id: string; name: string | null; phone: string } | null;
}

function makeDeps() {
  const dashboard = {
    contactTotals: vi.fn(async () => ({ total: 120, created: 20, createdPrevious: 10 })),
    conversationTotals: vi.fn(async () => ({
      byStatus: { open: 5, pending: 2, closed: 40 } as Record<string, number>,
      unreadTotal: 7,
      active: 12,
      activePrevious: 8,
    })),
    messageTotals: vi.fn(async (): Promise<Record<string, number>> => ({
      customer: 40,
      agent: 30,
      bot: 10,
    })),
    responseVolumeByDay: vi.fn(
      async (): Promise<Array<{ createdAt: Date; senderType: string }>> => [],
    ),
    dealTotals: vi.fn(
      async (): Promise<
        Array<{
          status: string;
          currency: string;
          _sum: { value: number | null };
          _count: { _all: number };
        }>
      > => [],
    ),
    // Annotated so the nullable-sum and empty-array cases below type-check:
    // an inferred literal type would reject them.
    broadcastTotals: vi.fn(
      async (): Promise<{ count: number; sums: BroadcastSums }> => ({
        count: 3,
        sums: {
          totalRecipients: 900,
          sentCount: 850,
          deliveredCount: 800,
          readCount: 500,
          repliedCount: 20,
          failedCount: 50,
        },
      }),
    ),
    automationTotals: vi.fn(async () => ({ active: 4, executions: 220 })),
    topTags: vi.fn(async () => [
      { id: 'tag-1', name: 'VIP', color: '#3b82f6', _count: { contacts: 12 } },
    ]),
    recentActivity: vi.fn(
      async (): Promise<{ contacts: ActivityContact[]; conversations: ActivityConversation[] }> => ({
        contacts: [],
        conversations: [],
      }),
    ),
  };
  return { dashboard } as unknown as DashboardServiceDeps & { dashboard: typeof dashboard };
}

let deps: ReturnType<typeof makeDeps>;
let service: DashboardService;

beforeEach(() => {
  deps = makeDeps();
  service = new DashboardService(deps);
});

describe('buildWindow', () => {
  it('produces a previous window of equal length, immediately before', () => {
    const window = DashboardService.buildWindow(7, NOW);
    expect(window.to).toEqual(NOW);
    expect(window.from.toISOString()).toBe('2026-05-15T12:00:00.000Z');
    expect(window.previousFrom.toISOString()).toBe('2026-05-08T12:00:00.000Z');
  });
});

describe('toMetricDelta', () => {
  it('computes absolute and percentage change', () => {
    expect(toMetricDelta(20, 10)).toEqual({
      current: 20,
      previous: 10,
      change: 10,
      changePercent: 100,
    });
  });

  it('reports a negative change on a decline', () => {
    expect(toMetricDelta(5, 10)).toMatchObject({ change: -5, changePercent: -50 });
  });

  it('returns null rather than Infinity when the previous window was zero', () => {
    expect(toMetricDelta(5, 0).changePercent).toBeNull();
  });

  it('rounds to one decimal', () => {
    expect(toMetricDelta(7, 3).changePercent).toBe(133.3);
  });
});

describe('load', () => {
  it('counts bot replies as outbound alongside agent replies', async () => {
    const result = await service.load(7);
    expect(result.messages.inbound).toBe(40);
    expect(result.messages.outbound).toBe(40);
  });

  it('computes a reply ratio, and null when nothing came in', async () => {
    expect((await service.load(7)).messages.replyRatio).toBe(1);

    deps.dashboard.messageTotals.mockResolvedValueOnce({ agent: 5 });
    expect((await service.load(7)).messages.replyRatio).toBeNull();
  });

  it('defaults a missing conversation status to zero rather than undefined', async () => {
    deps.dashboard.conversationTotals.mockResolvedValueOnce({
      byStatus: {},
      unreadTotal: 0,
      active: 0,
      activePrevious: 0,
    });
    const result = await service.load(7);
    expect(result.conversations).toMatchObject({ open: 0, pending: 0, closed: 0 });
  });

  it('groups deal totals by currency and treats legacy `open` as active', async () => {
    deps.dashboard.dealTotals.mockResolvedValueOnce([
      { status: 'open', currency: 'INR', _sum: { value: 50000 }, _count: { _all: 2 } },
      { status: 'active', currency: 'USD', _sum: { value: 1200 }, _count: { _all: 1 } },
      { status: 'won', currency: 'USD', _sum: { value: 900 }, _count: { _all: 1 } },
    ]);

    const result = await service.load(7);
    expect(result.deals.open).toEqual([
      { currency: 'INR', value: 50000, count: 2 },
      { currency: 'USD', value: 1200, count: 1 },
    ]);
    expect(result.deals.won).toEqual([{ currency: 'USD', value: 900, count: 1 }]);
    expect(result.deals.lost).toEqual([]);
  });

  it('emits every day in the window, including quiet ones', async () => {
    const result = await service.load(7);
    expect(result.messages.byDay).toHaveLength(8);
    expect(result.messages.byDay.every((day) => day.inbound === 0 && day.outbound === 0)).toBe(true);
  });

  it('buckets messages into the right day and direction', async () => {
    const window = DashboardService.buildWindow(7);
    const midWindow = new Date(window.from.getTime() + 86_400_000);
    deps.dashboard.responseVolumeByDay.mockResolvedValueOnce([
      { createdAt: midWindow, senderType: 'customer' },
      { createdAt: midWindow, senderType: 'agent' },
      { createdAt: midWindow, senderType: 'bot' },
    ]);

    const result = await service.load(7);
    const bucket = result.messages.byDay.find(
      (day) => day.date === midWindow.toISOString().slice(0, 10),
    );
    expect(bucket).toMatchObject({ inbound: 1, outbound: 2 });
  });

  it('ignores a timestamp outside the window instead of miscounting it', async () => {
    deps.dashboard.responseVolumeByDay.mockResolvedValueOnce([
      { createdAt: new Date('2020-01-01T00:00:00.000Z'), senderType: 'customer' },
    ]);
    const result = await service.load(7);
    expect(result.messages.byDay.every((day) => day.inbound === 0)).toBe(true);
  });

  it('flattens broadcast sums with zero defaults', async () => {
    expect((await service.load(7)).broadcasts).toEqual({
      count: 3,
      recipients: 900,
      sent: 850,
      delivered: 800,
      read: 500,
      failed: 50,
    });
  });

  it('tolerates null broadcast sums when no campaign exists in the window', async () => {
    deps.dashboard.broadcastTotals.mockResolvedValueOnce({
      count: 0,
      sums: {
        totalRecipients: null,
        sentCount: null,
        deliveredCount: null,
        readCount: null,
        repliedCount: null,
        failedCount: null,
      },
    });
    expect((await service.load(7)).broadcasts).toMatchObject({ recipients: 0, sent: 0 });
  });

  it('merges and sorts activity newest-first', async () => {
    deps.dashboard.recentActivity.mockResolvedValueOnce({
      contacts: [
        { id: 'c-1', name: 'Asha', phone: '9199', createdAt: new Date('2026-05-20T10:00:00.000Z') },
      ],
      conversations: [
        {
          id: 'conv-1',
          lastMessageText: 'Hello there',
          lastMessageAt: new Date('2026-05-21T10:00:00.000Z'),
          status: 'open',
          contact: { id: 'c-2', name: 'Ravi', phone: '9188' },
        },
      ],
    });

    const result = await service.load(7);
    expect(result.activity.map((entry) => entry.kind)).toEqual(['message_received', 'contact_created']);
  });

  it('drops a conversation with no last-message timestamp', async () => {
    deps.dashboard.recentActivity.mockResolvedValueOnce({
      contacts: [],
      conversations: [
        { id: 'conv-1', lastMessageText: null, lastMessageAt: null, status: 'open', contact: null },
      ],
    });
    expect((await service.load(7)).activity).toEqual([]);
  });
});
