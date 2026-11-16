import { describe, expect, it } from 'vitest';

import {
  addDays,
  computeDaySlots,
  isSlotAvailable,
  toMinutes,
  toTimeString,
  weekdayOf,
  type DayTiming,
  type SlotComputationInput,
} from './availability';

/** 2026-05-22 is a Friday. */
const FRIDAY = '2026-05-22';
const SATURDAY = '2026-05-23';

function timing(overrides: Partial<DayTiming> = {}): DayTiming {
  return {
    dayName: 'Friday',
    isClosed: false,
    openingTime: '09:00',
    closingTime: '12:00',
    lunchBreakStart: null,
    lunchBreakEnd: null,
    ...overrides,
  };
}

function input(overrides: Partial<SlotComputationInput> = {}): SlotComputationInput {
  return {
    date: FRIDAY,
    timings: [timing()],
    clinicDateExceptions: {},
    doctor: {
      availableDays: ['Friday'],
      availableStartTime: null,
      availableEndTime: null,
      dateExceptions: {},
    },
    slotMinutes: 30,
    bookedTimes: [],
    // Far in the past, so "today only" past-slot filtering does not interfere
    // unless a test opts in.
    now: new Date('2020-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('time helpers', () => {
  it('round-trips HH:mm through minutes', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(toTimeString(570)).toBe('09:30');
    expect(toTimeString(0)).toBe('00:00');
    expect(toTimeString(1439)).toBe('23:59');
  });

  it('reads the weekday in UTC, not the server’s local zone', () => {
    // A host at UTC+5:30 reading this locally would answer Thursday.
    expect(weekdayOf(FRIDAY)).toBe('Friday');
    expect(weekdayOf('2026-05-24')).toBe('Sunday');
  });

  it('adds days without a timezone shift', () => {
    expect(addDays(FRIDAY, 1)).toBe(SATURDAY);
    // Month and year boundaries.
    expect(addDays('2026-05-31', 1)).toBe('2026-06-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // Leap year.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('computeDaySlots — closures', () => {
  it('produces slots on a normal open day', () => {
    expect(computeDaySlots(input()).slots).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('returns none when the clinic is closed that weekday', () => {
    const result = computeDaySlots(input({ timings: [timing({ isClosed: true })] }));
    expect(result.slots).toEqual([]);
    expect(result.closedReason).toContain('closed');
  });

  it('returns none when no timing row exists for the weekday', () => {
    const result = computeDaySlots(input({ timings: [timing({ dayName: 'Monday' })] }));
    expect(result.slots).toEqual([]);
    expect(result.closedReason).toContain('No opening hours');
  });

  it('honours a clinic holiday exception', () => {
    const result = computeDaySlots(input({ clinicDateExceptions: { [FRIDAY]: 'Diwali' } }));
    expect(result.slots).toEqual([]);
    expect(result.closedReason).toContain('closed on this date');
  });

  it('ignores an exception explicitly set to false', () => {
    expect(computeDaySlots(input({ clinicDateExceptions: { [FRIDAY]: false } })).slots.length).toBeGreaterThan(0);
  });

  it('returns none when the doctor does not consult that weekday', () => {
    const result = computeDaySlots(
      input({ doctor: { ...input().doctor, availableDays: ['Monday'] } }),
    );
    expect(result.closedReason).toContain('does not consult');
  });

  it('treats an empty availableDays list as "every open day"', () => {
    expect(
      computeDaySlots(input({ doctor: { ...input().doctor, availableDays: [] } })).slots.length,
    ).toBeGreaterThan(0);
  });

  it('honours doctor leave', () => {
    const result = computeDaySlots(
      input({ doctor: { ...input().doctor, dateExceptions: { [FRIDAY]: true } } }),
    );
    expect(result.closedReason).toContain('unavailable on this date');
  });

  it('returns none when opening hours are half-configured', () => {
    const result = computeDaySlots(input({ timings: [timing({ closingTime: null })] }));
    expect(result.closedReason).toContain('incomplete');
  });
});

describe('computeDaySlots — window intersection', () => {
  it('starts at the later of clinic opening and doctor start', () => {
    const result = computeDaySlots(
      input({ doctor: { ...input().doctor, availableStartTime: '10:00' } }),
    );
    expect(result.slots[0]).toBe('10:00');
  });

  it('ends at the earlier of clinic closing and doctor end', () => {
    const result = computeDaySlots(
      input({ doctor: { ...input().doctor, availableEndTime: '10:30' } }),
    );
    // 10:00 is included: it ends exactly at 10:30, which is inside the window.
    expect(result.slots).toEqual(['09:00', '09:30', '10:00']);
  });

  it('returns none when the intersection is shorter than one slot', () => {
    const result = computeDaySlots(
      input({
        doctor: { ...input().doctor, availableStartTime: '11:50' },
        slotMinutes: 30,
      }),
    );
    expect(result.slots).toEqual([]);
    expect(result.closedReason).toContain('No consultation window');
  });

  it('never emits a slot that would run past closing time', () => {
    const result = computeDaySlots(input({ slotMinutes: 45 }));
    expect(result.slots).toEqual(['09:00', '09:45', '10:30', '11:15']);
  });

  it('steps by the service duration', () => {
    expect(computeDaySlots(input({ slotMinutes: 60 })).slots).toEqual(['09:00', '10:00', '11:00']);
  });
});

describe('computeDaySlots — lunch break', () => {
  it('excludes a slot starting inside lunch', () => {
    const result = computeDaySlots(
      input({ timings: [timing({ lunchBreakStart: '10:00', lunchBreakEnd: '10:30' })] }),
    );
    expect(result.slots).not.toContain('10:00');
  });

  it('excludes a slot that merely overlaps lunch, not just one starting in it', () => {
    // 09:45–10:15 overlaps a 10:00–10:30 break; a start-time-only check would
    // have offered it, and the patient would arrive to a closed desk.
    const result = computeDaySlots(
      input({
        slotMinutes: 45,
        timings: [timing({ lunchBreakStart: '10:00', lunchBreakEnd: '10:30' })],
      }),
    );
    expect(result.slots).not.toContain('09:45');
  });

  it('keeps a slot ending exactly when lunch starts', () => {
    const result = computeDaySlots(
      input({ timings: [timing({ lunchBreakStart: '09:30', lunchBreakEnd: '10:00' })] }),
    );
    expect(result.slots).toContain('09:00');
  });

  it('keeps a slot starting exactly when lunch ends', () => {
    const result = computeDaySlots(
      input({ timings: [timing({ lunchBreakStart: '09:30', lunchBreakEnd: '10:00' })] }),
    );
    expect(result.slots).toContain('10:00');
  });

  it('ignores a half-specified break rather than misapplying it', () => {
    const result = computeDaySlots(input({ timings: [timing({ lunchBreakStart: '10:00' })] }));
    expect(result.slots).toContain('10:00');
  });
});

describe('computeDaySlots — bookings and the past', () => {
  it('excludes already-booked times', () => {
    const result = computeDaySlots(input({ bookedTimes: ['09:00', '10:30'] }));
    expect(result.slots).toEqual(['09:30', '10:00', '11:00', '11:30']);
  });

  it('excludes past slots on the current date', () => {
    const result = computeDaySlots(
      input({ now: new Date(`${FRIDAY}T10:00:00.000Z`) }),
    );
    expect(result.slots).toEqual(['10:30', '11:00', '11:30']);
  });

  it('does not exclude anything on a future date', () => {
    const result = computeDaySlots(
      input({
        date: SATURDAY,
        timings: [timing({ dayName: 'Saturday' })],
        doctor: { ...input().doctor, availableDays: ['Saturday'] },
        now: new Date(`${FRIDAY}T23:00:00.000Z`),
      }),
    );
    expect(result.slots).toHaveLength(6);
  });

  it('reports a reason when bookings consume the whole day', () => {
    const result = computeDaySlots(
      input({ bookedTimes: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'] }),
    );
    expect(result.slots).toEqual([]);
    expect(result.closedReason).toContain('No slots remain');
  });
});

describe('isSlotAvailable', () => {
  it('agrees with the offered list, so booking cannot accept an unoffered slot', () => {
    const args = input({ bookedTimes: ['09:00'] });
    expect(isSlotAvailable(args, '09:30')).toBe(true);
    expect(isSlotAvailable(args, '09:00')).toBe(false);
    // Not on the step grid.
    expect(isSlotAvailable(args, '09:15')).toBe(false);
    // Outside opening hours.
    expect(isSlotAvailable(args, '08:00')).toBe(false);
    expect(isSlotAvailable(args, '12:00')).toBe(false);
  });
});
