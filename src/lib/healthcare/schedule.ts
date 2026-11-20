/**
 * Doctor weekly availability schedule (v2).
 *
 * Stored on `Doctor.weeklySlots` (JSON) as `{ version: 2, ... }`. Each of the
 * seven days has three sessions — morning (00:00–12:00), afternoon
 * (12:00–16:00) and evening (16:00–24:00) — with their own working window,
 * slot duration and breaks. Slots are generated from this, never stored.
 *
 * Pure functions only: shared by the schedule editor, the API validator and
 * the booking slot engine, so what the admin sees is exactly what patients
 * can book.
 */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const SESSION_KEYS = ['morning', 'afternoon', 'evening'] as const;
export type SessionKey = (typeof SESSION_KEYS)[number];

/** Hard bounds of each session (minutes from midnight). */
export const SESSION_BOUNDS: Record<SessionKey, { label: string; start: number; end: number }> = {
  morning: { label: 'Morning', start: 0, end: 12 * 60 },
  afternoon: { label: 'Afternoon', start: 12 * 60, end: 16 * 60 },
  evening: { label: 'Evening', start: 16 * 60, end: 24 * 60 },
};

export const SLOT_DURATIONS = [10, 15, 20, 30, 45, 60] as const;

export interface ScheduleBreak {
  id: string;
  name: string;
  start: string; // HH:MM
  end: string; // HH:MM
}

export interface ScheduleSession {
  enabled: boolean;
  start: string; // HH:MM
  end: string; // HH:MM (24:00 allowed for evening)
  slotMinutes: number;
  breaks: ScheduleBreak[];
}

export interface ScheduleDay {
  enabled: boolean;
  sessions: Record<SessionKey, ScheduleSession>;
}

export interface WeeklySchedule {
  version: 2;
  days: Record<Weekday, ScheduleDay>;
}

// ── time helpers ─────────────────────────────────────────────────────

export function toMin(t: string): number {
  if (t === '24:00') return 24 * 60;
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toHHMM(min: number): string {
  if (min >= 24 * 60) return '24:00';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function to12h(t: string): string {
  const m = toMin(t);
  if (!Number.isFinite(m)) return t;
  if (m >= 24 * 60) return '12:00 AM';
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// ── defaults ─────────────────────────────────────────────────────────

/** Sensible working windows used when a session/day is switched on. */
const WORKING_DEFAULTS: Record<SessionKey, { start: string; end: string; enabled: boolean }> = {
  morning: { start: '09:00', end: '12:00', enabled: true },
  afternoon: { start: '12:00', end: '16:00', enabled: false },
  evening: { start: '16:00', end: '20:00', enabled: true },
};

export function defaultSession(key: SessionKey, slotMinutes = 30): ScheduleSession {
  const d = WORKING_DEFAULTS[key];
  return { enabled: d.enabled, start: d.start, end: d.end, slotMinutes, breaks: [] };
}

export function defaultDay(enabled: boolean, slotMinutes = 30): ScheduleDay {
  return {
    enabled,
    sessions: {
      morning: defaultSession('morning', slotMinutes),
      afternoon: defaultSession('afternoon', slotMinutes),
      evening: defaultSession('evening', slotMinutes),
    },
  };
}

export function defaultSchedule(): WeeklySchedule {
  const days = {} as Record<Weekday, ScheduleDay>;
  for (const d of WEEKDAYS) days[d] = defaultDay(d !== 'Sunday' && d !== 'Saturday');
  return { version: 2, days };
}

export function isWeeklySchedule(v: unknown): v is WeeklySchedule {
  return Boolean(v) && typeof v === 'object' && (v as { version?: unknown }).version === 2 && typeof (v as { days?: unknown }).days === 'object';
}

/**
 * Converts the older doctor fields (availableDays + start/end, or the v1
 * `{ Monday: [{ start_time, end_time, is_active }] }` slot lists) into v2,
 * so existing doctors open in the new editor with their current hours.
 */
export function fromLegacy(input: {
  weeklySlots?: unknown;
  availableDays?: unknown;
  availableStartTime?: string | null;
  availableEndTime?: string | null;
}): WeeklySchedule {
  if (isWeeklySchedule(input.weeklySlots)) return normalizeSchedule(input.weeklySlots);
  const schedule = defaultSchedule();
  const days = Array.isArray(input.availableDays) ? (input.availableDays as string[]) : [];
  const v1 = input.weeklySlots && typeof input.weeklySlots === 'object' ? (input.weeklySlots as Record<string, unknown>) : {};
  const start = /^\d{2}:\d{2}$/.test(input.availableStartTime ?? '') ? input.availableStartTime! : null;
  const end = /^\d{2}:\d{2}$/.test(input.availableEndTime ?? '') ? input.availableEndTime! : null;

  for (const d of WEEKDAYS) {
    const v1Slots = Array.isArray(v1[d])
      ? (v1[d] as Array<{ start_time?: string; end_time?: string; is_active?: boolean }>).filter((s) => s?.is_active !== false && s?.start_time)
      : [];
    const winStart = v1Slots.length ? Math.min(...v1Slots.map((s) => toMin(s.start_time!))) : start ? toMin(start) : NaN;
    const winEnd = v1Slots.length ? Math.max(...v1Slots.map((s) => toMin(s.end_time || s.start_time!))) : end ? toMin(end) : NaN;
    const slotMinutes = v1Slots.length && v1Slots[0].end_time ? Math.max(5, toMin(v1Slots[0].end_time!) - toMin(v1Slots[0].start_time!)) : 30;
    const enabled = days.length ? days.includes(d) : v1Slots.length > 0;
    const day = defaultDay(enabled, SLOT_DURATIONS.includes(slotMinutes as never) ? slotMinutes : 30);
    if (Number.isFinite(winStart) && Number.isFinite(winEnd) && winEnd > winStart) {
      for (const key of SESSION_KEYS) {
        const b = SESSION_BOUNDS[key];
        const s = Math.max(winStart, b.start);
        const e = Math.min(winEnd, b.end);
        day.sessions[key] = { ...day.sessions[key], enabled: e - s >= day.sessions[key].slotMinutes, start: toHHMM(s < e ? s : b.start), end: toHHMM(s < e ? e : b.end) };
      }
    }
    schedule.days[d] = day;
  }
  return schedule;
}

/** Fills missing pieces so partially-formed JSON is always safe to use. */
export function normalizeSchedule(s: WeeklySchedule): WeeklySchedule {
  const out = defaultSchedule();
  for (const d of WEEKDAYS) {
    const src = s.days?.[d];
    if (!src) continue;
    out.days[d].enabled = Boolean(src.enabled);
    for (const key of SESSION_KEYS) {
      const ss = src.sessions?.[key];
      if (!ss) continue;
      out.days[d].sessions[key] = {
        enabled: Boolean(ss.enabled),
        start: typeof ss.start === 'string' ? ss.start : out.days[d].sessions[key].start,
        end: typeof ss.end === 'string' ? ss.end : out.days[d].sessions[key].end,
        slotMinutes: Number(ss.slotMinutes) || 30,
        breaks: Array.isArray(ss.breaks)
          ? ss.breaks.filter((b) => b && typeof b.start === 'string' && typeof b.end === 'string').map((b) => ({ id: b.id || newId(), name: String(b.name || 'Break').slice(0, 40), start: b.start, end: b.end }))
          : [],
      };
    }
  }
  return out;
}

// ── validation ───────────────────────────────────────────────────────

export interface ScheduleIssue {
  day: Weekday;
  session?: SessionKey;
  message: string;
}

export function validateSchedule(s: WeeklySchedule): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  for (const day of WEEKDAYS) {
    const d = s.days[day];
    if (!d?.enabled) continue;
    let activeSessions = 0;
    for (const key of SESSION_KEYS) {
      const ss = d.sessions[key];
      if (!ss.enabled) continue;
      activeSessions += 1;
      const b = SESSION_BOUNDS[key];
      const start = toMin(ss.start);
      const end = toMin(ss.end);
      const label = `${b.label}`;
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        issues.push({ day, session: key, message: `${label}: enter valid start and end times.` });
        continue;
      }
      if (start < b.start || end > b.end) {
        issues.push({ day, session: key, message: `${label} must be between ${to12h(toHHMM(b.start))} and ${to12h(toHHMM(b.end))}.` });
      }
      if (end <= start) issues.push({ day, session: key, message: `${label}: end time must be after start time.` });
      if (!(ss.slotMinutes >= 5 && ss.slotMinutes <= 240)) issues.push({ day, session: key, message: `${label}: slot duration must be 5–240 minutes.` });
      else if (end - start < ss.slotMinutes) issues.push({ day, session: key, message: `${label}: window is shorter than one ${ss.slotMinutes}-minute slot.` });

      const breaks = [...ss.breaks].sort((x, y) => toMin(x.start) - toMin(y.start));
      breaks.forEach((br, i) => {
        const bs = toMin(br.start);
        const be = toMin(br.end);
        if (!Number.isFinite(bs) || !Number.isFinite(be) || be <= bs) {
          issues.push({ day, session: key, message: `Break "${br.name}": end must be after start.` });
          return;
        }
        if (bs < start || be > end) issues.push({ day, session: key, message: `Break "${br.name}" must be inside the ${label.toLowerCase()} session (${to12h(ss.start)}–${to12h(ss.end)}).` });
        const next = breaks[i + 1];
        if (next && toMin(next.start) < be) issues.push({ day, session: key, message: `Breaks "${br.name}" and "${next.name}" overlap.` });
      });
    }
    if (!activeSessions) issues.push({ day, message: `${day} is a working day but has no active session.` });
  }
  return issues;
}

// ── slot generation ──────────────────────────────────────────────────

export interface GeneratedSlot {
  start: string; // HH:MM
  minutes: number;
  session: SessionKey;
}

export function sessionSlots(ss: ScheduleSession, key: SessionKey): GeneratedSlot[] {
  if (!ss.enabled) return [];
  const start = toMin(ss.start);
  const end = toMin(ss.end);
  const dur = ss.slotMinutes;
  if (!Number.isFinite(start) || !Number.isFinite(end) || dur < 5 || end <= start) return [];
  const breaks = ss.breaks.map((b) => [toMin(b.start), toMin(b.end)] as const).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
  const out: GeneratedSlot[] = [];
  let cursor = start;
  while (cursor + dur <= end) {
    const clash = breaks.find(([bs, be]) => cursor < be && cursor + dur > bs);
    if (clash) {
      // Restart right after the break so slots stay aligned to it.
      cursor = clash[1];
      continue;
    }
    if (cursor < 24 * 60) out.push({ start: toHHMM(cursor), minutes: dur, session: key });
    cursor += dur;
  }
  return out;
}

export function daySlots(day: ScheduleDay | undefined): GeneratedSlot[] {
  if (!day?.enabled) return [];
  return SESSION_KEYS.flatMap((k) => sessionSlots(day.sessions[k], k)).sort((a, b) => toMin(a.start) - toMin(b.start));
}

export function breakMinutes(day: ScheduleDay | undefined): number {
  if (!day?.enabled) return 0;
  return SESSION_KEYS.reduce(
    (sum, k) => sum + (day.sessions[k].enabled ? day.sessions[k].breaks.reduce((s, b) => s + Math.max(0, toMin(b.end) - toMin(b.start)), 0) : 0),
    0,
  );
}

export interface ScheduleSummary {
  workingDays: number;
  slotsPerWeek: number;
  breakMinutesPerWeek: number;
  activeDays: Weekday[];
  inactiveDays: Weekday[];
  perDay: Record<Weekday, number>;
}

export function summarize(s: WeeklySchedule): ScheduleSummary {
  const perDay = {} as Record<Weekday, number>;
  for (const d of WEEKDAYS) perDay[d] = daySlots(s.days[d]).length;
  const activeDays = WEEKDAYS.filter((d) => s.days[d]?.enabled && perDay[d] > 0);
  return {
    workingDays: activeDays.length,
    slotsPerWeek: WEEKDAYS.reduce((n, d) => n + perDay[d], 0),
    breakMinutesPerWeek: WEEKDAYS.reduce((n, d) => n + breakMinutes(s.days[d]), 0),
    activeDays,
    inactiveDays: WEEKDAYS.filter((d) => !activeDays.includes(d)),
    perDay,
  };
}

// ── presets & copy helpers ───────────────────────────────────────────

export type Preset = 'mon_fri' | 'mon_sat' | 'all' | 'weekends' | 'clear';

const PRESET_DAYS: Record<Preset, Weekday[]> = {
  mon_fri: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  mon_sat: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  all: [...WEEKDAYS],
  weekends: ['Saturday', 'Sunday'],
  clear: [],
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Enables exactly the preset's days; newly enabled days get working sessions. */
export function applyPreset(s: WeeklySchedule, preset: Preset): WeeklySchedule {
  const out = clone(s);
  for (const d of WEEKDAYS) {
    const on = PRESET_DAYS[preset].includes(d);
    if (on && !out.days[d].enabled && !SESSION_KEYS.some((k) => out.days[d].sessions[k].enabled)) out.days[d] = defaultDay(true);
    out.days[d].enabled = on;
  }
  return out;
}

/** Copies one day's sessions & breaks to other days (fresh break ids). */
export function copyDay(s: WeeklySchedule, from: Weekday, to: Weekday[]): WeeklySchedule {
  const out = clone(s);
  for (const d of to) {
    if (d === from) continue;
    const copy = clone(out.days[from]);
    for (const k of SESSION_KEYS) copy.sessions[k].breaks = copy.sessions[k].breaks.map((b) => ({ ...b, id: newId() }));
    out.days[d] = { ...copy, enabled: true };
  }
  return out;
}

/** "Apply same sessions to all active days." */
export function applyToActiveDays(s: WeeklySchedule, from: Weekday): WeeklySchedule {
  return copyDay(s, from, WEEKDAYS.filter((d) => s.days[d].enabled));
}

/** Copies a break into the same session of other days (skips exact duplicates). */
export function copyBreakToDays(s: WeeklySchedule, from: Weekday, session: SessionKey, breakId: string, to: Weekday[]): WeeklySchedule {
  const out = clone(s);
  const br = out.days[from].sessions[session].breaks.find((b) => b.id === breakId);
  if (!br) return out;
  for (const d of to) {
    if (d === from) continue;
    const list = out.days[d].sessions[session].breaks;
    if (!list.some((b) => b.start === br.start && b.end === br.end)) list.push({ ...br, id: newId() });
  }
  return out;
}

/** Legacy fields kept in sync for older readers (AI prompt, exports). */
export function legacyFields(s: WeeklySchedule): { availableDays: string[]; availableStartTime: string | null; availableEndTime: string | null } {
  const sum = summarize(s);
  const all = sum.activeDays.flatMap((d) => daySlots(s.days[d]));
  if (!all.length) return { availableDays: sum.activeDays, availableStartTime: null, availableEndTime: null };
  const first = Math.min(...all.map((x) => toMin(x.start)));
  const last = Math.max(...all.map((x) => toMin(x.start) + x.minutes));
  return { availableDays: sum.activeDays, availableStartTime: toHHMM(first), availableEndTime: toHHMM(Math.min(last, 23 * 60 + 59)) };
}

/** Human summary for one day, e.g. "9:00 AM–12:00 PM, 4:00 PM–8:00 PM". */
export function describeDay(day: ScheduleDay | undefined): string {
  if (!day?.enabled) return 'Off';
  const parts = SESSION_KEYS.filter((k) => day.sessions[k].enabled).map((k) => `${to12h(day.sessions[k].start)}–${to12h(day.sessions[k].end)}`);
  return parts.join(', ') || 'Off';
}
