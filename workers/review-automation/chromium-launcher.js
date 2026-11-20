/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker process */
'use strict';
/**
 * Launches Chromium through Playwright. Plain, honest launch: a normal
 * headless Chromium with its real user agent. No stealth plugins, no
 * fingerprint spoofing, nothing that disguises the automation.
 */
const config = require('./config');

function loadPlaywright() {
  try {
    return require('playwright-core');
  } catch {
    throw Object.assign(new Error('playwright-core is not installed. Run: npm install && npx playwright-core install chromium'), { permanent: true });
  }
}

async function launchChromium() {
  const { chromium } = loadPlaywright();
  const args = ['--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'];
  if (config.noSandbox) args.push('--no-sandbox');
  try {
    return await chromium.launch({ headless: true, args, executablePath: config.executablePath, timeout: 30_000 });
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/Executable doesn't exist|browserType\.launch/i.test(message) && /install/i.test(message)) {
      throw Object.assign(new Error('Chromium is not installed. Run: npx playwright-core install chromium'), { permanent: true });
    }
    throw error;
  }
}

module.exports = { launchChromium };