import { describe, expect, it } from 'vitest';

import { WEEKDAYS } from '../dtos/clinic.dto';
import { dateOnlyInputSchema, timeOfDaySchema } from './common.validator';
import {
  bookAppointmentBodySchema,
  setClinicTimingsBodySchema,
  upsertAiSettingsBodySchema,
  upsertClinicServiceBodySchema,
} from './clinic.validator';

function fullWeek(overrides: Record<string, unknown> = {}) {
  return WEEKDAYS.map((day) => ({
    dayName: day,
    isClosed: false,
    openingTime: '09:00',
    closingTime: '18:00',
    ...overrides,
  }));
}

describe('dateOnlyInputSchema', () => {
  it('parses at UTC midnight, not the server’s local midnight', () => {
    // A local parse on a UTC+5:30 host yields 2026-05-21T18:30Z and the stored
    // @db.Date lands a day early.
    expect(dateOnlyInputSchema.parse('2026-05-22').toISOString()).toBe('2026-05-22T00:00:00.000Z');
  });

  it('rejects a non-ISO shape', () => {
    expect(dateOnlyInputSchema.safeParse('22-05-2026').success).toBe(false);
    expect(dateOnlyInputSchema.safeParse('2026-5-2').success).toBe(false);
  });

  it('rejects a date that does not exist rather than rolling it over', () => {
    // `new Date('2026-02-30')` silently becomes 2026-03-02.
    expect(dateOnlyInputSchema.safeParse('2026-02-30').success).toBe(false);
    expect(dateOnlyInputSchema.safeParse('2026-13-01').success).toBe(false);
  });

  it('accepts a real leap day', () => {
    expect(dateOnlyInputSchema.safeParse('2028-02-29').success).toBe(true);
  });
});

describe('timeOfDaySchema', () => {
  it('accepts zero-padded 24-hour times', () => {
    expect(timeOfDaySchema.safeParse('09:30').success).toBe(true);
    expect(timeOfDaySchema.safeParse('23:59').success).toBe(true);
    expect(timeOfDaySchema.safeParse('00:00').success).toBe(true);
  });

  it('rejects out-of-range and unpadded values', () => {
    expect(timeOfDaySchema.safeParse('24:00').success).toBe(false);
    expect(timeOfDaySchema.safeParse('09:60').success).toBe(false);
    expect(timeOfDaySchema.safeParse('9:30').success).toBe(false);
    expect(timeOfDaySchema.safeParse('09:30:00').success).toBe(false);
  });
});

describe('setClinicTimingsBodySchema', () => {
  it('requires an entry for every weekday', () => {
    expect(setClinicTimingsBodySchema.safeParse({ timings: fullWeek() }).success).toBe(true);
    expect(setClinicTimingsBodySchema.safeParse({ timings: fullWeek().slice(0, 6) }).success).toBe(false);
  });

  it('rejects a duplicated day', () => {
    const week = fullWeek();
    week[1] = { ...week[1], dayName: 'Monday' };
    expect(setClinicTimingsBodySchema.safeParse({ timings: week }).success).toBe(false);
  });

  it('requires both times on an open day', () => {
    const week = fullWeek();
    week[0] = { dayName: 'Monday', isClosed: false, openingTime: '09:00' } as never;
    expect(setClinicTimingsBodySchema.safeParse({ timings: week }).success).toBe(false);
  });

  it('allows a closed day with no times', () => {
    const week = fullWeek();
    week[6] = { dayName: 'Sunday', isClosed: true } as never;
    expect(setClinicTimingsBodySchema.safeParse({ timings: week }).success).toBe(true);
  });

  it('rejects a closing time before the opening time', () => {
    expect(
      setClinicTimingsBodySchema.safeParse({
        timings: fullWeek({ openingTime: '18:00', closingTime: '09:00' }),
      }).success,
    ).toBe(false);
  });

  it('rejects a half-specified lunch break, which silently disabled break filtering', () => {
    expect(
      setClinicTimingsBodySchema.safeParse({ timings: fullWeek({ lunchBreakStart: '13:00' }) }).success,
    ).toBe(false);
  });

  it('rejects a lunch break outside opening hours', () => {
    expect(
      setClinicTimingsBodySchema.safeParse({
        timings: fullWeek({ lunchBreakStart: '19:00', lunchBreakEnd: '20:00' }),
      }).success,
    ).toBe(false);
  });

  it('rejects an inverted lunch break', () => {
    expect(
      setClinicTimingsBodySchema.safeParse({
        timings: fullWeek({ lunchBreakStart: '14:00', lunchBreakEnd: '13:00' }),
      }).success,
    ).toBe(false);
  });

  it('accepts a valid lunch break', () => {
    expect(
      setClinicTimingsBodySchema.safeParse({
        timings: fullWeek({ lunchBreakStart: '13:00', lunchBreakEnd: '14:00' }),
      }).success,
    ).toBe(true);
  });
});

describe('upsertClinicServiceBodySchema', () => {
  it('rejects a non-positive or absurd duration, which drives the slot grid', () => {
    expect(upsertClinicServiceBodySchema.safeParse({ serviceName: 'X', durationMinutes: 0 }).success).toBe(
      false,
    );
    expect(
      upsertClinicServiceBodySchema.safeParse({ serviceName: 'X', durationMinutes: 600 }).success,
    ).toBe(false);
  });

  it('defaults to a 30-minute active service', () => {
    const parsed = upsertClinicServiceBodySchema.parse({ serviceName: 'Consultation' });
    expect(parsed).toMatchObject({ durationMinutes: 30, isActive: true, startingPrice: 0 });
  });
});

describe('upsertAiSettingsBodySchema', () => {
  it('defaults to an enabled, ai_first configuration', () => {
    const parsed = upsertAiSettingsBodySchema.parse({});
    expect(parsed).toMatchObject({
      aiEnabled: true,
      inboundRoutingMode: 'ai_first',
      humanHandoverEnabled: true,
      supportedLanguages: ['English'],
    });
  });

  it('rejects an unknown routing mode', () => {
    expect(upsertAiSettingsBodySchema.safeParse({ inboundRoutingMode: 'magic' }).success).toBe(false);
  });
});

describe('bookAppointmentBodySchema', () => {
  const valid = {
    contactId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    doctorId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
    appointmentDate: '2026-05-22',
    appointmentTime: '09:30',
  };

  it('accepts a well-formed booking and normalises the date to UTC', () => {
    const parsed = bookAppointmentBodySchema.parse(valid);
    expect(parsed.appointmentDate.toISOString()).toBe('2026-05-22T00:00:00.000Z');
  });

  it('rejects a malformed time', () => {
    expect(bookAppointmentBodySchema.safeParse({ ...valid, appointmentTime: '9am' }).success).toBe(false);
  });

  it('rejects a non-id contact', () => {
    expect(bookAppointmentBodySchema.safeParse({ ...valid, contactId: 'nope' }).success).toBe(false);
  });
});
