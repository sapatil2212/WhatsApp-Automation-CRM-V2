/**
 * PM2 definition for the Google Review automation worker ONLY.
 * It does not touch the existing app process.
 *
 *   pm2 start ecosystem.reviews.config.cjs
 *   pm2 save
 *
 * One-time setup on the server (installs Chromium and its OS libraries):
 *   npx playwright-core install --with-deps chromium
 */
module.exports = {
  apps: [
    {
      name: 'chatnexgen-review-worker',
      script: 'workers/review-automation/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      restart_delay: 5000,
      // Restart before a leaking browser can starve the VPS.
      max_memory_restart: '900M',
      kill_timeout: 35000, // lets in-flight jobs finish on graceful shutdown (worker waits up to 30s)
      env: {
        NODE_ENV: 'production',
        REVIEW_WORKER_CONCURRENCY: '1',
        REVIEW_JOB_TIMEOUT_MS: '90000',
        // Uncomment only when Chromium runs as root inside a container:
        // REVIEW_CHROMIUM_NO_SANDBOX: '1',
      },
      out_file: './logs/review-worker.out.log',
      error_file: './logs/review-worker.err.log',
      time: true,
    },
  ],
};