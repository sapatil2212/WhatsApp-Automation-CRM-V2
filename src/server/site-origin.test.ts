import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publicSiteUrl, requestOrigin } from './site-origin';

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe('site-origin', () => {
  beforeEach(() => {
    delete (globalThis as { __publicOrigin?: string }).__publicOrigin;
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('PORT', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  describe('development', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://chatnexgen.online');
    });

    it('uses the local host and port the app was opened on, not the env domain', () => {
      expect(requestOrigin(req('http://localhost:3002/api/booking-link', { host: 'localhost:3002' }))).toBe('http://localhost:3002');
    });

    it('background links point at localhost on PORT (default 3002)', () => {
      expect(publicSiteUrl()).toBe('http://localhost:3002');
      vi.stubEnv('PORT', '4000');
      expect(publicSiteUrl()).toBe('http://localhost:4000');
    });
  });

  describe('production', () => {
    beforeEach(() => vi.stubEnv('NODE_ENV', 'production'));

    it('uses the public domain from the proxy headers', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
      const r = req('http://localhost:3002/api/booking-link', { host: 'localhost:3002', 'x-forwarded-host': 'chatnexgen.online', 'x-forwarded-proto': 'https' });
      expect(requestOrigin(r)).toBe('https://chatnexgen.online');
    });

    it('falls back to the env URL when the request host is internal', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://chatnexgen.online/');
      expect(requestOrigin(req('http://localhost:3002/x', { host: 'localhost:3002' }))).toBe('https://chatnexgen.online');
    });

    it('background links use the env URL, ignoring placeholders in favour of the last seen domain', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://chatnexgen.online');
      expect(publicSiteUrl()).toBe('https://chatnexgen.online');

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
      expect(publicSiteUrl()).toBe('');
      requestOrigin(req('https://chatnexgen.online/x', { host: 'chatnexgen.online', 'x-forwarded-proto': 'https' }));
      expect(publicSiteUrl()).toBe('https://chatnexgen.online');
    });
  });
});
