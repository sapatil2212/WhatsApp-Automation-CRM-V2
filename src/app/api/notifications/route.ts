import { z } from 'zod';

import { createHandler, systemDb } from '@/server/kernel';

/**
 * Notification feed for the navbar bell: what happened in the workspace in
 * the last 7 days. Live events arrive over the socket; this endpoint fills
 * the list on load. Read state is tracked client-side (last-seen time).
 */
export const GET = createHandler({
  operation: 'notifications.list',
  auth: 'tenant',
  response: z.any(),
  async handle({ ctx }) {
    const tenantId = ctx.tenantId;
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [clinic, business] = await Promise.all([
      systemDb.clinic.findFirst({ where: { tenantId }, select: { id: true } }),
      systemDb.businessProfile.findFirst({ where: { tenantId }, select: { id: true, businessType: true } }),
    ]);
    const [contacts, appts, enquiries, broadcasts, templates, unread] = await Promise.all([
      systemDb.contact.findMany({ where: { tenantId, createdAt: { gte: since } }, select: { id: true, name: true, phone: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
      clinic
        ? systemDb.appointment.findMany({
            where: { clinicId: clinic.id, createdAt: { gte: since } },
            select: { id: true, patientName: true, appointmentDate: true, appointmentTime: true, createdAt: true, status: true, remindersSent: true },
            orderBy: { createdAt: 'desc' },
            take: 15,
          })
        : [],
      business
        ? systemDb.businessEnquiry.findMany({
            where: { businessId: business.id, createdAt: { gte: since } },
            select: { id: true, contactName: true, preferredDate: true, preferredTime: true, createdAt: true, enquiryType: true },
            orderBy: { createdAt: 'desc' },
            take: 15,
          })
        : [],
      systemDb.broadcast.findMany({
        where: { tenantId, updatedAt: { gte: since }, status: { in: ['sent', 'failed', 'cancelled'] } },
        select: { id: true, name: true, status: true, updatedAt: true, totalRecipients: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      systemDb.messageTemplate.findMany({
        where: { tenantId, updatedAt: { gte: since }, status: { in: ['Approved', 'Rejected'] } },
        select: { id: true, name: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      systemDb.conversation.findMany({
        where: { tenantId, unreadCount: { gt: 0 } },
        select: { id: true, unreadCount: true, lastMessageText: true, lastMessageAt: true, contact: { select: { name: true, phone: true } } },
        orderBy: { lastMessageAt: 'desc' },
        take: 8,
      }),
    ]);
    const bookingsHref = clinic ? '/healthcare/appointments' : `/${business?.businessType ?? 'business'}/appointments`;
    const items = [
      ...unread.map((c) => ({
        id: `m-${c.id}`,
        type: 'message',
        title: `${c.unreadCount} unread from ${c.contact?.name || `+${c.contact?.phone}`}`,
        body: (c.lastMessageText ?? '').slice(0, 120),
        href: '/inbox',
        at: (c.lastMessageAt ?? new Date()).toISOString(),
      })),
      ...appts.map((a) => {
        const token = (a.remindersSent as Record<string, unknown> | null)?.token;
        return {
          id: `a-${a.id}`,
          type: 'booking',
          title: `${a.status === 'cancelled' ? 'Cancelled appointment' : 'New appointment'}${token ? ` · Token ${token}` : ''}`,
          body: `${a.patientName ?? 'Patient'} — ${a.appointmentDate.toISOString().slice(0, 10)} ${a.appointmentTime}`,
          href: bookingsHref,
          at: a.createdAt.toISOString(),
        };
      }),
      ...enquiries.map((e) => ({
        id: `e-${e.id}`,
        type: 'booking',
        title: `New booking${e.enquiryType ? ` · ${e.enquiryType}` : ''}`,
        body: `${e.contactName ?? 'Customer'} — ${e.preferredDate?.toISOString().slice(0, 10) ?? ''} ${e.preferredTime ?? ''}`,
        href: bookingsHref,
        at: e.createdAt.toISOString(),
      })),
      ...contacts.map((c) => ({ id: `c-${c.id}`, type: 'lead', title: `New contact: ${c.name || `+${c.phone}`}`, body: '', href: '/contacts', at: c.createdAt.toISOString() })),
      ...broadcasts.map((b) => ({
        id: `b-${b.id}`,
        type: 'campaign',
        title: `Campaign ${b.status === 'sent' ? 'completed' : b.status}: ${b.name}`,
        body: `${b.totalRecipients.toLocaleString()} recipients`,
        href: `/campaigns/${b.id}`,
        at: b.updatedAt.toISOString(),
      })),
      ...templates.map((t) => ({ id: `t-${t.id}`, type: 'template', title: `Template ${t.status.toLowerCase()}: ${t.name}`, body: '', href: '/templates', at: t.updatedAt.toISOString() })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 40);
    return { items };
  },
});
