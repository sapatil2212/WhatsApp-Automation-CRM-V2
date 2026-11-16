/**
 * Dashboard aggregates.
 *
 * Every figure is computed with `count`/`aggregate`/`groupBy` in the
 * database. The previous dashboard fetched whole tables through the compat
 * endpoint and reduced them in the browser, so the payload grew linearly
 * with the tenant's data and the numbers were only as correct as the page
 * size that happened to come back.
 *
 * Read-only by construction: no method here writes.
 */

import type { Prisma } from '@prisma/client';

import type { TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

export interface DashboardWindow {
  from: Date;
  to: Date;
  /** Same-length window immediately before `from`, for period-over-period. */
  previousFrom: Date;
}

export class DashboardRepository extends BaseRepository {
  protected readonly resourceName = 'Dashboard';

  constructor(db: TenantDb) {
    super(db);
  }

  async contactTotals(window: DashboardWindow) {
    const [total, created, createdPrevious] = await Promise.all([
      this.db.contact.count(),
      this.db.contact.count({ where: { createdAt: { gte: window.from, lte: window.to } } }),
      this.db.contact.count({ where: { createdAt: { gte: window.previousFrom, lt: window.from } } }),
    ]);
    return { total, created, createdPrevious };
  }

  async conversationTotals(window: DashboardWindow) {
    const [byStatus, unread, active, activePrevious] = await Promise.all([
      this.db.conversation.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.conversation.aggregate({
        where: { unreadCount: { gt: 0 } },
        _sum: { unreadCount: true },
      }),
      this.db.conversation.count({ where: { lastMessageAt: { gte: window.from, lte: window.to } } }),
      this.db.conversation.count({
        where: { lastMessageAt: { gte: window.previousFrom, lt: window.from } },
      }),
    ]);

    return {
      byStatus: Object.fromEntries(byStatus.map((group) => [group.status, group._count._all])),
      unreadTotal: unread._sum.unreadCount ?? 0,
      active,
      activePrevious,
    };
  }

  /**
   * Inbound vs outbound message counts.
   *
   * `Message` has no `tenantId`, so the guard filters it through
   * `conversation` — the caller does not have to know that.
   */
  async messageTotals(window: DashboardWindow) {
    const groups = await this.db.message.groupBy({
      by: ['senderType'],
      where: { createdAt: { gte: window.from, lte: window.to } },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((group) => [group.senderType, group._count._all]));
  }

  /**
   * Median first-response time is deliberately not computed here: it needs a
   * per-conversation window function, which Prisma cannot express without
   * raw SQL — and raw SQL bypasses the tenant guard. Left for a reporting
   * view with an explicit tenant predicate.
   */
  async responseVolumeByDay(window: DashboardWindow) {
    // Day bucketing happens in the service: MySQL date functions are not
    // expressible in `groupBy`, and pulling only timestamps for the window
    // keeps the row set bounded and tenant-guarded.
    return this.db.message.findMany({
      where: { createdAt: { gte: window.from, lte: window.to } },
      select: { createdAt: true, senderType: true },
      orderBy: { createdAt: 'asc' },
      // Caps a very busy tenant; the chart is a trend, not an audit.
      take: 20_000,
    });
  }

  async dealTotals() {
    const groups = await this.db.deal.groupBy({
      by: ['status', 'currency'],
      _sum: { value: true },
      _count: { _all: true },
    });
    return groups;
  }

  async broadcastTotals(window: DashboardWindow) {
    const [count, aggregate] = await Promise.all([
      this.db.broadcast.count({ where: { createdAt: { gte: window.from, lte: window.to } } }),
      this.db.broadcast.aggregate({
        where: { createdAt: { gte: window.from, lte: window.to } },
        _sum: {
          totalRecipients: true,
          sentCount: true,
          deliveredCount: true,
          readCount: true,
          repliedCount: true,
          failedCount: true,
        },
      }),
    ]);
    return { count, sums: aggregate._sum };
  }

  async automationTotals() {
    const [active, executions] = await Promise.all([
      this.db.automation.count({ where: { isActive: true } }),
      this.db.automation.aggregate({ _sum: { executionCount: true } }),
    ]);
    return { active, executions: executions._sum.executionCount ?? 0 };
  }

  /** Most recent activity across contacts and conversations, for the feed. */
  async recentActivity(limit: number) {
    const [contacts, conversations] = await Promise.all([
      this.db.contact.findMany({
        select: { id: true, name: true, phone: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.db.conversation.findMany({
        where: { lastMessageAt: { not: null } },
        select: {
          id: true,
          lastMessageText: true,
          lastMessageAt: true,
          status: true,
          contact: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
      }),
    ]);
    return { contacts, conversations };
  }

  async topTags(limit: number) {
    const tags = await this.db.tag.findMany({
      select: { id: true, name: true, color: true, _count: { select: { contacts: true } } },
      orderBy: { name: 'asc' },
    });
    return tags
      .sort((a, b) => b._count.contacts - a._count.contacts)
      .slice(0, limit) satisfies Array<{
      id: string;
      name: string;
      color: string;
      _count: { contacts: number };
    }>;
  }
}

export type { Prisma };
