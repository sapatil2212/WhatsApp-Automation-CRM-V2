/**
 * Dashboard assembly.
 *
 * Composes the repository's aggregates into the single dashboard payload and
 * owns the derived arithmetic (deltas, ratios, day bucketing) so no two
 * callers can compute a metric differently.
 */

import { type TenantDb } from '../kernel';
import { toNumber } from '../dtos/common.dto';
import { toMetricDelta, type DashboardDto } from '../dtos/dashboard.dto';
import { DashboardRepository, type DashboardWindow } from '../repositories/dashboard.repository';

const ACTIVITY_LIMIT = 10;
const TOP_TAGS_LIMIT = 5;

export interface DashboardServiceDeps {
  dashboard: DashboardRepository;
}

export class DashboardService {
  constructor(private readonly deps: DashboardServiceDeps) {}

  static create(db: TenantDb): DashboardService {
    return new DashboardService({ dashboard: new DashboardRepository(db) });
  }

  /**
   * Builds the window and its immediately-preceding twin of equal length, so
   * period-over-period comparisons are like-for-like.
   */
  static buildWindow(days: number, now = new Date()): DashboardWindow {
    const to = now;
    const from = new Date(to.getTime() - days * 86_400_000);
    const previousFrom = new Date(from.getTime() - days * 86_400_000);
    return { from, to, previousFrom };
  }

  async load(days: number): Promise<DashboardDto> {
    const window = DashboardService.buildWindow(days);

    const [contacts, conversations, messages, volume, deals, broadcasts, automations, tags, activity] =
      await Promise.all([
        this.deps.dashboard.contactTotals(window),
        this.deps.dashboard.conversationTotals(window),
        this.deps.dashboard.messageTotals(window),
        this.deps.dashboard.responseVolumeByDay(window),
        this.deps.dashboard.dealTotals(),
        this.deps.dashboard.broadcastTotals(window),
        this.deps.dashboard.automationTotals(),
        this.deps.dashboard.topTags(TOP_TAGS_LIMIT),
        this.deps.dashboard.recentActivity(ACTIVITY_LIMIT),
      ]);

    const inbound = messages.customer ?? 0;
    // Bot replies are outbound from the customer's point of view, so they
    // belong in the same bucket as agent replies.
    const outbound = (messages.agent ?? 0) + (messages.bot ?? 0);

    const collectDeals = (statuses: string[]) =>
      deals
        .filter((group) => statuses.includes(group.status))
        .map((group) => ({
          currency: group.currency,
          value: toNumber(group._sum.value),
          count: group._count._all,
        }));

    return {
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      contacts: {
        total: contacts.total,
        created: toMetricDelta(contacts.created, contacts.createdPrevious),
      },
      conversations: {
        open: conversations.byStatus.open ?? 0,
        pending: conversations.byStatus.pending ?? 0,
        closed: conversations.byStatus.closed ?? 0,
        unreadTotal: conversations.unreadTotal,
        active: toMetricDelta(conversations.active, conversations.activePrevious),
      },
      messages: {
        inbound,
        outbound,
        replyRatio: inbound > 0 ? Math.round((outbound / inbound) * 10) / 10 : null,
        byDay: bucketByDay(volume, window),
      },
      deals: {
        // Legacy `open` rows count as active.
        open: collectDeals(['active', 'open']),
        won: collectDeals(['won']),
        lost: collectDeals(['lost']),
      },
      broadcasts: {
        count: broadcasts.count,
        recipients: broadcasts.sums.totalRecipients ?? 0,
        sent: broadcasts.sums.sentCount ?? 0,
        delivered: broadcasts.sums.deliveredCount ?? 0,
        read: broadcasts.sums.readCount ?? 0,
        failed: broadcasts.sums.failedCount ?? 0,
      },
      automations,
      topTags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        contactCount: tag._count.contacts,
      })),
      activity: buildActivity(activity),
    };
  }
}

/**
 * Buckets message timestamps into calendar days.
 *
 * Every day in the window is emitted, including empty ones — a chart that
 * skips quiet days misrepresents a trend as continuous activity.
 *
 * Bucketing uses the server's local calendar. That is a known limitation:
 * `TenantConfiguration.brandingTimezone` exists and should drive this, which
 * is tracked with the other timezone work.
 */
function bucketByDay(
  rows: Array<{ createdAt: Date; senderType: string }>,
  window: DashboardWindow,
): DashboardDto['messages']['byDay'] {
  const buckets = new Map<string, { inbound: number; outbound: number }>();

  const dayKey = (date: Date) => date.toISOString().slice(0, 10);

  for (
    let cursor = new Date(window.from);
    cursor.getTime() <= window.to.getTime();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    buckets.set(dayKey(cursor), { inbound: 0, outbound: 0 });
  }

  for (const row of rows) {
    const key = dayKey(row.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (row.senderType === 'customer') bucket.inbound += 1;
    else bucket.outbound += 1;
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));
}

function buildActivity(input: {
  contacts: Array<{ id: string; name: string | null; phone: string; createdAt: Date }>;
  conversations: Array<{
    id: string;
    lastMessageText: string | null;
    lastMessageAt: Date | null;
    status: string;
    contact: { id: string; name: string | null; phone: string } | null;
  }>;
}): DashboardDto['activity'] {
  const entries: DashboardDto['activity'] = [
    ...input.contacts.map((contact) => ({
      kind: 'contact_created' as const,
      at: contact.createdAt.toISOString(),
      contactId: contact.id,
      contactName: contact.name ?? null,
      contactPhone: contact.phone,
      conversationId: null,
      preview: null,
    })),
    ...input.conversations.flatMap((conversation) =>
      conversation.lastMessageAt
        ? [
            {
              kind: 'message_received' as const,
              at: conversation.lastMessageAt.toISOString(),
              contactId: conversation.contact?.id ?? null,
              contactName: conversation.contact?.name ?? null,
              contactPhone: conversation.contact?.phone ?? null,
              conversationId: conversation.id,
              preview: conversation.lastMessageText?.slice(0, 140) ?? null,
            },
          ]
        : [],
    ),
  ];

  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_LIMIT);
}
