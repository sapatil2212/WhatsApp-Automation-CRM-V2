'use strict';
/** Retry policy: only recoverable failures are retried, with growing delays. */
const DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];

function isRecoverable(error) {
  if (!error) return false;
  if (error.permanent === true || error.recoverable === false) return false;
  if (error.recoverable === true) return true;
  const m = String(error.message || error);
  return /timeout|net::|ERR_|ECONN|ETIMEDOUT|EAI_AGAIN|Target (page|closed)|browser has been closed|has been closed|crash|disconnected/i.test(m);
}

function nextDelayMs(attempt) {
  return DELAYS_MS[Math.min(Math.max(attempt - 1, 0), DELAYS_MS.length - 1)];
}

module.exports = { isRecoverable, nextDelayMs };