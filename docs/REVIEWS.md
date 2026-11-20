# Google Review module

Isolated module for collecting honest Google reviews: businesses, campaigns,
QR codes, a public review page with AI writing help, a Playwright worker that
pre-checks the Google review page, automation job tracking and analytics.

## What it does and does not do

- Every rating (1 to 5) gets the same page and the same Google link. Nothing is
  hidden or redirected based on the rating.
- The AI rewrites only what the customer said (English, Hindi, Marathi,
  Hinglish). It never invents experiences; low ratings stay critical, and
  praise is stripped from 1 to 2 star drafts.
- The customer reads, edits and confirms the wording, then publishes it on
  Google from their own phone.
- The worker opens the Google review link in an isolated headless Chromium,
  records logs and a screenshot, and stops. It never signs in, never solves a
  CAPTCHA, uses no stealth plugins or fingerprint spoofing, never types the
  review and never presses Publish. Jobs end at
  `awaiting_customer_confirmation`; `completed` only means the customer said
  they finished (self-reported, not verified).
- Google page opens are counted as opens, never as published reviews.

## Database

Additive migration `prisma/migrations/20261122000000_google_review_module`
creates 8 new tables (`ReviewBusiness`, `ReviewCampaign`, `ReviewQRCode`,
`ReviewCustomerApproval`, `ReviewAutomationJob`, `ReviewAutomationLog`,
`ReviewEngagementEvent`, `ReviewAIRequest`). It changes no existing table
except adding the relation on `Tenant` in the Prisma schema (no SQL column).

This database has no `_prisma_migrations` history (see `docs/MIGRATIONS.md`),
so do **not** run `prisma migrate deploy` blindly. Apply only this file:

```bash
mysqldump -u USER -p DBNAME > backup-$(date +%F).sql          # back up first
npx prisma db execute --file prisma/migrations/20261122000000_google_review_module/migration.sql --schema prisma/schema.prisma
npx prisma generate
```

If you do use migration history, record it afterwards with
`npx prisma migrate resolve --applied 20261122000000_google_review_module`.

## Running the worker

```bash
npm install                                   # adds playwright-core
npx playwright-core install --with-deps chromium   # Linux VPS: browser + OS libraries
npm run worker:reviews                        # foreground
pm2 start ecosystem.reviews.config.cjs && pm2 save   # production, separate process
```

The worker is independent of the web app: it reads jobs from the database,
so the app keeps working (customers can still continue to Google) when the
worker is stopped. It recovers jobs left behind by a crashed worker, retries
only recoverable failures (network, timeouts, browser crash) with back-off,
and shuts down gracefully on SIGTERM/SIGINT.

The web app and the worker must share the same filesystem for screenshots and
the heartbeat file (true for a single VPS).

## Environment variables (all optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `REVIEW_WORKER_CONCURRENCY` | `1` (max 4) | Jobs processed at once |
| `REVIEW_WORKER_POLL_MS` | `3000` | Queue poll interval |
| `REVIEW_JOB_TIMEOUT_MS` | `90000` | Hard limit per job (browser closed after) |
| `REVIEW_NAV_TIMEOUT_MS` | `30000` | Page load timeout |
| `REVIEW_LOCK_TTL_MS` | `300000` | When a running job is considered abandoned |
| `REVIEW_SCREENSHOT_DIR` | `.runtime/review-screenshots` | Debug screenshots |
| `REVIEW_WORKER_HEARTBEAT_FILE` | `.runtime/review-worker-heartbeat.json` | Health file read by the dashboard |
| `REVIEW_CHROMIUM_PATH` | Playwright's Chromium | Use a system Chromium instead |
| `REVIEW_CHROMIUM_NO_SANDBOX` | off | Set `1` only when running as root in a container |
| `REVIEW_AI_DAILY_CAP` | `300` | AI requests per business per 24 h (public page) |

Existing `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY` power the
AI through the shared `callLLM`. `NEXT_PUBLIC_SITE_URL` sets the domain used in
QR codes.

## API

Tenant (session required, tenant from the session only):
`/api/reviews/businesses` (GET, POST), `/api/reviews/businesses/[id]` (GET, PATCH,
DELETE), `/api/reviews/businesses/[id]/link`, `/api/reviews/businesses/validate-url`,
`/api/reviews/campaigns`, `/api/reviews/campaigns/[id]`, `/api/reviews/qr`,
`/api/reviews/qr/generate`, `/api/reviews/qr/[id]` (DELETE),
`/api/reviews/qr/[id]/image?format=png|svg`, `/api/reviews/ai/generate`,
`/api/reviews/ai/translate`, `/api/reviews/automation/prepare`,
`/api/reviews/automation/health`, `/api/reviews/automation/jobs`,
`/api/reviews/automation/jobs/[id]` (+ `/retry`, `/cancel`, `/screenshot`),
`/api/reviews/analytics/overview|campaigns|businesses`.

Public (token is the credential, IP rate limited, same-origin check on POST):
`/api/public/reviews/[token]` (GET), `/feedback`, `/approve`, `/events` (POST),
`/status` (GET). Customer page: `/review/[token]`.