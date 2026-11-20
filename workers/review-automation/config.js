/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker process */
'use strict';
const path = require('node:path');

const int = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

module.exports = {
  workerId: `${require('node:os').hostname()}:${process.pid}`,
  concurrency: Math.min(int(process.env.REVIEW_WORKER_CONCURRENCY, 1), 4),
  pollMs: int(process.env.REVIEW_WORKER_POLL_MS, 3000),
  jobTimeoutMs: int(process.env.REVIEW_JOB_TIMEOUT_MS, 90_000),
  navTimeoutMs: int(process.env.REVIEW_NAV_TIMEOUT_MS, 30_000),
  lockTtlMs: int(process.env.REVIEW_LOCK_TTL_MS, 5 * 60_000),
  heartbeatMs: 15_000,
  maxJobsPerBrowser: 25,
  screenshotDir: path.resolve(process.env.REVIEW_SCREENSHOT_DIR || path.join(process.cwd(), '.runtime', 'review-screenshots')),
  heartbeatFile: path.resolve(process.env.REVIEW_WORKER_HEARTBEAT_FILE || path.join(process.cwd(), '.runtime', 'review-worker-heartbeat.json')),
  // Needed only when Chromium runs as root inside a container. Off by default.
  noSandbox: process.env.REVIEW_CHROMIUM_NO_SANDBOX === '1',
  executablePath: process.env.REVIEW_CHROMIUM_PATH || undefined,
  version: '1.0.0',
};