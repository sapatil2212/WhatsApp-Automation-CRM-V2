/**
 * Google review link validation. Pure and dependency-free so it can be used
 * by the API, the public page and tests. A copy of the same rules lives in
 * workers/review-automation/google-url.js (the worker is plain Node); the
 * unit test keeps the two in step.
 *
 * Only https links on Google-owned review hosts are accepted. The URL is
 * never fetched by the API server (no SSRF surface); the worker only
 * navigates to URLs that pass this check.
 */

export type GoogleUrlKind = 'write_review' | 'short_link' | 'maps_link' | 'search_link';

export interface GoogleUrlCheck {
  valid: boolean;
  kind?: GoogleUrlKind;
  /** Canonical form to store (https, no fragments we do not need). */
  normalized?: string;
  reason?: string;
}

const SHORT_HOSTS = new Set(['g.page', 'g.co', 'maps.app.goo.gl', 'goo.gl']);
const GOOGLE_HOST = /^(?:[a-z0-9-]+\.)*google\.(?:com|co\.in|in)$/i;

export function validateGoogleReviewUrl(input: string | null | undefined): GoogleUrlCheck {
  const raw = (input ?? '').trim();
  if (!raw) return { valid: false, reason: 'Enter your Google review link.' };
  if (raw.length > 2000) return { valid: false, reason: 'That link is too long.' };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { valid: false, reason: 'That does not look like a web link.' };
  }
  if (url.protocol === 'http:') url.protocol = 'https:'; // Google review links are always https
  if (url.protocol !== 'https:') return { valid: false, reason: 'The link must start with https://.' };
  if (url.username || url.password) return { valid: false, reason: 'Links with a username or password are not allowed.' };
  if (url.port && url.port !== '443') return { valid: false, reason: 'Unexpected port in the link.' };

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (SHORT_HOSTS.has(host)) {
    if (host === 'g.page' && !/^\/r\/[^/]+\/review\/?$/i.test(path)) {
      return { valid: false, reason: 'This g.page link is not a review link. It should end with /review.' };
    }
    if (path.length <= 1) return { valid: false, reason: 'The short link is incomplete.' };
    return { valid: true, kind: 'short_link', normalized: `https://${host}${path}${url.search}` };
  }

  if (!GOOGLE_HOST.test(host)) return { valid: false, reason: 'Only Google review links are allowed (google.com, g.page or maps.app.goo.gl).' };

  if (/^\/local\/writereview\/?$/i.test(path) && url.searchParams.get('placeid')) {
    return { valid: true, kind: 'write_review', normalized: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(url.searchParams.get('placeid') as string)}` };
  }
  if (/^\/maps\//i.test(path)) return { valid: true, kind: 'maps_link', normalized: url.toString() };
  if (/^\/search\/?$/i.test(path) && (url.searchParams.get('q') || url.hash.includes('lrd='))) {
    return { valid: true, kind: 'search_link', normalized: url.toString() };
  }
  return { valid: false, reason: 'This Google link is not a review link. Use "Get more reviews" in your Google Business Profile.' };
}

export const GOOGLE_LINK_STEPS = [
  'Open Google Search and search for your business name.',
  'Open your Business Profile (sign in with the Google account that manages it).',
  'Select "Read reviews".',
  'Select "Get more reviews".',
  'Copy the review link that appears.',
  'Paste it into ChatNexGen.',
];