/**
 * Public origin (scheme + host) for links and QR codes: booking links,
 * review links, prescription verify links.
 *
 * Nothing is hard-coded:
 * - Local development (NODE_ENV !== 'production') always uses the host the app
 *   was opened on, e.g. http://localhost:3002. Background jobs with no request
 *   use http://localhost:$PORT (default 3002).
 * - Production uses the domain the request came in on (https://chatnexgen.online
 *   or wherever it is deployed). For background jobs (WhatsApp reminders etc.)
 *   NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL is used; if that is unset or a
 *   placeholder, the last public domain seen by this server is used instead.
 */

const isProd = () => process.env.NODE_ENV === 'production';
const devOrigin = () => `http://localhost:${process.env.PORT || 3002}`;
const PLACEHOLDER = /(^|\.)example\.(com|org|net)$|your-?domain|^localhost$/i;

const store = globalThis as unknown as { __publicOrigin?: string };

/** Configured site URL, ignoring empty values and obvious placeholders. */
function envOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return PLACEHOLDER.test(u.hostname) ? '' : u.origin;
  } catch {
    return '';
  }
}

function isInternalHost(hostname: string): boolean {
  return (
    !hostname ||
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.startsWith('[')
  );
}

/** Origin for a link built while handling a web request. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const first = (v: string | null) => (v ?? '').split(',')[0].trim();
  const host = first(request.headers.get('x-forwarded-host')) || first(request.headers.get('host')) || url.host;
  const proto = first(request.headers.get('x-forwarded-proto')) || url.protocol.replace(':', '');
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  const fromRequest = host ? `${proto}://${host}` : '';

  if (!isProd()) return fromRequest || devOrigin();

  if (!isInternalHost(hostname)) {
    store.__publicOrigin = fromRequest;
    return fromRequest;
  }
  // Production request that reached us on an internal host (proxy without Host forwarding).
  return envOrigin() || store.__publicOrigin || fromRequest;
}

/** Origin for links built outside a request (reminders, schedulers, notifications). */
export function publicSiteUrl(): string {
  if (!isProd()) return devOrigin();
  return envOrigin() || store.__publicOrigin || '';
}
