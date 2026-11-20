/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker process */
'use strict';
/**
 * Owns the Chromium process. One shared browser, one fresh isolated context
 * per job (no cookies, storage or sessions are ever shared between jobs or
 * tenants). The browser is recycled after a fixed number of jobs and
 * relaunched automatically if it crashes.
 */
const config = require('./config');
const { launchChromium } = require('./chromium-launcher');

let browser = null;
let launching = null;
let jobsOnBrowser = 0;

async function ensureBrowser() {
  if (browser && browser.isConnected() && jobsOnBrowser < config.maxJobsPerBrowser) return browser;
  if (launching) return launching;
  launching = (async () => {
    if (browser) {
      await browser.close().catch(() => undefined);
      browser = null;
    }
    const b = await launchChromium();
    b.on('disconnected', () => {
      if (browser === b) browser = null;
    });
    browser = b;
    jobsOnBrowser = 0;
    return b;
  })();
  try {
    return await launching;
  } finally {
    launching = null;
  }
}

/** Returns a new isolated context. The caller must close it. */
async function newIsolatedContext() {
  const b = await ensureBrowser();
  jobsOnBrowser += 1;
  return b.newContext({
    viewport: { width: 412, height: 860 },
    locale: 'en-IN',
    acceptDownloads: false,
    serviceWorkers: 'block',
    permissions: [],
  });
}

async function shutdown() {
  if (browser) await browser.close().catch(() => undefined);
  browser = null;
}

module.exports = { newIsolatedContext, shutdown };