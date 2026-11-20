import { z } from 'zod';

import { createHandler, systemDb } from '@/server/kernel';

/**
 * Unified dashboard analytics for every business type.
 * GET /api/analytics/overview?days=7|30|90
 */

const DAY = 86_400_000;

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export const GET = createHandler({
  operation: 'analytics.overview',
  auth: 'tenant',
  query: z.object({ days: z.coerce.number().int().refine((n) => [7, 14, 30, 90].includes(n)).default(30) }),
  response: z.any(),
  async handle({ ctx, query }) {
    const tenantId = ctx.tenantId;
    const now = new Date();
    const since = new Date(now.getTime() - (query.days - 1) * DAY);
    since.setUTCHours(0, 0, 0, 0);
    const prevSince = new Date(since.getTime() - query.days * DAY);
    const today = new Date(dayKey(now) + 'T00:00:00Z');

    const [clinic, business] = await Promise.all([
      systemDb.clinic.findFirst({ where: { tenantId }, select: { id: true } }),
      systemDb.businessProfile.findFirst({ where: { tenantId }, select: { id: true } }),
    ]);

    const [
      contactsTotal, contactsNew, contactsPrev, openConversations, unread,
      messages, contactsSeries, broadcasts, deals, stages,
      appts, apptsPrev, upcoming, enquiries, enquiriesPrev, aiLogsBiz, aiLogsClinic, recentConversations,
    ] = await Promise.all([
      systemDb.contact.count({ where: { tenantId } }),
      systemDb.contact.count({ where: { tenantId, createdAt: { gte: since } } }),
      systemDb.contact.count({ where: { tenantId, createdAt: { gte: prevSince, lt: since } } }),
      systemDb.conversation.count({ where: { tenantId, status: 'open' } }),
      systemDb.conversation.aggregate({ where: { tenantId }, _sum: { unreadCount: true } }),
      systemDb.message.findMany({ where: { conversation: { tenantId }, createdAt: { gte: since } }, select: { createdAt: true, senderType: true }, take: 50_000 }),
      systemDb.contact.findMany({ where: { tenantId, createdAt: { gte: since } }, select: { createdAt: true }, take: 50_000 }),
      systemDb.broadcast.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: { id: true, name: true, status: true, totalRecipients: true, sentCount: true, deliveredCount: true, readCount: true, repliedCount: true, failedCount: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      systemDb.deal.findMany({ where: { tenantId }, select: { value: true, status: true, stageId: true, updatedAt: true } }),
      systemDb.pipelineStage.findMany({ where: { pipeline: { tenantId } }, select: { id: true, name: true, color: true, position: true, pipelineId: true }, orderBy: { position: 'asc' } }),
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
    const days = Array.from({ length: query.days }, (_, i) => dayKey(new Date(since.getTime() + i * DAY)));
    const idx = new Map(days.map((d, i) => [d, i]));
    const zero = () => days.map(() => 0);
    const inbound = zero(), outbound = zero(), newContacts = zero(), bookings = zero();
    for (const m of messages) {
      const i = idx.get(dayKey(m.createdAt));
      if (i === undefined) continue;
      if (m.senderType === 'customer' || m.senderType === 'contact') inbound[i] += 1;
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
    const camp = broadcasts.reduce(
      (acc, b) => {
        acc.recipients += b.totalRecipients;
        acc.delivered += b.deliveredCount + b.readCount + b.repliedCount;
        acc.read += b.readCount + b.repliedCount;
        acc.replied += b.repliedCount;
        acc.failed += b.failedCount;
        return acc;
      },
      { recipients: 0, delivered: 0, read: 0, replied: 0, failed: 0 },
    );
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

    // ── pipeline ──────────────────────────────────────────────────
    const open = deals.filter((d) => d.status === 'active');
    const won = deals.filter((d) => d.status === 'won' && d.updatedAt >= since);
    const firstPipeline = stages[0]?.pipelineId;
    const stageValues = stages
      .filter((s) => s.pipelineId === firstPipeline)
      .map((s) => ({
        label: s.name,
        color: s.color,
        value: open.filter((d) => d.stageId === s.id).reduce((sum, d) => sum + Number(d.value ?? 0), 0),
        count: open.filter((d) => d.stageId === s.id).length,
      }));

    const inboundTotal = inbound.reduce((a, b) => a + b, 0);
    const outboundTotal = outbound.reduce((a, b) => a + b, 0);
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
        bookings: { total: bookingsTotal, trend: trend(bookingsTotal, bookingsPrev), upcoming: upcoming.length },
        campaigns: { sent: camp.recipients, deliveryRate: pct(camp.delivered, camp.recipients), readRate: pct(camp.read, camp.recipients), replyRate: pct(camp.replied, camp.recipients) },
        pipeline: { openValue: open.reduce((s, d) => s + Number(d.value ?? 0), 0), openDeals: open.length, wonValue: won.reduce((s, d) => s + Number(d.value ?? 0), 0), wonDeals: won.length },
        aiReplies: aiLogsBiz.length + (aiLogsClinic as unknown[]).length,
      },
      series: { days, inbound, outbound, newContacts, bookings },
      bookingsByStatus: countBy(bookingRows, (b) => b.status),
      bookingsByGroup: countBy(bookingRows, (b) => b.group).slice(0, 6),
      intents,
      stageValues,
      campaigns: broadcasts.slice(0, 5).map((b) => ({ id: b.id, name: b.name, status: b.status, total: b.totalRecipients, readRate: pct(b.readCount + b.repliedCount, b.totalRecipients) })),
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
