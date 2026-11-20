/**
 * Human-readable, stable booking links: /book/<business-name>.
 *
 * The slug is derived from the clinic / business name, so it never changes
 * unless the business is renamed. Names are shared across all tenants, so:
 *   - the oldest business with a given name owns the plain slug
 *     ("sunrise-clinic");
 *   - any later one gets a fixed suffix from its own id
 *     ("sunrise-clinic-3f9a"), which never shifts when others join or leave.
 * Old UUID links keep resolving, so links already sent on WhatsApp still work.
 */

import { systemDb } from '../kernel';

export type BookingKind = 'clinic' | 'business';

interface Entry {
  kind: BookingKind;
  id: string;
  base: string;
  createdAt: number;
}

const SUFFIX_LEN = 4;
const CACHE_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function slugify(name: string | null | undefined): string {
  const s = (name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'book';
}

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

const shortId = (id: string) => id.replace(/-/g, '').slice(0, SUFFIX_LEN).toLowerCase();

let cache: { at: number; entries: Entry[] } | null = null;

async function directory(): Promise<Entry[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.entries;
  const [clinics, businesses] = await Promise.all([
    systemDb.clinic.findMany({ select: { id: true, clinicName: true, createdAt: true } }),
    systemDb.businessProfile.findMany({ select: { id: true, businessName: true, createdAt: true } }),
  ]);
  const entries: Entry[] = [
    ...clinics.map((c) => ({ kind: 'clinic' as const, id: c.id, base: slugify(c.clinicName), createdAt: c.createdAt.getTime() })),
    ...businesses.map((b) => ({ kind: 'business' as const, id: b.id, base: slugify(b.businessName), createdAt: b.createdAt.getTime() })),
  ];
  cache = { at: Date.now(), entries };
  return entries;
}

/** Drops the cache (call after a business is created or renamed). */
export function invalidateBookingSlugs(): void {
  cache = null;
}

/** Oldest entry wins the plain slug; ties broken by id so it is deterministic. */
function owner(entries: Entry[], base: string): Entry | undefined {
  return entries
    .filter((e) => e.base === base)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
}

/** Pure: the canonical slug for `id` given every business's name. */
export function slugFor(entries: Entry[], id: string): string | null {
  const me = entries.find((e) => e.id === id);
  if (!me) return null;
  return owner(entries, me.base)?.id === id ? me.base : `${me.base}-${shortId(id)}`;
}

/** Pure: which business a slug points at (plain or suffixed form). */
export function resolveSlugIn(entries: Entry[], slug: string): Entry | null {
  const s = slug.toLowerCase();
  const plain = owner(entries, s);
  if (plain) return plain;
  const m = new RegExp(`^(.+)-([0-9a-f]{${SUFFIX_LEN}})$`).exec(s);
  if (!m) return null;
  const hits = entries.filter((e) => e.base === m[1] && shortId(e.id) === m[2]);
  return hits.length === 1 ? hits[0] : null;
}

export async function bookingSlugFor(id: string): Promise<string> {
  let slug = slugFor(await directory(), id);
  if (!slug) {
    // Created after the cache was filled.
    invalidateBookingSlugs();
    slug = slugFor(await directory(), id);
  }
  return slug ?? id;
}

/** Resolves a slug or a legacy UUID to `{ kind, id }`. */
export async function resolveBookingRef(ref: string): Promise<{ kind: BookingKind; id: string } | null> {
  if (isUuid(ref)) return null; // caller looks UUIDs up directly
  let hit = resolveSlugIn(await directory(), ref);
  if (!hit && cache) {
    invalidateBookingSlugs();
    hit = resolveSlugIn(await directory(), ref);
  }
  return hit ? { kind: hit.kind, id: hit.id } : null;
}

export type { Entry as BookingSlugEntry };
