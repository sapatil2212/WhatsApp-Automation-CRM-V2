import { describe, expect, it } from 'vitest';

import {
  applyPreset,
  applyToActiveDays,
  copyBreakToDays,
  copyDay,
  daySlots,
  defaultDay,
  defaultSchedule,
  fromLegacy,
  legacyFields,
  normalizeSchedule,
  sessionSlots,
  summarize,
  to12h,
  validateSchedule,
  WEEKDAYS,
  type ScheduleSession,
  type WeeklySchedule,
} from './schedule';

function session(over: Partial<ScheduleSession> = {}): ScheduleSession {
  return { enabled: true, start: '09:00', end: '12:00', slotMinutes: 30, breaks: [], ...over };
}

function onlyMonday(mutate?: (s: WeeklySchedule) => void): WeeklySchedule {
  const s = applyPreset(defaultSchedule(), 'clear');
  s.days.Monday = defaultDay(true);
  s.days.Monday.sessions.afternoon.enabled = false;
  s.days.Monday.sessions.evening.enabled = false;
  s.days.Monday.sessions.morning = session();
  mutate?.(s);
  return s;
}

describe('slot generation', () => {
  it('splits a session into equal slots', () => {
    expect(sessionSlots(session(), 'morning').map((x) => x.start)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('drops a trailing partial slot', () => {
    expect(sessionSlots(session({ end: '10:45' }), 'morning').map((x) => x.start)).toEqual(['09:00', '09:30', '10:00']);
  });

  it('skips breaks and restarts right after them', () => {
    const s = session({ start: '16:00', end: '21:00', slotMinutes: 30, breaks: [{ id: 'b', name: 'Dinner', start: '20:00', end: '20:30' }] });
    const starts = sessionSlots(s, 'evening').map((x) => x.start);
    expect(starts).toContain('19:30');
    expect(starts).not.toContain('20:00');
    expect(starts).toContain('20:30');
    expect(starts).toHaveLength(9);
  });

  it('realigns to an off-grid break end', () => {
    const s = session({ slotMinutes: 30, breaks: [{ id: 'b', name: 'Tea', start: '10:00', end: '10:15' }] });
    expect(sessionSlots(s, 'morning').map((x) => x.start)).toEqual(['09:00', '09:30', '10:15', '10:45', '11:15']);
  });

  it('supports an evening session running to midnight', () => {
    const starts = sessionSlots(session({ start: '23:00', end: '24:00', slotMinutes: 15 }), 'evening').map((x) => x.start);
    expect(starts).toEqual(['23:00', '23:15', '23:30', '23:45']);
  });

  it('ignores disabled sessions and days', () => {
    expect(sessionSlots(session({ enabled: false }), 'morning')).toEqual([]);
    expect(daySlots({ ...defaultDay(false) })).toEqual([]);
  });
});

describe('validation', () => {
  it('accepts the default schedule', () => {
    expect(validateSchedule(defaultSchedule())).toEqual([]);
  });

  it('rejects a session outside its bounds', () => {
    const s = onlyMonday((x) => (x.days.Monday.sessions.morning.end = '13:00'));
    expect(validateSchedule(s)[0].message).toMatch(/between/);
  });

  it('rejects end before start', () => {
    const s = onlyMonday((x) => Object.assign(x.days.Monday.sessions.morning, { start: '11:00', end: '10:00' }));
    expect(validateSchedule(s).some((i) => /after start/.test(i.message))).toBe(true);
  });

  it('rejects breaks outside the session or overlapping each other', () => {
    const outside = onlyMonday((x) => x.days.Monday.sessions.morning.breaks.push({ id: 'a', name: 'Late', start: '11:30', end: '12:30' }));
    expect(validateSchedule(outside).some((i) => /inside/.test(i.message))).toBe(true);
    const overlap = onlyMonday((x) =>
      x.days.Monday.sessions.morning.breaks.push({ id: 'a', name: 'A', start: '10:00', end: '10:30' }, { id: 'b', name: 'B', start: '10:15', end: '10:45' }),
    );
    expect(validateSchedule(overlap).some((i) => /overlap/.test(i.message))).toBe(true);
  });

  it('flags a working day with no active session', () => {
    const s = onlyMonday((x) => (x.days.Monday.sessions.morning.enabled = false));
    expect(validateSchedule(s)).toEqual([{ day: 'Monday', message: 'Monday is a working day but has no active session.' }]);
  });

  it('flags a window shorter than one slot', () => {
    const s = onlyMonday((x) => Object.assign(x.days.Monday.sessions.morning, { start: '09:00', end: '09:15', slotMinutes: 30 }));
    expect(validateSchedule(s).some((i) => /shorter/.test(i.message))).toBe(true);
  });
});

describe('presets, copy and summary', () => {
  it('applies day presets', () => {
    expect(summarize(applyPreset(defaultSchedule(), 'mon_sat')).activeDays).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    expect(summarize(applyPreset(defaultSchedule(), 'weekends')).activeDays).toEqual(['Sunday', 'Saturday']);
    expect(summarize(applyPreset(defaultSchedule(), 'all')).workingDays).toBe(7);
    expect(summarize(applyPreset(defaultSchedule(), 'clear')).slotsPerWeek).toBe(0);
  });

  it('copies hours to chosen days with fresh break ids', () => {
    const base = onlyMonday((x) => x.days.Monday.sessions.morning.breaks.push({ id: 'orig', name: 'Tea', start: '10:00', end: '10:30' }));
    const out = copyDay(base, 'Monday', ['Wednesday', 'Friday']);
    expect(summarize(out).activeDays).toEqual(['Monday', 'Wednesday', 'Friday']);
    expect(out.days.Friday.sessions.morning.breaks[0].id).not.toBe('orig');
    expect(base.days.Friday.enabled).toBe(false); // input untouched
  });

  it('applies the same sessions to all active days only', () => {
    const s = defaultSchedule();
    s.days.Monday.sessions.morning = session({ start: '08:00', end: '10:00' });
    const out = applyToActiveDays(s, 'Monday');
    expect(out.days.Friday.sessions.morning.start).toBe('08:00');
    expect(out.days.Sunday.enabled).toBe(false);
  });

  it('copies a break to other days without duplicating', () => {
    const s = defaultSchedule();
    s.days.Monday.sessions.evening.breaks = [{ id: 'd', name: 'Dinner', start: '18:00', end: '18:30' }];
    const once = copyBreakToDays(s, 'Monday', 'evening', 'd', ['Tuesday']);
    const twice = copyBreakToDays(once, 'Monday', 'evening', 'd', ['Tuesday']);
    expect(twice.days.Tuesday.sessions.evening.breaks).toHaveLength(1);
    expect(twice.days.Tuesday.sessions.evening.breaks[0].name).toBe('Dinner');
  });

  it('summarises slots and break minutes per week', () => {
    const s = defaultSchedule(); // Mon–Fri, 9–12 + 16–20 @30m = 6 + 8
    s.days.Monday.sessions.evening.breaks = [{ id: 'd', name: 'Dinner', start: '18:00', end: '18:30' }];
    const sum = summarize(s);
    expect(sum.workingDays).toBe(5);
    expect(sum.perDay.Monday).toBe(13);
    expect(sum.slotsPerWeek).toBe(14 * 4 + 13);
    expect(sum.breakMinutesPerWeek).toBe(30);
    expect(sum.inactiveDays).toEqual(['Sunday', 'Saturday']);
  });
});

describe('legacy conversion', () => {
  it('builds a v2 schedule from availableDays + hours', () => {
    const s = fromLegacy({ weeklySlots: {}, availableDays: ['Tuesday'], availableStartTime: '10:00', availableEndTime: '18:00' });
    expect(s.version).toBe(2);
    expect(summarize(s).activeDays).toEqual(['Tuesday']);
    expect(validateSchedule(normalizeSchedule(s))).toEqual([]);
    expect(daySlots(s.days.Tuesday)[0].start).toBe('10:00');
  });

  it('keeps an existing v2 schedule as-is', () => {
    const v2 = onlyMonday();
    expect(fromLegacy({ weeklySlots: v2, availableDays: ['Friday'], availableStartTime: null, availableEndTime: null })).toEqual(v2);
  });

  it('derives legacy fields from v2', () => {
    expect(legacyFields(defaultSchedule())).toEqual({
      availableDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      availableStartTime: '09:00',
      availableEndTime: '20:00',
    });
  });

  it('formats 12h times', () => {
    expect(to12h('00:00')).toBe('12:00 AM');
    expect(to12h('12:00')).toBe('12:00 PM');
    expect(to12h('20:30')).toBe('8:30 PM');
    expect(to12h('24:00')).toBe('12:00 AM');
  });

  it('covers every weekday', () => {
    expect(Object.keys(defaultSchedule().days).sort()).toEqual([...WEEKDAYS].sort());
  });
});
