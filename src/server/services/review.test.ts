import { describe, expect, it } from 'vitest';

import { newPublicToken, PUBLIC_TOKEN_RE } from '@/lib/reviews/token';
import { qrPng, qrSvg, reviewUrl, safeColor } from '@/lib/reviews/qr';

import { buildDraftPrompt, cleanDrafts } from './review-ai.service';
import { TENANT_SCOPES } from '../kernel/tenant-scope';
import { approveBodySchema, eventBodySchema, feedbackBodySchema } from './review-public.service';
import { businessBodySchema } from './review.service';

const business = { name: 'Sunrise Dental', category: 'Dentist', description: 'Family dental clinic', services: ['Cleaning', 'Braces'] };

describe('review AI drafts', () => {
  it('keeps a negative rating negative: drops praise, never invents positivity', () => {
    const out = cleanDrafts(['Excellent service, highly recommend!', 'I waited over an hour and nobody told me why.'], 1, 3);
    expect(out).toEqual(['I waited over an hour and nobody told me why.']);
  });

  it('removes links, phone numbers, hashtags and duplicates', () => {
    const out = cleanDrafts(['Visit www.spam.com now', 'Call +91 98765 43210 today', '#best clinic around', 'Good checkup, polite staff.', 'good checkup, polite staff.'], 5, 3);
    expect(out).toEqual(['Good checkup, polite staff.']);
  });

  it('limits the number of drafts and trims whitespace', () => {
    const out = cleanDrafts(['  First   draft here.  ', 'Second draft is here.', 'Third draft is here.', 'Fourth draft is here.'], 5, 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('First draft here.');
  });

  it('prompt carries the customer wording, rating and the no-invention rules', () => {
    const p = buildDraftPrompt({ business, rating: 2, feedback: 'Long wait, staff was rude.', language: 'hinglish', count: 3 });
    expect(p).toContain('Long wait, staff was rude.');
    expect(p).toContain('NEGATIVE');
    expect(p).toMatch(/Never invent/);
    expect(p).toContain('Hinglish');
    expect(p).toContain('Sunrise Dental');
  });

  it('prompt handles an empty feedback honestly', () => {
    const p = buildDraftPrompt({ business, rating: 5, feedback: '', language: 'en', count: 3 });
    expect(p).toContain('no details given');
    expect(p).toMatch(/mention no specifics/);
  });
});

describe('public review input validation', () => {
  const visitorId = 'abcdefgh1234';
  it('rejects ratings outside 1 to 5 and unknown languages', () => {
    expect(feedbackBodySchema.safeParse({ mode: 'generate', visitorId, rating: 0, language: 'en' }).success).toBe(false);
    expect(feedbackBodySchema.safeParse({ mode: 'generate', visitorId, rating: 6, language: 'en' }).success).toBe(false);
    expect(feedbackBodySchema.safeParse({ mode: 'generate', visitorId, rating: 3, language: 'fr' }).success).toBe(false);
    expect(feedbackBodySchema.safeParse({ mode: 'generate', visitorId, rating: 3, language: 'mr', feedback: '' }).success).toBe(true);
  });

  it('accepts every rating the same way (no rating is filtered out)', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(approveBodySchema.safeParse({ visitorId, rating, language: 'en', finalText: 'My honest experience was fine.', confirmed: true }).success).toBe(true);
    }
  });

  it('requires the customer to confirm the wording', () => {
    expect(approveBodySchema.safeParse({ visitorId, rating: 5, language: 'en', finalText: 'My honest experience was fine.', confirmed: false }).success).toBe(false);
    expect(approveBodySchema.safeParse({ visitorId, rating: 5, language: 'en', finalText: 'My honest experience was fine.' }).success).toBe(false);
  });

  it('only allows customer events, not admin metrics', () => {
    expect(eventBodySchema.safeParse({ visitorId, eventType: 'page_view' }).success).toBe(true);
    expect(eventBodySchema.safeParse({ visitorId, eventType: 'ai_generated' }).success).toBe(false);
    expect(eventBodySchema.safeParse({ visitorId, eventType: 'draft_approved' }).success).toBe(false);
  });

  it('records social clicks only for known platforms', () => {
    expect(eventBodySchema.safeParse({ visitorId, eventType: 'social_opened', platform: 'instagram' }).success).toBe(true);
    expect(eventBodySchema.safeParse({ visitorId, eventType: 'social_opened', platform: 'myspace' }).success).toBe(false);
  });

  it('validates social links on the business and reports the platform', () => {
    expect(businessBodySchema.parse({ name: 'Get Fit Gym' }).socialLinks).toEqual([]);
    expect(businessBodySchema.safeParse({ name: 'Get Fit Gym', socialLinks: [{ platform: 'snapchat', url: '@getfit' }] }).success).toBe(true);
    expect(businessBodySchema.safeParse({ name: 'Get Fit Gym', socialLinks: [{ platform: 'myspace', url: 'x' }] }).success).toBe(false);
  });

  it('rejects malformed visitor ids', () => {
    expect(eventBodySchema.safeParse({ visitorId: 'x', eventType: 'page_view' }).success).toBe(false);
    expect(eventBodySchema.safeParse({ visitorId: '<script>alert(1)</script>', eventType: 'page_view' }).success).toBe(false);
  });
});

describe('tokens and QR codes', () => {
  it('generates unguessable, URL-safe, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newPublicToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(PUBLIC_TOKEN_RE.test(t)).toBe(true);
  });

  it('builds the public URL', () => {
    expect(reviewUrl('https://app.example.com/', 'abc')).toBe('https://app.example.com/review/abc');
  });

  it('renders SVG with custom colors and an optional centred logo', async () => {
    const plain = await qrSvg('https://app.example.com/review/abc', { fg: '#112233', bg: '#ffeedd' });
    expect(plain.startsWith('<?xml') || plain.includes('<svg')).toBe(true);
    expect(plain).toContain('#112233');
    const withLogo = await qrSvg('https://app.example.com/review/abc', { logoUrl: 'data:image/png;base64,AAAA' });
    expect(withLogo).toContain('<image');
    const rejected = await qrSvg('https://app.example.com/review/abc', { logoUrl: 'javascript:alert(1)' });
    expect(rejected).not.toContain('<image');
  });

  it('renders a PNG and falls back to safe colors', async () => {
    const png = await qrPng('https://app.example.com/review/abc', { fg: 'red; drop table', bg: null });
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(safeColor('not-a-color', '#000000')).toBe('#000000');
  });
});

describe('tenant isolation map', () => {
  it('registers every review model as tenant-scoped (deny-by-default guard)', () => {
    const models = ['ReviewBusiness', 'ReviewCampaign', 'ReviewQRCode', 'ReviewCustomerApproval', 'ReviewAutomationJob', 'ReviewAutomationLog', 'ReviewEngagementEvent', 'ReviewAIRequest'];
    for (const m of models) expect(TENANT_SCOPES[m]).toEqual({ kind: 'direct' });
  });
});