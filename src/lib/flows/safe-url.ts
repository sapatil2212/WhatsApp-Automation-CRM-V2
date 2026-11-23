/**
 * Address and URL checks for the flow "HTTP request" step.
 *
 * Pure (no Node imports) so the same rules run in the editor, in the
 * validator and in the server just before the connection is made. A flow
 * author is a tenant, not an operator: the step must never be able to reach
 * the platform's own network (loopback, private ranges, cloud metadata).
 */

/** True for any address that is not a normal public internet address. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // IPv4-mapped IPv6 (::ffff:10.0.0.1 or ::ffff:0a00:0001)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const octets = v4.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return true; // malformed: refuse
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 169 && b === 254) return true; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  if (ip.includes(':')) {
    if (ip === '::' || ip === '::1') return true;
    if (/^f[cd]/.test(ip)) return true; // unique local fc00::/7
    if (/^fe[89ab]/.test(ip)) return true; // link-local fe80::/10
    if (/^ff/.test(ip)) return true; // multicast
    if (/^(2001:0?db8|2001:db8)/.test(ip)) return true; // documentation
    return false;
  }

  return true; // not an IP at all: caller must resolve first
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet'];
const ALLOWED_PORTS = new Set(['', '443', '8443']);

/** Returns a human-readable problem, or null when the URL may be called. */
export function checkWebhookUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'Enter the URL to call.';
  // Allow {{vars.x}} placeholders while checking the static part.
  const probe = value.replace(/\{\{\s*vars\.[a-zA-Z0-9_]+\s*\}\}/g, 'x');
  let url: URL;
  try {
    url = new URL(probe);
  } catch {
    return 'That is not a valid URL.';
  }
  if (url.protocol !== 'https:') return 'Only https:// URLs can be called.';
  if (url.username || url.password) return 'Put credentials in the Authorization field, not in the URL.';
  if (!ALLOWED_PORTS.has(url.port)) return 'Only the standard HTTPS ports (443, 8443) are allowed.';
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return 'Internal addresses cannot be called.';
  }
  const isLiteral = /^[\d.]+$/.test(host) || host.includes(':');
  if (isLiteral && isPrivateAddress(host)) return 'Private or internal IP addresses cannot be called.';
  if (!isLiteral && !host.includes('.')) return 'Use a full public domain name.';
  return null;
}

/** Reads `a.b.0.c` (and `a[0].b`) from parsed JSON; undefined when absent. */
export function readJsonPath(data: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  let cur: unknown = data;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
