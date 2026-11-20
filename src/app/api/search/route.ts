import { z } from 'zod';

import { createHandler, systemDb } from '@/server/kernel';

/** Global navbar search across contacts, bookings, deals, campaigns, templates and flows. */
export const GET = createHandler({
  operation: 'search.global',
  auth: 'tenant',
  query: z.object({ q: z.string().trim().min(1).max(80) }),
  response: z.any(),
  rateLimit: { limit: 90, windowMs: 60_000 },
  async handle({ ctx, query }) {
    const tenantId = ctx.tenantId;
    const q = query.q;
    const digits = q.replace(/\D/g, '');
    const [clinic, business] = await Promise.all([
      systemDb.clinic.findFirst({ where: { tenantId }, select: { id: true } }),
      systemDb.businessProfile.findFirst({ where: { tenantId }, select: { id: true, businessType: true } }),
    ]);
    const [contacts, appts, enquiries, deals, campaigns, templates, flows] = await Promise.all([
      systemDb.contact.findMany({
        where: {
          tenantId,
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { company: { contains: q } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
          ],
        },
        select: { id: true, name: true, phone: true, company: true },
        take: 6,
      }),
      clinic
        ? systemDb.appointment.findMany({
            where: { clinicId: clinic.id, patientName: { contains: q } },
            select: { id: true, patientName: true, appointmentDate: true, appointmentTime: true },
            orderBy: { appointmentDate: 'desc' },
            take: 5,
          })
        : [],
      business
        ? systemDb.businessEnquiry.findMany({
            where: { businessId: business.id, OR: [{ contactName: { contains: q } }, ...(digits.length >= 3 ? [{ contactPhone: { contains: digits } }] : [])] },
            select: { id: true, contactName: true, preferredDate: true, preferredTime: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
          })
        : [],
      systemDb.deal.findMany({ where: { tenantId, title: { contains: q } }, select: { id: true, title: true }, take: 5 }),
      systemDb.broadcast.findMany({ where: { tenantId, name: { contains: q } }, select: { id: true, name: true, status: true }, take: 5 }),
      systemDb.messageTemplate.findMany({ where: { tenantId, name: { contains: q } }, select: { id: true, name: true, status: true }, take: 5 }),
      systemDb.flow.findMany({ where: { tenantId, name: { contains: q } }, select: { id: true, name: true, status: true }, take: 5 }),
    ]);
    const bookingsHref = clinic ? '/healthcare/appointments' : `/${business?.businessType ?? 'business'}/appointments`;
    return {
      groups: [
        {
          label: 'Contacts',
          items: contacts.map((c) => ({
            id: c.id,
            title: c.name || `+${c.phone}`,
            subtitle: [c.name ? `+${c.phone}` : '', c.company].filter(Boolean).join(' · '),
            href: '/contacts',
          })),
        },
        {
          label: clinic ? 'Appointments' : 'Bookings',
          items: [
            ...appts.map((a) => ({ id: a.id, title: a.patientName ?? 'Patient', subtitle: `${a.appointmentDate.toISOString().slice(0, 10)} · ${a.appointmentTime}`, href: bookingsHref })),
            ...enquiries.map((e) => ({ id: e.id, title: e.contactName ?? 'Customer', subtitle: `${e.preferredDate?.toISOString().slice(0, 10) ?? ''} · ${e.preferredTime ?? ''}`, href: bookingsHref })),
          ],
        },
        { label: 'Deals', items: deals.map((d) => ({ id: d.id, title: d.title, subtitle: 'Pipeline deal', href: '/pipelines' })) },
        { label: 'Campaigns', items: campaigns.map((c) => ({ id: c.id, title: c.name, subtitle: c.status, href: `/campaigns/${c.id}` })) },
        { label: 'Templates', items: templates.map((t) => ({ id: t.id, title: t.name, subtitle: t.status, href: '/templates' })) },
        { label: 'Flows', items: flows.map((f) => ({ id: f.id, title: f.name, subtitle: f.status, href: `/flows/${f.id}` })) },
      ].filter((g) => g.items.length),
    };
  },
});
