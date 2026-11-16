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

  const isToday = input.date === todayUtc(input.now);
  const minutesNow = input.now.getUTCHours() * 60 + input.now.getUTCMinutes();

  const slots: string[] = [];
  for (let cursor = windowStart; cursor + input.slotMinutes <= windowEnd; cursor += input.slotMinutes) {
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
