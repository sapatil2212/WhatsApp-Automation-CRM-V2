/**
 * Bookings board for non-clinic businesses (gym, salon, …).
 *
 * Bookings are BusinessEnquiry rows: the public booking page and the
 * WhatsApp assistant create them, and the dashboard lists, adds, edits,
 * changes status and deletes them here. Everything runs on the tenant-scoped
 * client (BusinessEnquiry is guarded through its BusinessProfile), so one
 * business can never read or change another's bookings.
 */

import { z } from 'zod';

import { ConflictError, NotFoundError, ValidationError, type TenantDb } from '../kernel';
import { appointmentsChanged } from './appointment-board.service';
import { normalizeBookingPhone } from './public-booking.service';

export const BUSINESS_BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time.');

export const businessBookingSchema = z.object({
  contactId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2, 'Enter the name.').max(120),
  phone: z.string().trim().max(20).optional().default(''),
  service: z.string().trim().max(191).nullable().optional(),
  date,
  time,
  status: z.enum(BUSINESS_BOOKING_STATUSES).default('confirmed'),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export const businessBookingUpdateSchema = z.union([
  z.object({ status: z.enum(BUSINESS_BOOKING_STATUSES) }).strict(),
  businessBookingSchema,
]);
export const businessBookingBulkDeleteSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

type EnquiryRow = {
  id: string;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  enquiryType: string | null;
  preferredDate: Date | null;
  preferredTime: string | null;
  notes: string | null;
  status: string;
  source: string;
  createdAt: Date;
};

export function toBookingRow(r: EnquiryRow) {
  return {
    id: r.id,
    contactId: r.contactId,
    name: r.contactName,
    phone: r.contactPhone,
    service: r.enquiryType,
    date: r.preferredDate ? r.preferredDate.toISOString().slice(0, 10) : null,
    time: r.preferredTime,
    notes: r.notes,
    status: (BUSINESS_BOOKING_STATUSES as readonly string[]).includes(r.status) ? r.status : 'pending',
    source: r.source,
    createdAt: r.createdAt.toISOString(),
  };
}
export type BusinessBookingRow = ReturnType<typeof toBookingRow>;

async function requireBusiness(db: TenantDb) {
  const biz = await db.businessProfile.findFirst({ select: { id: true } });
  if (!biz) throw new NotFoundError('Business profile', { details: { hint: 'Complete Business Setup first.' } });
  return biz;
}

export async function listBusinessBookings(db: TenantDb) {
  const biz = await requireBusiness(db);
  const [rows, services, contacts] = await Promise.all([
    db.businessEnquiry.findMany({ where: { businessId: biz.id }, orderBy: [{ preferredDate: 'desc' }, { preferredTime: 'desc' }], take: 2000 }),
    db.businessService.findMany({ where: { businessId: biz.id, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.contact.findMany({ select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' }, take: 1000 }),
  ]);
  return { items: (rows as EnquiryRow[]).map(toBookingRow), services, contacts };
}

/** Same rule as the public booking page: one active booking per date and time. */
async function assertSlotFree(db: TenantDb, businessId: string, day: string, at: string, exceptId?: string) {
  const taken = await db.businessEnquiry.count({
    where: { businessId, status: { not: 'cancelled' }, preferredDate: new Date(`${day}T00:00:00Z`), preferredTime: at, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (taken > 0) throw new ConflictError('Another booking already has this date and time. Choose a different time.');
}

/** Existing contact by id or phone, otherwise a new one, so the Inbox and CRM see the same person. */
async function resolveContact(db: TenantDb, ctx: { tenantId: string; userId: string }, body: z.infer<typeof businessBookingSchema>) {
  if (body.contactId) {
    const c = await db.contact.findFirst({ where: { id: body.contactId }, select: { id: true, name: true, phone: true } });
    if (!c) throw new ValidationError('That contact no longer exists.');
    return { id: c.id, name: body.name || c.name || '', phone: c.phone || '' };
  }
  const phone = normalizeBookingPhone(body.phone, '91');
  if (!phone) throw new ValidationError('Enter a valid mobile number.');
  const existing = await db.contact.findFirst({ where: { phone }, select: { id: true, name: true } });
  if (existing) {
    if (!existing.name) await db.contact.updateMany({ where: { id: existing.id }, data: { name: body.name } });
    return { id: existing.id, name: body.name, phone };
  }
  const created = await db.contact.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, phone, name: body.name } as never, select: { id: true } });
  return { id: created.id, name: body.name, phone };
}

export async function createBusinessBooking(db: TenantDb, ctx: { tenantId: string; userId: string }, body: z.infer<typeof businessBookingSchema>) {
  const biz = await requireBusiness(db);
  if (body.status !== 'cancelled') await assertSlotFree(db, biz.id, body.date, body.time);
  const contact = await resolveContact(db, ctx, body);
  const row = await db.businessEnquiry.create({
    data: {
      businessId: biz.id,
      contactId: contact.id,
      contactName: contact.name,
      contactPhone: contact.phone,
      enquiryType: body.service || 'Appointment',
      preferredDate: new Date(`${body.date}T00:00:00Z`),
      preferredTime: body.time,
      notes: body.notes || null,
      status: body.status,
      source: 'dashboard',
    },
  });
  appointmentsChanged(ctx.tenantId, { id: row.id, kind: 'created' });
  return toBookingRow(row as EnquiryRow);
}

export async function updateBusinessBooking(db: TenantDb, ctx: { tenantId: string; userId: string }, id: string, body: z.infer<typeof businessBookingUpdateSchema>) {
  const biz = await requireBusiness(db);
  const before = await db.businessEnquiry.findFirst({ where: { id, businessId: biz.id } });
  if (!before) throw new NotFoundError('Booking');
  if ('name' in body) {
    if (body.status !== 'cancelled') await assertSlotFree(db, biz.id, body.date, body.time, id);
    const contact = await resolveContact(db, ctx, body);
    await db.businessEnquiry.updateMany({
      where: { id, businessId: biz.id },
      data: {
        contactId: contact.id,
        contactName: contact.name,
        contactPhone: contact.phone,
        enquiryType: body.service || 'Appointment',
        preferredDate: new Date(`${body.date}T00:00:00Z`),
        preferredTime: body.time,
        notes: body.notes || null,
        status: body.status,
      },
    });
  } else {
    if (before.status === 'cancelled' && body.status !== 'cancelled' && before.preferredDate && before.preferredTime) {
      await assertSlotFree(db, biz.id, before.preferredDate.toISOString().slice(0, 10), before.preferredTime, id);
    }
    await db.businessEnquiry.updateMany({ where: { id, businessId: biz.id }, data: { status: body.status } });
  }
  appointmentsChanged(ctx.tenantId, { id, kind: 'updated' });
  const after = await db.businessEnquiry.findFirst({ where: { id, businessId: biz.id } });
  return toBookingRow(after as EnquiryRow);
}

export async function deleteBusinessBookings(db: TenantDb, tenantId: string, ids: string[]) {
  const biz = await requireBusiness(db);
  const unique = [...new Set(ids)];
  const found = await db.businessEnquiry.findMany({ where: { id: { in: unique }, businessId: biz.id }, select: { id: true } });
  const deleted = found.map((r) => r.id);
  const seen = new Set(deleted);
  if (deleted.length) {
    await db.businessEnquiry.deleteMany({ where: { id: { in: deleted }, businessId: biz.id } });
    appointmentsChanged(tenantId, { kind: 'deleted' });
  }
  return { deleted, blocked: unique.filter((id) => !seen.has(id)).map((id) => ({ id, reason: 'Booking not found.' })) };
}
