'use strict';
/**
 * Google review link rules for the worker. Mirrors src/lib/reviews/google-url.ts
 * (the unit test keeps both in step). The worker only ever navigates to a URL
 * that passes this check.
 */
const SHORT_HOSTS = new Set(['g.page', 'g.co', 'maps.app.goo.gl', 'goo.gl']);
const GOOGLE_HOST = /^(?:[a-z0-9-]+\.)*google\.(?:com|co\.in|in)$/i;

function validateGoogleReviewUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return { valid: false, reason: 'Enter your Google review link.' };
  if (raw.length > 2000) return { valid: false, reason: 'That link is too long.' };
  let url;
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
    if (host === 'g.page' && !/^\/r\/[^/]+\/review\/?$/i.test(path)) return { valid: false, reason: 'This g.page link is not a review link. It should end with /review.' };
    if (path.length <= 1) return { valid: false, reason: 'The short link is incomplete.' };
    return { valid: true, kind: 'short_link', normalized: `https://${host}${path}${url.search}` };
  }
  if (!GOOGLE_HOST.test(host)) return { valid: false, reason: 'Only Google review links are allowed (google.com, g.page or maps.app.goo.gl).' };
  if (/^\/local\/writereview\/?$/i.test(path) && url.searchParams.get('placeid')) {
    return { valid: true, kind: 'write_review', normalized: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(url.searchParams.get('placeid'))}` };
  }
  if (/^\/maps\//i.test(path)) return { valid: true, kind: 'maps_link', normalized: url.toString() };
  if (/^\/search\/?$/i.test(path) && (url.searchParams.get('q') || url.hash.includes('lrd='))) return { valid: true, kind: 'search_link', normalized: url.toString() };
  return { valid: false, reason: 'This Google link is not a review link. Use "Get more reviews" in your Google Business Profile.' };
}

/** After redirects the page must still be on a Google-owned host. */
function isGoogleHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return SHORT_HOSTS.has(h) || GOOGLE_HOST.test(h) || h === 'consent.google.com' || h === 'accounts.google.com';
}

module.exports = { validateGoogleReviewUrl, isGoogleHost };