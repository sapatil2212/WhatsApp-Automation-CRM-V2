/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker process */
'use strict';
/**
 * Opens the official Google review page and reports what Google showed.
 * It never signs in, never solves or bypasses a challenge, and never types
 * or clicks anything that would publish a review.
 */
const config = require('./config');
const { isGoogleHost } = require('./google-url');

const BLOCK_TEXT = /unusual traffic|not a robot|verify (that )?it'?s you|automated queries|captcha/i;

/**
 * @returns {Promise<{state: 'ready'|'sign_in_required'|'consent_required'|'blocked'|'unreachable', finalHost: string, title: string}>}
 */
async function openReviewPage(page, url, log) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navTimeoutMs });
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    throw Object.assign(new Error(`Could not load the Google page: ${message.split('\n')[0]}`), { recoverable: true });
  }
  await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);

  const finalUrl = new URL(page.url());
  const title = (await page.title().catch(() => '')) || '';
  await log('info', `Loaded ${finalUrl.hostname}${finalUrl.pathname.slice(0, 40)} (HTTP ${response ? response.status() : '?'})`);

  if (!isGoogleHost(finalUrl.hostname)) {
    // Redirected somewhere that is not Google. Stop; never interact with it.
    return { state: 'blocked', finalHost: finalUrl.hostname, title: '' };
  }
  if (response && response.status() === 429) return { state: 'blocked', finalHost: finalUrl.hostname, title };
  if (finalUrl.pathname.startsWith('/sorry')) return { state: 'blocked', finalHost: finalUrl.hostname, title };
  if (finalUrl.hostname === 'consent.google.com') return { state: 'consent_required', finalHost: finalUrl.hostname, title };
  if (finalUrl.hostname === 'accounts.google.com') return { state: 'sign_in_required', finalHost: finalUrl.hostname, title };

  const bodyText = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 4000) : '')).catch(() => '');
  if (BLOCK_TEXT.test(bodyText)) return { state: 'blocked', finalHost: finalUrl.hostname, title };
  if (response && response.status() >= 500) throw Object.assign(new Error(`Google returned HTTP ${response.status()}`), { recoverable: true });
  if (response && response.status() >= 400) throw Object.assign(new Error(`Google returned HTTP ${response.status()}. The review link may be wrong.`), { recoverable: false });
  return { state: 'ready', finalHost: finalUrl.hostname, title };
}

module.exports = { openReviewPage };