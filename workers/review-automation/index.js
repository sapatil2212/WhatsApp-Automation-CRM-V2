/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker process */
'use strict';
/**
 * Review automation worker: independent process (run with PM2 or
 * `npm run worker:reviews`). It polls ReviewAutomationJob rows, prepares
 * the official Google review page in an isolated Chromium and stops there.
 * It never signs in to Google, never bypasses a challenge and never submits
 * a review.
 */
// Load .env / .env.local the same way Next.js does (the worker runs outside Next).
try {
  require('@next/env').loadEnvConfig(process.cwd());
} catch {
  /* PM2/hosting may inject the environment instead */
}

const config = require('./config');
const health = require('./worker-health');
const { shutdown: closeBrowser } = require('./browser-manager');
const { prisma, claimNext, recoverStaleJobs, run, sleep } = require('./job-processor');

let stopping = false;
const running = new Set();

async function loop() {
  let lastRecovery = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastRecovery > 60_000) {
        lastRecovery = Date.now();
        await recoverStaleJobs();
      }
      while (!stopping && running.size < config.concurrency) {
        const job = await claimNext();
        if (!job) break;
        health.state.active = running.size + 1;
        const task = run(job)
          .catch((e) => console.error('[review-worker] job crashed:', e))
          .finally(() => {
            running.delete(task);
            health.state.active = running.size;
          });
        running.add(task);
      }
    } catch (error) {
      console.error('[review-worker] loop error:', error.message);
    }
    await sleep(config.pollMs);
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[review-worker] ${signal}: finishing ${running.size} active job(s)...`);
  const deadline = Date.now() + 30_000;
  while (running.size && Date.now() < deadline) await sleep(500);
  await closeBrowser();
  await prisma.$disconnect().catch(() => undefined);
  console.log('[review-worker] stopped.');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('[review-worker] unhandledRejection:', e));

health.startHeartbeat();
console.log(`[review-worker] started ${config.workerId} concurrency=${config.concurrency}`);
void loop();