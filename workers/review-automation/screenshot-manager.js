/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker process */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

/** Saves a viewport screenshot at <root>/<tenantId>/<jobId>.png and returns the relative path. */
async function saveScreenshot(page, tenantId, jobId) {
  const rel = path.join(String(tenantId), `${jobId}.png`);
  const full = path.join(config.screenshotDir, rel);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await page.screenshot({ path: full, type: 'png', fullPage: false, timeout: 10_000 });
  return rel;
}

module.exports = { saveScreenshot };