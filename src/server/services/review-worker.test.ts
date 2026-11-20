import { createRequire } from 'node:module';
import fs from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const W = '../../../workers/review-automation';
const { isRecoverable, nextDelayMs } = require(`${W}/job-retry.js`);
const { prepare } = require(`${W}/review-preparation.js`);
const { openReviewPage } = require(`${W}/review-navigator.js`);

describe('worker retry policy', () => {
  it('retries network and browser problems but not bad links', () => {
    expect(isRecoverable(new Error('page.goto: Timeout 30000ms exceeded'))).toBe(true);
    expect(isRecoverable(new Error('net::ERR_CONNECTION_RESET'))).toBe(true);
    expect(isRecoverable(new Error('Target page, context or browser has been closed'))).toBe(true);
    expect(isRecoverable(Object.assign(new Error('Chromium is not installed'), { permanent: true }))).toBe(false);
    expect(isRecoverable(Object.assign(new Error('Google returned HTTP 404'), { recoverable: false }))).toBe(false);
    expect(isRecoverable(new Error('The Google review link is not valid.'))).toBe(false);
  });

  it('backs off with growing delays', () => {
    expect(nextDelayMs(1)).toBeLessThan(nextDelayMs(2));
    expect(nextDelayMs(2)).toBeLessThan(nextDelayMs(3));
    expect(nextDelayMs(9)).toBe(nextDelayMs(3));
  });
});

describe('review preparation (never publishes)', () => {
  const approval = { finalText: 'The staff were helpful and the wait was short.' };
  it('always ends at customer confirmation and never reports published', () => {
    for (const state of ['ready', 'sign_in_required', 'consent_required', 'blocked']) {
      const out = prepare({ state, finalHost: 'search.google.com', title: 'x' }, approval);
      expect(out.status).toBe('awaiting_customer_confirmation');
      expect(out.result.published).toBe(false);
    }
  });

  it('asks the customer to act when Google shows a challenge', () => {
    expect(prepare({ state: 'blocked', finalHost: 'google.com', title: '' }, approval).needsCustomerAction).toBe(true);
    expect(prepare({ state: 'ready', finalHost: 'google.com', title: '' }, approval).needsCustomerAction).toBe(false);
  });

  it('does not copy the customer review text into the stored result', () => {
    const out = prepare({ state: 'ready', finalHost: 'google.com', title: '' }, approval);
    expect(JSON.stringify(out.result)).not.toContain('helpful');
    expect(out.result.textChars).toBe(approval.finalText.length);
  });
});

// Real Chromium, but every Google request is answered locally: no traffic leaves this machine.
/* eslint-disable @typescript-eslint/no-explicit-any */
let browser: any = null;

beforeAll(async () => {
  try {
    browser = await require('playwright-core').chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  } catch {
    browser = null;
  }
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function withPage(routes: (route: any) => Promise<void>, fn: (page: any) => Promise<any>): Promise<any> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/*', routes);
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}
const html = (route: any, body: string, status = 200) => route.fulfill({ status, contentType: 'text/html', body: `<html><head><title>Mock</title></head><body>${body}</body></html>` });
const noop = async () => undefined;
const URL_OK = 'https://search.google.com/local/writereview?placeid=ChIJabc';

describe('review navigator (real Chromium, mocked Google)', () => {
  const run = (name: string, fn: () => Promise<void>) => it(name, async (ctx) => (browser ? fn() : ctx.skip()), 60_000);

  run('reports a normal review page as ready and types nothing', async () => {
    const state = await withPage((r) => html(r, '<h1>Write a review</h1><textarea id="t"></textarea>'), async (page) => {
      const obs = await openReviewPage(page, URL_OK, noop);
      expect(await page.inputValue('#t')).toBe('');
      return obs;
    });
    expect(state.state).toBe('ready');
  });

  // The navigator classifies wherever Google's redirects land. Here we open those landing pages directly.
  run('stops at a sign-in page without trying to log in', async () => {
    const obs = await withPage((r) => html(r, '<h1>Sign in</h1><input type="email" id="e">'), async (page) => {
      const o = await openReviewPage(page, 'https://accounts.google.com/signin', noop);
      expect(await page.inputValue('#e')).toBe('');
      return o;
    });
    expect(obs.state).toBe('sign_in_required');
  });

  run('stops at the consent screen', async () => {
    const obs = await withPage((r) => html(r, 'Before you continue to Google'), (page) => openReviewPage(page, 'https://consent.google.com/m?continue=x', noop));
    expect(obs.state).toBe('consent_required');
  });

  run('treats a CAPTCHA / unusual-traffic page as blocked and does not interact', async () => {
    const obs = await withPage((r) => html(r, 'Our systems have detected unusual traffic from your computer network.'), (page) => openReviewPage(page, URL_OK, noop));
    expect(obs.state).toBe('blocked');
    const sorry = await withPage((r) => html(r, 'sorry'), (page) => openReviewPage(page, 'https://www.google.com/sorry/index', noop));
    expect(sorry.state).toBe('blocked');
    const limited = await withPage((r) => html(r, 'slow down', 429), (page) => openReviewPage(page, URL_OK, noop));
    expect(limited.state).toBe('blocked');
  });

  run('refuses to treat a page outside Google as ready', async () => {
    const obs = await withPage((r) => html(r, 'phish'), (page) => openReviewPage(page, 'https://evil.example.com/', noop));
    expect(obs.state).toBe('blocked');
    expect(obs.finalHost).toBe('evil.example.com');
  });
  run('marks network failures recoverable and a 404 non-recoverable', async () => {
    const net = await withPage((r) => r.abort('connectionreset'), (page) => openReviewPage(page, URL_OK, noop).catch((e: Error & { recoverable?: boolean }) => e));
    expect((net as Error & { recoverable?: boolean }).recoverable).toBe(true);
    const notFound = await withPage((r) => html(r, 'Not found', 404), (page) => openReviewPage(page, URL_OK, noop).catch((e: Error & { recoverable?: boolean }) => e));
    expect((notFound as Error & { recoverable?: boolean }).recoverable).toBe(false);
  });

  run('uses a separate context per job: cookies never leak between sessions', async () => {
    const a = await browser.newContext();
    const b = await browser.newContext();
    await a.addCookies([{ name: 'sid', value: 'tenant-a', url: 'https://search.google.com' }]);
    expect(await b.cookies('https://search.google.com')).toEqual([]);
    await a.close();
    await b.close();
  });

  run('writes a screenshot that can be read back', async () => {
    const { saveScreenshot } = require(`${W}/screenshot-manager.js`);
    const rel: string = await withPage((r) => html(r, '<h1>hi</h1>'), async (page) => {
      await page.goto('https://search.google.com/x');
      return saveScreenshot(page, 'test-tenant', 'test-job');
    });
    const full = require('node:path').join(require(`${W}/config.js`).screenshotDir, rel);
    expect(fs.statSync(full).size).toBeGreaterThan(100);
    fs.rmSync(require('node:path').join(require(`${W}/config.js`).screenshotDir, 'test-tenant'), { recursive: true, force: true });
  });
});