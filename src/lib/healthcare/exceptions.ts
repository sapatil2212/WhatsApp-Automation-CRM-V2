/**
 * Date-exception normalisation.
 *
 * Business Setup stores holidays, emergency closures and doctor leaves as
 * arrays — `[{ date, is_closed | is_available, reason }]` — while the slot
 * engine expects `{ "YYYY-MM-DD": reason }`. Without this conversion every
 * leave and closure was silently ignored and patients could book a doctor on
 * leave or a clinic that was shut.
 */

import type { JsonValue } from '@/server/dtos/common.dto';

export interface ExceptionEntry {
  date: string;
  reason: string;
}

/** Entries that make the date unavailable (closed / on leave). */
export function blockingExceptions(value: unknown): ExceptionEntry[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
      .filter((e) => {
        if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return false;
        // Clinic rows use is_closed; doctor rows use is_available.
        if ('is_closed' in e) return e.is_closed !== false;
        if ('is_available' in e) return e.is_available === false;
        return true;
      })
      .map((e) => ({ date: e.date as string, reason: String(e.reason ?? '').trim() || 'Unavailable' }));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([date, v]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && v !== false && v !== null && v !== undefined)
      .map(([date, v]) => ({ date, reason: typeof v === 'string' && v.trim() ? v : 'Unavailable' }));
  }
  return [];
}

/** Record form for the slot engine. */
export function exceptionsToRecord(value: unknown): Record<string, JsonValue> {
  return Object.fromEntries(blockingExceptions(value).map((e) => [e.date, e.reason]));
}
