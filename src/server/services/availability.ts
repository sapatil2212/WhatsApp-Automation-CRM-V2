/**
 * Slot availability — pure functions, no I/O.
 *
 * The equivalent logic previously lived inside a 1200-line AI service, built a
 * 7-day grid inline while assembling an LLM prompt, and could not be tested
 * without a database and a Gemini key. It was also the only implementation:
 * the booking path re-derived a subset of the same rules, so "offered" and
 * "accepted" could disagree.
 *
 * Rules applied, in order:
 *   1. clinic closed that weekday               → no slots
 *   2. clinic date exception (holiday)          → no slots
 *   3. doctor not available that weekday        → no slots
 *   4. doctor date exception (leave)            → no slots
 *   5. slots stepped by service duration from the later of the clinic's
 *      opening time and the doctor's start time, to the earlier of the two
 *      closing times
 *   6. lunch break excluded
 *   7. already-booked slots excluded
 *   8. slots in the past excluded (today only)
 *
 * All times are `HH:mm` strings compared lexicographically, which is safe for
 * zero-padded 24-hour values and avoids a Date round-trip per slot.
 */

import { daySlots, isWeeklySchedule, type Weekday, type WeeklySchedule } from '@/lib/healthcare/schedule';

const MINUTES_PER_DAY = 24 * 60;

export interface DayTiming {
  dayName: string;
  isClosed: boolean;
  openingTime: string | null;
  closingTime: string | null;
  lunchBreakStart: string | null;
  lunchBreakEnd: string | null;
}

export interface DoctorAvailabilityInput {
  availableDays: string[];
  availableStartTime: string | null;
  availableEndTime: string | null;
  /** Keyed by `YYYY-MM-DD`; a truthy entry marks the doctor unavailable. */
  dateExceptions: Record<string, unknown>;
  /**
   * Optional explicit per-weekday slots from Business Setup:
   * `{ Monday: [{ start_time: "10:00", end_time: "10:30", is_active: true }] }`.
   * When a weekday has active slots they replace the start/end window.
   */
  weeklySlots?: Record<string, unknown> | WeeklySchedule;
}

export interface SlotComputationInput {
  /** `YYYY-MM-DD`. */
  date: string;
  timings: DayTiming[];
  clinicDateExceptions: Record<string, unknown>;
  doctor: DoctorAvailabilityInput;
  slotMinutes: number;
  /** `HH:mm` values already taken on this date. */
  bookedTimes: string[];
  /** Used to drop past slots; only affects the current date. */
  now: Date;
  /**
   * IANA zone the clinic's times are in. "Today" and "now" are read in this
   * zone so a 10:00 slot is hidden only after 10:00 local, not 10:00 UTC.
   * Defaults to UTC for callers that pre-date timezone support.
   */
  timeZone?: string;
}

/** `YYYY-MM-DD` and minutes-since-midnight for an instant in a zone. */
export function localNow(now: Date, timeZone = 'UTC'): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Today's date in the clinic's zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localNow(now, timeZone).date;
}

export interface DaySlots {
  date: string;
  weekday: string;
  closedReason: string | null;
  slots: string[];
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function toTimeString(minutes: number): string {
  const clamped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Weekday name for a `YYYY-MM-DD` date, read in **UTC**.
 *
 * Matching how dates are stored (UTC midnight). Using the local calendar here
 * is what made a Sunday appointment land on Saturday's timings for hosts ahead
 * of UTC.
 */
export function weekdayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    parsed.getUTCDay()
  ];
}

/** Adds `days` to a `YYYY-MM-DD` date without a timezone shift. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function hasException(exceptions: Record<string, unknown>, date: string): boolean {
  const entry = exceptions[date];
  if (entry === undefined || entry === null) return false;
  if (entry === false) return false;
  // A string reason ("Diwali") or `true` both mark the date unavailable.
  return true;
}

export function computeDaySlots(input: SlotComputationInput): DaySlots {
  const weekday = weekdayOf(input.date);
  const empty = (closedReason: string): DaySlots => ({
    date: input.date,
    weekday,
    closedReason,
    slots: [],
  });

  if (hasException(input.clinicDateExceptions, input.date)) {
    return empty('The clinic is closed on this date.');
  }

  // v2 weekly schedule (sessions + breaks + per-session slot length) is the
  // source of truth for this doctor; clinic weekly hours don't narrow it,
  // but clinic holiday/closure dates (above) and doctor leave still apply.
  if (isWeeklySchedule(input.doctor.weeklySlots)) {
    if (hasException(input.doctor.dateExceptions, input.date)) {
      return empty('This doctor is unavailable on this date.');
    }
    const local = localNow(input.now, input.timeZone ?? 'UTC');
    const isToday = input.date === local.date;
    const generated = daySlots(input.doctor.weeklySlots.days[weekday as Weekday]);
    if (!generated.length) return empty('This doctor does not consult on this day.');
    // Overlap check (not exact match) so a booking made under an older
    // schedule still blocks any new slot that would overlap it.
    const booked = input.bookedTimes.map(toMinutes);
    const slots = generated
      .filter((slot) => {
        const start = toMinutes(slot.start);
        if (isToday && start <= local.minutes) return false;
        return !booked.some((b) => Math.abs(b - start) < slot.minutes);
      })
      .map((slot) => slot.start);
    return {
      date: input.date,
      weekday,
      closedReason: slots.length === 0 ? 'No slots remain on this day.' : null,
      slots,
    };
  }

  const timing = input.timings.find((entry) => entry.dayName === weekday);
  if (!timing) return empty('No opening hours are configured for this day.');
  if (timing.isClosed) return empty('The clinic is closed on this day.');
  if (!timing.openingTime || !timing.closingTime) {
    return empty('Opening hours for this day are incomplete.');
  }

  if (input.doctor.availableDays.length > 0 && !input.doctor.availableDays.includes(weekday)) {
    return empty('This doctor does not consult on this day.');
  }
  if (hasException(input.doctor.dateExceptions, input.date)) {
    return empty('This doctor is unavailable on this date.');
  }

  // Intersect clinic hours with the doctor's own window.
  const windowStart = Math.max(
    toMinutes(timing.openingTime),
    input.doctor.availableStartTime ? toMinutes(input.doctor.availableStartTime) : 0,
  );
  const windowEnd = Math.min(
    toMinutes(timing.closingTime),
    input.doctor.availableEndTime ? toMinutes(input.doctor.availableEndTime) : MINUTES_PER_DAY,
  );

  if (windowEnd - windowStart < input.slotMinutes) {
    return empty('No consultation window is available on this day.');
  }

  const lunchStart = timing.lunchBreakStart ? toMinutes(timing.lunchBreakStart) : null;
  const lunchEnd = timing.lunchBreakEnd ? toMinutes(timing.lunchBreakEnd) : null;
  const booked = new Set(input.bookedTimes);

  const local = localNow(input.now, input.timeZone ?? 'UTC');
  const isToday = input.date === local.date;
  const minutesNow = local.minutes;

  // Explicit weekly slots take precedence over the generated grid.
  const explicit = !isWeeklySchedule(input.doctor.weeklySlots) && Array.isArray(input.doctor.weeklySlots?.[weekday])
    ? (input.doctor.weeklySlots![weekday] as Array<{ start_time?: string; is_active?: boolean }>)
        .filter((s) => s && s.is_active !== false && typeof s.start_time === 'string' && /^\d{2}:\d{2}$/.test(s.start_time))
        .map((s) => toMinutes(s.start_time!))
    : [];
  const clinicOpen = toMinutes(timing.openingTime);
  const clinicClose = toMinutes(timing.closingTime);
  const candidates = explicit.length
    ? [...new Set(explicit)].filter((m) => m >= clinicOpen && m + input.slotMinutes <= clinicClose).sort((a, b) => a - b)
    : (() => {
        const grid: number[] = [];
        for (let cursor = windowStart; cursor + input.slotMinutes <= windowEnd; cursor += input.slotMinutes) grid.push(cursor);
        return grid;
      })();

  const slots: string[] = [];
  for (const cursor of candidates) {
    // A slot overlapping lunch at all is excluded, not just one starting in it.
    if (lunchStart !== null && lunchEnd !== null) {
      const overlapsLunch = cursor < lunchEnd && cursor + input.slotMinutes > lunchStart;
      if (overlapsLunch) continue;
    }
    if (isToday && cursor <= minutesNow) continue;

    const time = toTimeString(cursor);
    if (booked.has(time)) continue;
    slots.push(time);
  }

  return {
    date: input.date,
    weekday,
    closedReason: slots.length === 0 ? 'No slots remain on this day.' : null,
    slots,
  };
}

/** Whether a specific slot is offerable — the guard the booking path needs. */
export function isSlotAvailable(input: SlotComputationInput, time: string): boolean {
  return computeDaySlots(input).slots.includes(time);
}
