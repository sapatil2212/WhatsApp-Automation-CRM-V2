/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker process */
'use strict';
/**
 * Claims and runs review automation jobs.
 *
 * This is a trusted system process (like server.js), so it uses a plain
 * PrismaClient. Every query is keyed by the job's own tenantId and the worker
 * never accepts input from the network.
 */
const { PrismaClient } = require('@prisma/client');
const config = require('./config');
const { validateGoogleReviewUrl } = require('./google-url');
const { openSession } = require('./session-manager');
const { openReviewPage } = require('./review-navigator');
const { prepare } = require('./review-preparation');
const { saveScreenshot } = require('./screenshot-manager');
const { isRecoverable, nextDelayMs } = require('./job-retry');
const health = require('./worker-health');

const prisma = new PrismaClient();
const ACTIVE = ['queued', 'initializing', 'browser_launched', 'navigating', 'preparing_review'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function log(job, level, message, meta) {
  try {
    await prisma.reviewAutomationLog.create({ data: { tenantId: job.tenantId, jobId: job.id, level, message: String(message).slice(0, 480), meta: meta || undefined } });
  } catch (error) {
    console.error('[review-worker] log failed:', error.message);
  }
}

async function setStatus(job, status, extra) {
  await prisma.reviewAutomationJob.update({ where: { id: job.id }, data: { status, ...(extra || {}) } });
}

/** Crash recovery: jobs whose worker died hold a stale lock. Put them back in the queue (or fail them when out of attempts). */
async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - config.lockTtlMs);
  const stale = await prisma.reviewAutomationJob.findMany({ where: { status: { in: ACTIVE }, lockedAt: { lt: cutoff } }, take: 20 });
  for (const job of stale) {
    const exhausted = job.attempts >= job.maxAttempts;
    await prisma.reviewAutomationJob.updateMany({
      where: { id: job.id, status: { in: ACTIVE }, lockedAt: { lt: cutoff } },
      data: exhausted
        ? { status: 'failed', lastError: 'The worker stopped while running this job.', finishedAt: new Date(), lockedAt: null, lockedBy: null }
        : { status: 'pending', lockedAt: null, lockedBy: null, nextRunAt: new Date() },
    });
    await log(job, 'warn', exhausted ? 'Worker crashed repeatedly; job failed.' : 'Recovered a job left by a stopped worker. Re-queued.');
  }
}

async function claimNext() {
  const candidates = await prisma.reviewAutomationJob.findMany({
    where: { status: 'pending', nextRunAt: { lte: new Date() }, cancelRequested: false },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  for (const c of candidates) {
    const won = await prisma.reviewAutomationJob.updateMany({
      where: { id: c.id, status: 'pending' },
      data: { status: 'queued', lockedAt: new Date(), lockedBy: config.workerId, attempts: { increment: 1 }, startedAt: c.startedAt ?? new Date() },
    });
    if (won.count === 1) return prisma.reviewAutomationJob.findUnique({ where: { id: c.id }, include: { business: true, approval: true } });
  }
  return null;
}

async function isCancelled(job) {
  const fresh = await prisma.reviewAutomationJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true, status: true } });
  return !fresh || fresh.cancelRequested || fresh.status === 'cancelled';
}

async function finishCancelled(job, startedAt) {
  await setStatus(job, 'cancelled', { finishedAt: new Date(), durationMs: Date.now() - startedAt, lockedAt: null, lockedBy: null });
  await log(job, 'warn', 'Job cancelled.');
}

async function run(job) {
  const startedAt = Date.now();
  let session = null;
  try {
    await setStatus(job, 'initializing');
    await log(job, 'info', `Attempt ${job.attempts} of ${job.maxAttempts} started.`);

    const check = validateGoogleReviewUrl(job.business && job.business.googleReviewUrl);
    if (!check.valid) throw Object.assign(new Error(check.reason || 'The Google review link is not valid.'), { permanent: true });
    if (await isCancelled(job)) return finishCancelled(job, startedAt);

    session = await openSession(config.jobTimeoutMs);
    await setStatus(job, 'browser_launched');
    await log(job, 'info', 'Isolated Chromium session started.');
    if (await isCancelled(job)) return finishCancelled(job, startedAt);

    await setStatus(job, 'navigating');
    const observation = await openReviewPage(session.page, check.normalized, (level, msg) => log(job, level, msg));
    if (session.isClosed()) throw Object.assign(new Error('The job timed out and the browser was closed.'), { recoverable: true });

    await setStatus(job, 'preparing_review');
    let screenshotPath = null;
    try {
      screenshotPath = await saveScreenshot(session.page, job.tenantId, job.id);
    } catch (error) {
      await log(job, 'warn', `Screenshot failed: ${error.message}`);
    }
    const outcome = prepare(observation, job.approval);
    await log(job, outcome.needsCustomerAction ? 'warn' : 'info', outcome.message);
    if (await isCancelled(job)) return finishCancelled(job, startedAt);

    await setStatus(job, outcome.status, {
      result: outcome.result,
      screenshotPath,
      lastError: null,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      lockedAt: null,
      lockedBy: null,
    });
    health.state.processed += 1;
  } catch (error) {
    const message = String(error && error.message ? error.message : error).slice(0, 480);
    health.state.failures += 1;
    if (isRecoverable(error) && job.attempts < job.maxAttempts) {
      const delay = nextDelayMs(job.attempts);
      await setStatus(job, 'pending', { lastError: message, nextRunAt: new Date(Date.now() + delay), lockedAt: null, lockedBy: null });
      await log(job, 'warn', `Recoverable problem: ${message}. Retrying in ${Math.round(delay / 1000)}s.`);
    } else {
      await setStatus(job, 'failed', { lastError: message, finishedAt: new Date(), durationMs: Date.now() - startedAt, lockedAt: null, lockedBy: null });
      await log(job, 'error', `Failed: ${message}`);
    }
  } finally {
    if (session) await session.close();
  }
}

module.exports = { prisma, claimNext, recoverStaleJobs, run, sleep };