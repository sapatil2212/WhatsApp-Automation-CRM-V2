import { describe, expect, it } from 'vitest';

import { isUuid, resolveSlugIn, slugFor, slugify, type BookingSlugEntry } from './booking-slug';

const e = (id: string, base: string, createdAt: number, kind: 'clinic' | 'business' = 'clinic'): BookingSlugEntry => ({ id, base, createdAt, kind });

const A = 'aaaa1111-0000-4000-8000-000000000001';
const B = 'bbbb2222-0000-4000-8000-000000000002';
const C = 'cccc3333-0000-4000-8000-000000000003';

describe('slugify', () => {
  it('makes readable, url-safe slugs', () => {
    expect(slugify('Sunrise Dental Clinic')).toBe('sunrise-dental-clinic');
    expect(slugify("  Dr. Mehta's Skin & Hair Care!! ")).toBe('dr-mehta-s-skin-and-hair-care');
    expect(slugify('Clínica Médica')).toBe('clinica-medica');
    expect(slugify('')).toBe('book');
    expect(slugify('!!!')).toBe('book');
  });
});

describe('slug ownership', () => {
  const entries = [e(B, 'sunrise-clinic', 200), e(A, 'sunrise-clinic', 100), e(C, 'get-fit-gym', 50, 'business')];

  it('gives the plain slug to the oldest business with that name', () => {
    expect(slugFor(entries, A)).toBe('sunrise-clinic');
    expect(slugFor(entries, C)).toBe('get-fit-gym');
  });

  it('gives later namesakes a fixed suffix from their own id', () => {
    expect(slugFor(entries, B)).toBe('sunrise-clinic-bbbb');
  });

  it('resolves both forms back to the right business', () => {
    expect(resolveSlugIn(entries, 'sunrise-clinic')?.id).toBe(A);
    expect(resolveSlugIn(entries, 'sunrise-clinic-bbbb')?.id).toBe(B);
    expect(resolveSlugIn(entries, 'SUNRISE-CLINIC')?.id).toBe(A);
    expect(resolveSlugIn(entries, 'get-fit-gym')?.kind).toBe('business');
    expect(resolveSlugIn(entries, 'unknown')).toBeNull();
    expect(resolveSlugIn(entries, 'sunrise-clinic-ffff')).toBeNull();
  });

  it('keeps a suffixed link working after the original owner leaves', () => {
    const remaining = entries.filter((x) => x.id !== A);
    expect(resolveSlugIn(remaining, 'sunrise-clinic-bbbb')?.id).toBe(B);
  });

  it('does not change an existing slug when a namesake joins later', () => {
    const later = [...entries, e('dddd4444-0000-4000-8000-000000000004', 'sunrise-clinic', 999)];
    expect(slugFor(later, A)).toBe('sunrise-clinic');
    expect(slugFor(later, B)).toBe('sunrise-clinic-bbbb');
  });

  it('recognises legacy uuid links', () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid('sunrise-clinic')).toBe(false);
  });
});
