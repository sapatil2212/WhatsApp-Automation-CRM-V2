import { z } from 'zod';

import { createHandler, systemDb } from '@/server/kernel';
import { CLINIC_TIME_ZONE } from '@/server/services/appointment.service';

/**
 * Unified dashboard analytics for every business type.
 * GET /api/analytics/overview?days=7|30|90
 */

const DAY = 86_400_000;

/** Calendar day (YYYY-MM-DD) of an instant in the clinic's time zone, so late-evening messages land on the right day. */
function dayKey(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** UTC offset of the clinic time zone at an instant, in ms. */
function tzOffsetMs(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: CLINIC_TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(d.getTime() / 1000) * 1000;
}

export const GET = createHandler({
  operation: 'analytics.overview',
  auth: 'tenant',
  query: z.object({ days: z.coerce.number().int().refine((n) => [7, 14, 30, 90].includes(n)).default(30) }),
  response: z.any(),
  async handle({ ctx, query }) {
    const tenantId = ctx.tenantId;
    const now = new Date();
    // Range starts at local midnight (clinic time zone) `days - 1` days ago.
    const today = new Date(dayKey(now) + 'T00:00:00Z'); // local "today" as a date-only value
    const firstDay = new Date(today.getTime() - (query.days - 1) * DAY);
    const since = new Date(firstDay.getTime() - tzOffsetMs(now));
    const prevSince = new Date(since.getTime() - query.days * DAY);

    const [clinic, business] = await Promise.all([
      systemDb.clinic.findFirst({ where: { tenantId }, select: { id: true } }),
      systemDb.businessProfile.findFirst({ where: { tenantId }, select: { id: true } }),
    ]);

    const [
      contactsTotal, contactsNew, contactsPrev, openConversations, unread,
      messages, msgTotals, contactsSeries, campaignAgg,
      appts, apptsPrev, upcoming, upcomingCount, enquiries, enquiriesPrev, aiLogsBiz, aiLogsClinic, recentConversations,
    ] = await Promise.all([
      systemDb.contact.count({ where: { tenantId } }),
      systemDb.contact.count({ where: { tenantId, createdAt: { gte: since } } }),
      systemDb.contact.count({ where: { tenantId, createdAt: { gte: prevSince, lt: since } } }),
      systemDb.conversation.count({ where: { tenantId, status: 'open' } }),
      systemDb.conversation.aggregate({ where: { tenantId }, _sum: { unreadCount: true } }),
      systemDb.message.findMany({ where: { conversation: { tenantId }, createdAt: { gte: since } }, select: { createdAt: true, senderType: true }, orderBy: { createdAt: 'desc' }, take: 50_000 }),
      systemDb.message.groupBy({ by: ['senderType'], where: { conversation: { tenantId }, createdAt: { gte: since } }, _count: { _all: true } }),
      systemDb.contact.findMany({ where: { tenantId, createdAt: { gte: since } }, select: { createdAt: true }, take: 50_000 }),
      systemDb.broadcast.aggregate({
        where: { tenantId, createdAt: { gte: since } },
        _sum: { totalRecipients: true, deliveredCount: true, readCount: true, repliedCount: true, failedCount: true },
      }),
      clinic ? systemDb.appointment.findMany({ where: { clinicId: clinic.id, createdAt: { gte: since } }, select: { createdAt: true, status: true, appointmentDate: true, doctor: { select: { specialization: true } } } }) : [],
      clinic ? systemDb.appointment.count({ where: { clinicId: clinic.id, createdAt: { gte: prevSince, lt: since } } }) : 0,
      clinic
        ? systemDb.appointment.findMany({
            where: { clinicId: clinic.id, status: 'scheduled', appointmentDate: { gte: today } },
            orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
            take: 6,
            select: { id: true, patientName: true, appointmentDate: true, appointmentTime: true, remindersSent: true, doctor: { select: { doctorName: true } } },
          })
        : business
          ? systemDb.businessEnquiry.findMany({
              where: { businessId: business.id, status: { in: ['pending', 'confirmed'] }, preferredDate: { gte: today } },
              orderBy: [{ preferredDate: 'asc' }, { preferredTime: 'asc' }],
              take: 6,
              select: { id: true, contactName: true, preferredDate: true, preferredTime: true, enquiryType: true, notes: true },
            })
          : [],
      clinic
        ? systemDb.appointment.count({ where: { clinicId: clinic.id, status: 'scheduled', appointmentDate: { gte: today } } })
        : business
          ? systemDb.businessEnquiry.count({ where: { businessId: business.id, status: { in: ['pending', 'confirmed'] }, preferredDate: { gte: today } } })
          : 0,
      business ? systemDb.businessEnquiry.findMany({ where: { businessId: business.id, createdAt: { gte: since } }, select: { createdAt: true, status: true, enquiryType: true } }) : [],
      business ? systemDb.businessEnquiry.count({ where: { businessId: business.id, createdAt: { gte: prevSince, lt: since } } }) : 0,
      business ? systemDb.businessAILog.findMany({ where: { businessId: business.id, createdAt: { gte: since } }, select: { detectedIntent: true }, take: 5000 }) : [],
      clinic ? systemDb.aiChatLog.findMany({ where: { clinicId: clinic.id, createdAt: { gte: since } }, select: { detectedIntent: true }, take: 5000 }).catch(() => []) : [],
      systemDb.conversation.findMany({
        where: { tenantId },
        orderBy: { lastMessageAt: 'desc' },
        take: 6,
        select: { id: true, lastMessageText: true, lastMessageAt: true, unreadCount: true, contact: { select: { name: true, phone: true } } },
      }),
    ]);

    // ── daily series ───────────────────────────────────────────────
    const days = Array.from({ length: query.days }, (_, i) => new Date(firstDay.getTime() + i * DAY).toISOString().slice(0, 10));
    const idx = new Map(days.map((d, i) => [d, i]));
    const zero = () => days.map(() => 0);
    const inbound = zero(), outbound = zero(), newContacts = zero(), bookings = zero();
    const isInbound = (s: string) => s === 'customer' || s === 'contact';
    for (const m of messages) {
      const i = idx.get(dayKey(m.createdAt));
      if (i === undefined) continue;
      if (isInbound(m.senderType)) inbound[i] += 1;
      else outbound[i] += 1;
    }
    for (const c of contactsSeries) { const i = idx.get(dayKey(c.createdAt)); if (i !== undefined) newContacts[i] += 1; }
    const bookingRows: Array<{ createdAt: Date; status: string; group: string }> = [
      ...appts.map((a) => ({ createdAt: a.createdAt, status: a.status, group: a.doctor?.specialization || 'General' })),
      ...enquiries.map((e) => ({ createdAt: e.createdAt, status: e.status, group: e.enquiryType || 'General' })),
    ];
    for (const b of bookingRows) { const i = idx.get(dayKey(b.createdAt)); if (i !== undefined) bookings[i] += 1; }

    const countBy = <T,>(rows: T[], key: (r: T) => string) => {
      const m = new Map<string, number>();
      rows.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1));
      return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    };

    const intents = countBy(
      [...aiLogsBiz.map((l) => l.detectedIntent ?? ''), ...(aiLogsClinic as Array<{ detectedIntent: string | null }>).map((l) => l.detectedIntent ?? '')]
        .map((i) => i.replace(/\s*\(.*\)$/, '').trim())
        .filter(Boolean),
      (i) => i,
    ).slice(0, 8);

    // ── campaigns ─────────────────────────────────────────────────
    const camp = {
      recipients: campaignAgg._sum.totalRecipients ?? 0,
      read: (campaignAgg._sum.readCount ?? 0) + (campaignAgg._sum.repliedCount ?? 0),
      replied: campaignAgg._sum.repliedCount ?? 0,
      delivered: (campaignAgg._sum.deliveredCount ?? 0) + (campaignAgg._sum.readCount ?? 0) + (campaignAgg._sum.repliedCount ?? 0),
    };
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

    // Exact totals come from the database; the daily series is built from at most the newest 50k rows.
    const inboundTotal = msgTotals.filter((m) => isInbound(m.senderType)).reduce((a, m) => a + m._count._all, 0);
    const outboundTotal = msgTotals.filter((m) => !isInbound(m.senderType)).reduce((a, m) => a + m._count._all, 0);
    const bookingsTotal = bookingRows.length;
    const bookingsPrev = Number(apptsPrev) + Number(enquiriesPrev);
    const trend = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 100) : cur ? 100 : 0);

    return {
      segment: clinic ? 'healthcare' : 'business',
      range: query.days,
      kpis: {
        contacts: { total: contactsTotal, new: contactsNew, trend: trend(contactsNew, contactsPrev) },
        conversations: { open: openConversations, unread: unread._sum.unreadCount ?? 0 },
        messages: { inbound: inboundTotal, outbound: outboundTotal },
        bookings: { total: bookingsTotal, trend: trend(bookingsTotal, bookingsPrev), upcoming: upcomingCount },
        campaigns: { sent: camp.recipients, deliveryRate: pct(camp.delivered, camp.recipients), readRate: pct(camp.read, camp.recipients), replyRate: pct(camp.replied, camp.recipients) },
        aiReplies: aiLogsBiz.length + (aiLogsClinic as unknown[]).length,
      },
      series: { days, inbound, outbound, newContacts, bookings },
      bookingsByStatus: countBy(bookingRows, (b) => b.status),
      bookingsByGroup: countBy(bookingRows, (b) => b.group).slice(0, 6),
      intents,
      upcoming: (upcoming as Array<Record<string, unknown>>).map((u) => ({
        id: u.id as string,
        name: (u.patientName ?? u.contactName ?? 'Customer') as string,
        date: dayKey((u.appointmentDate ?? u.preferredDate) as Date),
        time: (u.appointmentTime ?? u.preferredTime ?? '') as string,
        with: ((u.doctor as { doctorName?: string } | undefined)?.doctorName ?? u.enquiryType ?? '') as string,
        token: ((u.remindersSent as Record<string, unknown> | undefined)?.token as number | undefined) ?? (String(u.notes ?? '').match(/Token #(\d+)/)?.[1] ?? null),
      })),
      recentConversations: recentConversations.map((c) => ({
        id: c.id, name: c.contact?.name || `+${c.contact?.phone ?? ''}`, text: c.lastMessageText ?? '', at: c.lastMessageAt, unread: c.unreadCount,
      })),
    };
  },
});
