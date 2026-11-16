/**
 * Shared request-validation primitives.
 *
 * Every domain validator composes from these so that "what is a valid id"
 * or "what is a valid phone number" has exactly one answer. The old code
 * had four different phone checks (none on the contact-create path) and
 * no id validation at all.
 */

import { z } from 'zod';

import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

/**
 * All primary keys are `@default(uuid())`. Validating the shape means a
 * malformed id fails at the boundary with a 400 instead of reaching the
 * database.
 */
export const idSchema = z.string().uuid('Must be a valid id.');

export const idParamSchema = z.object({ id: idSchema });
export type IdParam = z.infer<typeof idParamSchema>;

/** Trimmed, non-empty, length-capped text. */
export function requiredText(max: number, label = 'Value') {
  return z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);
}

/** Trimmed text where empty string is normalised to `null`. */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullish()
    .transform((value) => value ?? null);
}

export const emailSchema = z.string().trim().toLowerCase().email('Must be a valid email address.').max(255);

export const optionalEmailSchema = z
  .union([emailSchema, z.literal('')])
  .nullish()
  .transform((value) => (value ? value : null));

/**
 * Phone numbers are stored digits-only, exactly as Meta requires, so the
 * inbox, broadcasts, and the webhook all compare like with like. This is
 * the fix for contacts being created in a format that later fails to
 * send.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required.')
  .transform(sanitizePhoneForMeta)
  .refine((value) => isValidE164(value), {
    message: 'Must be a valid international phone number (7–15 digits, country code first).',
  });

export const optionalPhoneSchema = z
  .union([phoneSchema, z.literal('')])
  .nullish()
  .transform((value) => (value ? value : null));

/** Hex colour used by tags and pipeline stages. */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour such as #3b82f6.');

export const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid http(s) URL.' },
  );

export const optionalHttpUrlSchema = z
  .union([httpUrlSchema, z.literal('')])
  .nullish()
  .transform((value) => (value ? value : null));

/**
 * A calendar date with no time component, for `@db.Date` columns.
 *
 * Parsed at **UTC** midnight, deliberately. The previous code wrote
 * `new Date(dateString + 'T00:00:00')`, which JavaScript interprets in the
 * server's local zone; Prisma then stored it as UTC. On any server ahead of
 * UTC — IST, for instance — `2026-05-30` became `2026-05-29T18:30Z` and the
 * stored date was a day early. Every appointment booked from an Indian host
 * was off by one.
 */
export const dateOnlyInputSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
  .transform((value, ctx) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a valid date.' });
      return z.NEVER;
    }
    // Round-trip check rejects impossible dates that Date silently rolls
    // over, e.g. 2026-02-30 becoming 2026-03-02.
    if (parsed.toISOString().slice(0, 10) !== value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a valid calendar date.' });
      return z.NEVER;
    }
    return parsed;
  });

/** `HH:mm` on a 24-hour clock. */
export const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour HH:mm time.');

/** Free-text search term. Bounded so it cannot be used as a DoS vector. */
export const searchSchema = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

/**
 * Comma-separated list of ids in a query string (`?tagIds=a,b,c`), which
 * is how the browser will send multi-select filters.
 */
export const idListQuerySchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const raw = Array.isArray(value) ? value : value.split(',');
    const ids = raw.map((item) => item.trim()).filter((item) => item.length > 0);
    return ids.length > 0 ? ids : undefined;
  })
  .refine((ids) => ids === undefined || ids.every((id) => idSchema.safeParse(id).success), {
    message: 'Contains an invalid id.',
  });

/** Booleans arriving as query strings. */
export const booleanQuerySchema = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === true || value === 'true'));

/**
 * Guards a PATCH body against being empty. An empty patch is almost
 * always a client bug, and silently succeeding hides it.
 */
export function nonEmptyPatch<TShape extends z.ZodRawShape>(schema: z.ZodObject<TShape>) {
  return schema.refine((value) => Object.keys(value as Record<string, unknown>).length > 0, {
    message: 'Provide at least one field to update.',
  });
}
