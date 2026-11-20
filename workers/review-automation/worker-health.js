/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker process */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const state = { active: 0, processed: 0, failures: 0 };

async function writeHeartbeat() {
  const beat = { at: new Date().toISOString(), pid: process.pid, version: config.version, concurrency: config.concurrency, ...state };
  try {
    await fs.promises.mkdir(path.dirname(config.heartbeatFile), { recursive: true });
    await fs.promises.writeFile(config.heartbeatFile, JSON.stringify(beat), 'utf8');
  } catch (error) {
    console.error('[review-worker] heartbeat failed:', error.message);
  }
}

function startHeartbeat() {
  void writeHeartbeat();
  const timer = setInterval(() => void writeHeartbeat(), config.heartbeatMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { state, startHeartbeat, writeHeartbeat };