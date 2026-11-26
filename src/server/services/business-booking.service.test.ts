import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/realtime', () => ({ triggerRealtimeEvent: vi.fn() }));

import { businessBookingUpdateSchema, createBusinessBooking, deleteBusinessBookings } from './business-booking.service';

const ctx = { tenantId: 't1', userId: 'u1' };

function fakeDb(opts: { taken?: number; existing?: string[] } = {}) {
  const created: unknown[] = [];
  const deleted: unknown[] = [];
  const db = {
    businessProfile: { findFirst: vi.fn(async () => ({ id: 'biz-1' })) },
    businessEnquiry: {
      count: vi.fn(async () => opts.taken ?? 0),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => (opts.existing ?? []).includes(id)).map((id) => ({ id }))),
      deleteMany: vi.fn(async (a: unknown) => { deleted.push(a); return { count: 1 }; }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'e1', createdAt: new Date(), ...data }; }),
    },
    contact: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'c-new' })),
      updateMany: vi.fn(),
    },
  };
  return { db: db as never, created, deleted };
}

const body = { name: 'Minal Patil', phone: '8830553868', date: '2026-12-01', time: '10:00', status: 'confirmed' as const };

describe('business bookings', () => {
  it('adds a dashboard booking linked to a contact', async () => {
    const { db, created } = fakeDb();
    const row = await createBusinessBooking(db, ctx, body);
    expect(created[0]).toMatchObject({ businessId: 'biz-1', contactId: 'c-new', contactPhone: '918830553868', preferredTime: '10:00', source: 'dashboard', status: 'confirmed' });
    expect(row.date).toBe('2026-12-01');
  });

  it('refuses a date and time that is already booked', async () => {
    const { db, created } = fakeDb({ taken: 1 });
    await expect(createBusinessBooking(db, ctx, body)).rejects.toThrow(/already has this date and time/);
    expect(created).toHaveLength(0);
  });

  it('deletes only bookings of this business and reports the rest', async () => {
    const { db, deleted } = fakeDb({ existing: ['a'] });
    const res = await deleteBusinessBookings(db, 't1', ['a', 'b']);
    expect(res).toEqual({ deleted: ['a'], blocked: [{ id: 'b', reason: 'Booking not found.' }] });
    expect(deleted[0]).toEqual({ where: { id: { in: ['a'] }, businessId: 'biz-1' } });
  });

  it('treats { status } alone as a status change and a full body as an edit', () => {
    expect(businessBookingUpdateSchema.parse({ status: 'completed' })).toEqual({ status: 'completed' });
    expect('name' in businessBookingUpdateSchema.parse({ ...body, status: 'completed' })).toBe(true);
  });
});
