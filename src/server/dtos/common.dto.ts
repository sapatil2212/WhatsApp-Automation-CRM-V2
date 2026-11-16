/**
 * DTO primitives.
 *
 * A DTO is the *wire contract*: it is validated on the way out, and Zod's
 * object parsing strips anything not declared, so it doubles as a
 * serialisation allowlist. Prisma rows never leave the server directly.
 *
 * Conventions, applied everywhere:
 *  - camelCase keys, matching Prisma. (The old shim hand-converted to
 *    snake_case in both directions and lost data doing it.)
 *  - `DateTime` → ISO-8601 string. JSON has no date type; sending a Date
 *    object and hoping is how "invalid date" bugs happen.
 *  - `Decimal` → number. Prisma returns a Decimal instance that
 *    serialises to `{}`.
 *  - Absent optional values are `null`, never `undefined`. One shape for
 *    the client to handle.
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';

/** ISO timestamp on the wire. */
export const isoDateSchema = z.string().datetime({ offset: true });

/** Serialises a Prisma DateTime, tolerating already-string input. */
export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

/** `@db.Date` columns carry no meaningful time component. */
export function toDateOnly(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date.');

/**
 * Prisma `Decimal` → number. Anything with a `toString` (Decimal, string,
 * number) is accepted so callers do not need to know which they hold.
 */
export function toNumber(value: { toString(): string } | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return value;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toNumberOrNull(value: { toString(): string } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Prisma `Json` columns are typed `JsonValue`, which includes `DbNull` /
 * `JsonNull` sentinels. This narrows them for the wire.
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)]),
);

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Prisma's JSON-null sentinels are opaque objects, not `null`. Reads
 * normally hand back a real `null`, but a value built for a write can
 * reach a mapper, and `JSON.stringify(Prisma.DbNull)` yields `{}` — which
 * would masquerade as a legitimately empty JSON object. Compared by
 * identity because that is the only reliable discriminator.
 */
function isPrismaNullSentinel(value: unknown): boolean {
  return value === Prisma.DbNull || value === Prisma.JsonNull || value === Prisma.AnyNull;
}

export function toJson(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (isPrismaNullSentinel(value)) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/**
 * Prepares a value for a Prisma `Json` column on write.
 *
 * Prisma's `InputJsonValue` does not accept `Record<string, unknown>[]`,
 * because an index signature of `unknown` is not assignable to a JSON
 * value. Round-tripping through JSON both narrows the type and strips
 * anything non-serialisable (Dates, class instances) that would otherwise
 * be persisted in a surprising shape. `undefined` is preserved so callers
 * can distinguish "leave this column alone" from "set it to null".
 */
export function toInputJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Object-shaped Json column, defaulting to `{}`. */
export function toJsonObject(value: unknown): Record<string, JsonValue> {
  const json = toJson(value);
  return json !== null && typeof json === 'object' && !Array.isArray(json) ? json : {};
}

/** Array-shaped Json column, defaulting to `[]`. */
export function toJsonArray(value: unknown): JsonValue[] {
  const json = toJson(value);
  return Array.isArray(json) ? json : [];
}

/** String-array Json column (tags, keywords, languages). */
export function toStringArray(value: unknown): string[] {
  return toJsonArray(value).filter((item): item is string => typeof item === 'string');
}

/**
 * Wraps an item schema as a list DTO. Pagination itself lives in
 * `meta.pagination`, so the payload stays a plain array of items — the
 * client never has to unwrap two layers.
 */
export function listOf<TSchema extends z.ZodTypeAny>(item: TSchema) {
  return z.array(item);
}

/** Response DTO for endpoints whose only meaningful output is "it worked". */
export const acknowledgedSchema = z.object({
  id: z.string().nullable(),
});
export type Acknowledged = z.infer<typeof acknowledgedSchema>;

/** Response DTO for bulk operations. */
export const bulkResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errors: z.array(z.object({ index: z.number().int(), reason: z.string() })),
});
export type BulkResult = z.infer<typeof bulkResultSchema>;
