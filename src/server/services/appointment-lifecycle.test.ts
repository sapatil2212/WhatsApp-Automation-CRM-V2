import { describe, expect, it } from 'vitest';

import { blockingExceptions, exceptionsToRecord } from '@/lib/healthcare/exceptions';
import { appointmentInstant, dueStep } from './appointment-lifecycle';
import { computeDaySlots } from './availability';

const H = 3_600_000;
const base = { createdAt: new Date('2026-11-01T00:00:00Z'), updatedAt: new Date('2026-11-01T00:00:00Z'), sent: {} as Record<string, unknown> };

describe('appointmentInstant', () => {
  it('interprets local clinic time (Asia/Kolkata, UTC+5:30)', () => {
    expect(appointmentInstant(new Date('2026-11-20T00:00:00Z'), '10:30').toISOString()).toBe('2026-11-20T05:00:00.000Z');
  });
});

describe('dueStep', () => {
  const at = new Date('2026-11-20T10:00:00Z');
  it('sends confirmation right after booking', () => {
    const now = new Date('2026-11-18T10:00:00Z');
    expect(dueStep({ ...base, status: 'scheduled', at, createdAt: new Date(now.getTime() - 60_000), now })).toBe('confirmation');
  });
  it('sends the day-before, 2h and 1h reminders once each', () => {
    const sent = { confirmation: 'x' };
    expect(dueStep({ ...base, sent, status: 'scheduled', at, now: new Date(at.getTime() - 23 * H) })).toBe('r_1d');
    expect(dueStep({ ...base, sent: { ...sent, r_1d: 'x' }, status: 'scheduled', at, now: new Date(at.getTime() - 23 * H) })).toBeNull();
    expect(dueStep({ ...base, sent, status: 'scheduled', at, now: new Date(at.getTime() - 2 * H) })).toBe('r_2h');
    expect(dueStep({ ...base, sent, status: 'scheduled', at, now: new Date(at.getTime() - 50 * 60_000) })).toBe('r_1h');
    expect(dueStep({ ...base, sent: { ...sent, r_1h: 'x' }, status: 'scheduled', at, now: new Date(at.getTime() - 50 * 60_000) })).toBeNull();
  });
  it('fires each reminder in its window: 1 day (25h–3h), 2 hours (2h15–1h15), 1 hour (1h15–0)', () => {
    const sent = { confirmation: 'x' };
    const at2 = (h: number) => dueStep({ ...base, sent, status: 'scheduled', at, now: new Date(at.getTime() - h * H) });
    expect(at2(26)).toBeNull();
    expect(at2(24.9)).toBe('r_1d');
    expect(at2(4)).toBe('r_1d'); // caught up if the 24h tick was missed
    expect(at2(2.2)).toBe('r_2h');
    expect(at2(1.2)).toBe('r_1h');
    expect(at2(0.1)).toBe('r_1h');
  });
  it('sends no reminder once the patient is already with the doctor', () => {
    const sent = { confirmation: 'x' };
    expect(dueStep({ ...base, sent, status: 'scheduled', at, now: new Date(at.getTime() - 50 * 60_000), consultationStarted: true })).toBeNull();
  });
  it('respects a clinic that switched a reminder off', () => {
    const sent = { confirmation: 'x' };
    expect(dueStep({ ...base, sent, status: 'scheduled', at, now: new Date(at.getTime() - 2 * H), reminders: { r_2h: false } })).toBeNull();
  });
  it('skips the day-before reminder for same-day bookings', () => {
    const createdAt = new Date(at.getTime() - 10 * H);
    expect(dueStep({ ...base, sent: { confirmation: 'x' }, status: 'scheduled', at, createdAt, now: new Date(at.getTime() - 5 * H) })).toBeNull();
  });
  it('handles completed, health check, follow-up and no-show', () => {
    const updatedAt = new Date(at.getTime() + H);
    expect(dueStep({ ...base, status: 'completed', at, updatedAt, now: new Date(at.getTime() + 2 * H) })).toBe('completed');
    expect(dueStep({ ...base, status: 'completed', at, updatedAt, sent: { completed: 'x' }, now: new Date(at.getTime() + 50 * H) })).toBe('health_2d');
    expect(dueStep({ ...base, status: 'completed', at, updatedAt, sent: { completed: 'x', health_2d: 'x' }, now: new Date(at.getTime() + 74 * H) })).toBe('followup_3d');
    expect(dueStep({ ...base, status: 'no_show', at, updatedAt: new Date(), now: new Date() })).toBe('no_show');
    expect(dueStep({ ...base, status: 'cancelled', at, now: new Date(at.getTime() - 2 * H) })).toBeNull();
  });
});

describe('date exceptions from Business Setup', () => {
  it('treats array entries (clinic closures, doctor leaves) as blocked dates', () => {
    const clinic = [{ date: '2026-11-21', is_closed: true, reason: 'Diwali' }, { date: '2026-11-22', is_closed: false, reason: 'special hours' }];
    const doctor = [{ date: '2026-11-23', is_available: false, reason: 'Leave' }];
    expect(blockingExceptions(clinic)).toEqual([{ date: '2026-11-21', reason: 'Diwali' }]);
    expect(exceptionsToRecord(doctor)).toEqual({ '2026-11-23': 'Leave' });
    expect(exceptionsToRecord({ '2026-12-25': 'Christmas' })).toEqual({ '2026-12-25': 'Christmas' });
  });

  it('blocks booking on a doctor leave and honours weekly slots', () => {
    const timings = [{ dayName: 'Monday', isClosed: false, openingTime: '09:00', closingTime: '18:00', lunchBreakStart: '13:00', lunchBreakEnd: '14:00' }];
    const doctor = { availableDays: ['Monday'], availableStartTime: '09:00', availableEndTime: '17:00', dateExceptions: exceptionsToRecord([{ date: '2026-11-23', is_available: false, reason: 'Leave' }]) };
    const now = new Date('2026-11-01T00:00:00Z');
    const leave = computeDaySlots({ date: '2026-11-23', timings, clinicDateExceptions: {}, doctor, slotMinutes: 30, bookedTimes: [], now });
    expect(leave.slots).toEqual([]);
    const weekly = computeDaySlots({
      date: '2026-11-30',
      timings,
      clinicDateExceptions: {},
      doctor: { ...doctor, weeklySlots: { Monday: [{ start_time: '10:00', is_active: true }, { start_time: '10:30', is_active: false }, { start_time: '13:15', is_active: true }, { start_time: '16:00', is_active: true }] } },
      slotMinutes: 30,
      bookedTimes: ['16:00'],
      now,
    });
    expect(weekly.slots).toEqual(['10:00']); // 10:30 inactive, 13:15 overlaps lunch, 16:00 booked
  });
});
