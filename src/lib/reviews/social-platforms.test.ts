import { describe, expect, it } from 'vitest';
import * as si from 'simple-icons';

import { normalizeSocialLink, PLATFORM, sanitizeSocialLinks, SOCIAL_PLATFORMS } from './social-platforms';

const ok = (r: ReturnType<typeof normalizeSocialLink>) => ('url' in r ? r.url : `ERROR: ${r.error}`);

describe('social platform logos', () => {
  it.each(SOCIAL_PLATFORMS.filter((p) => PLATFORM[p].icon))('%s logo decodes to a complete SVG with a path', (p) => {
    const svg = Buffer.from(PLATFORM[p].icon!, 'base64').toString('utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toMatch(/<(path|circle|rect)\b/);
    // Every path's data must only contain SVG path characters.
    for (const m of svg.matchAll(/ d="([^"]*)"/g)) expect(m[1]).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/);
  });

  // The embedded marks must be the official ones, character for character.
  const OFFICIAL: Record<string, { path: string }> = {
    instagram: si.siInstagram, facebook: si.siFacebook, youtube: si.siYoutube, x: si.siX, whatsapp: si.siWhatsapp,
    threads: si.siThreads, telegram: si.siTelegram, pinterest: si.siPinterest, snapchat: si.siSnapchat, tiktok: si.siTiktok,
  };
  it.each(Object.keys(OFFICIAL))('%s matches the Simple Icons brand path', (p) => {
    const svg = Buffer.from(PLATFORM[p as keyof typeof PLATFORM].icon!, 'base64').toString('utf8');
    expect(svg).toContain(`d="${OFFICIAL[p].path}"`);
  });
});

describe('normalizeSocialLink', () => {
  it('builds profile links from handles', () => {
    expect(ok(normalizeSocialLink('instagram', '@getfitgym'))).toBe('https://www.instagram.com/getfitgym/');
    expect(ok(normalizeSocialLink('x', 'getfitgym'))).toBe('https://x.com/getfitgym');
    expect(ok(normalizeSocialLink('tiktok', '@getfit'))).toBe('https://www.tiktok.com/@getfit');
    expect(ok(normalizeSocialLink('whatsapp', '98765 43210'))).toBe('https://wa.me/919876543210');
  });

  it('accepts full links on the platform domain and upgrades to https', () => {
    expect(ok(normalizeSocialLink('instagram', 'instagram.com/getfitgym'))).toBe('https://instagram.com/getfitgym');
    expect(ok(normalizeSocialLink('facebook', 'http://m.facebook.com/getfitgym'))).toBe('https://m.facebook.com/getfitgym');
    expect(ok(normalizeSocialLink('x', 'https://twitter.com/getfit'))).toBe('https://twitter.com/getfit');
  });

  it('opens the YouTube subscribe prompt for channel links', () => {
    expect(ok(normalizeSocialLink('youtube', '@getfitgym'))).toBe('https://www.youtube.com/@getfitgym?sub_confirmation=1');
    expect(ok(normalizeSocialLink('youtube', 'https://youtube.com/channel/UC123abc'))).toBe('https://youtube.com/channel/UC123abc?sub_confirmation=1');
    expect(ok(normalizeSocialLink('youtube', 'https://youtube.com/watch?v=abc'))).toBe('https://youtube.com/watch?v=abc');
  });

  it('rejects links to other sites and bad input', () => {
    expect(ok(normalizeSocialLink('instagram', 'https://evil.example/instagram.com'))).toMatch(/^ERROR: This link is not on Instagram/);
    expect(ok(normalizeSocialLink('facebook', 'https://facebook.com.evil.io/x'))).toMatch(/^ERROR/);
    expect(ok(normalizeSocialLink('linkedin', 'mycompany'))).toMatch(/^ERROR: Paste your full LinkedIn link/);
    expect(ok(normalizeSocialLink('website', 'http://localhost:3000'))).toMatch(/^ERROR/);
    expect(ok(normalizeSocialLink('instagram', ''))).toMatch(/^ERROR/);
  });

  it('keeps one valid link per known platform', () => {
    const out = sanitizeSocialLinks([
      { platform: 'instagram', url: '@one' },
      { platform: 'instagram', url: '@two' },
      { platform: 'myspace', url: 'https://myspace.com/x' },
      { platform: 'x', url: 'https://evil.example' },
      { platform: 'website', url: 'getfit.in' },
    ]);
    expect(out).toEqual([
      { platform: 'instagram', url: 'https://www.instagram.com/one/' },
      { platform: 'website', url: 'https://getfit.in/' },
    ]);
  });
});
