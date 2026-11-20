/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker process */
'use strict';
/**
 * Per-job browser session. Everything lives in memory inside an isolated
 * context; closing it discards cookies and storage. Nothing is written to
 * disk except the debug screenshot, and no credentials are ever stored.
 */
const { newIsolatedContext } = require('./browser-manager');

async function openSession(jobTimeoutMs) {
  const context = await newIsolatedContext();
  const page = await context.newPage();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  };
  // Hard watchdog: a stuck page can never hold the worker forever.
  const watchdog = setTimeout(() => void close(), jobTimeoutMs);
  return {
    page,
    close: async () => {
      clearTimeout(watchdog);
      await close();
    },
    isClosed: () => closed,
  };
}

module.exports = { openSession };