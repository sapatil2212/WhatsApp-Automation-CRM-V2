/**
 * Google Review module: tenant-side services (dashboard).
 *
 * Everything here runs on the tenant-scoped client (`db`), so a tenant can
 * only ever see or change its own businesses, campaigns, QR codes, jobs and
 * analytics. tenantId is never accepted from the client.
 */

import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { LANGUAGE_CODES, QR_PLACEMENTS } from '@/lib/reviews/constants';
import { validateGoogleReviewUrl } from '@/lib/reviews/google-url';
import { normalizeSocialLink, PLATFORM, sanitizeSocialLinks, SOCIAL_PLATFORMS, type SocialLink } from '@/lib/reviews/social-platforms';
import { qrPng, qrSvg, reviewUrl } from '@/lib/reviews/qr';
import { newPublicToken } from '@/lib/reviews/token';

import { ConflictError, NotFoundError, scoped, ValidationError, type TenantDb } from '../kernel';

const MAX_LOGO_CHARS = 450_000; // ~330 KB image as a data URL

// ── businesses ───────────────────────────────────────────────────────

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

const logoSchema = z
  .string()
  .max(MAX_LOGO_CHARS, 'Logo is too large (max about 300 KB).')
  .refine((v) => /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(v), 'Logo must be an https image link or an uploaded PNG/JPEG/WebP.')
  .nullish()
  .transform((v) => (v ? v : null));

export const businessBodySchema = z.object({
  name: z.string().trim().min(2, 'Business name is required.').max(160),
  category: optionalText(120),
  description: optionalText(2000),
  address: optionalText(300),
  googleReviewUrl: optionalText(2000),
  website: optionalText(300),
  phone: optionalText(40),
  logoUrl: logoSchema,
  services: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  defaultLanguage: z.enum(LANGUAGE_CODES).default('en'),
  status: z.enum(['active', 'inactive']).default('active'),
  /** Shown on the universal QR page next to the Google review button. */
  socialLinks: z.array(z.object({ platform: z.enum(SOCIAL_PLATFORMS), url: z.string().trim().max(500) })).max(SOCIAL_PLATFORMS.length).default([]),
});
export type BusinessBody = z.infer<typeof businessBodySchema>;

function checkGoogleUrl(url: string | null): string | null {
  if (!url) return null;
  const check = validateGoogleReviewUrl(url);
  if (!check.valid) throw new ValidationError(check.reason ?? 'Invalid Google review link.', { details: { field: 'googleReviewUrl' } });
  return check.normalized ?? url;
}

/** Validates and canonicalises social links; the first problem is reported by platform. */
function checkSocialLinks(list: Array<{ platform: (typeof SOCIAL_PLATFORMS)[number]; url: string }>): SocialLink[] {
  const seen = new Set<string>();
  const out: SocialLink[] = [];
  for (const item of list) {
    if (!item.url) continue;
    if (seen.has(item.platform)) throw new ValidationError(`Add only one ${PLATFORM[item.platform].label} link.`, { details: { field: 'socialLinks' } });
    const n = normalizeSocialLink(item.platform, item.url);
    if ('error' in n) throw new ValidationError(n.error, { details: { field: 'socialLinks', platform: item.platform } });
    seen.add(item.platform);
    out.push({ platform: item.platform, url: n.url });
  }
  return out;
}

function toBusiness<T extends { services: unknown; socialLinks?: unknown }>(b: T): Omit<T, 'services' | 'socialLinks'> & { services: string[]; socialLinks: SocialLink[] } {
  return { ...b, services: Array.isArray(b.services) ? (b.services as string[]) : [], socialLinks: sanitizeSocialLinks(b.socialLinks) };
}

export async function listBusinesses(db: TenantDb, q: { search?: string; status?: string }) {
  const rows = await db.reviewBusiness.findMany({
    where: {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ name: { contains: q.search } }, { category: { contains: q.search } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { _count: { select: { qrCodes: { where: { deletedAt: null } }, campaigns: { where: { deletedAt: null } } } } },
  });
  return rows.map((b) => ({ ...toBusiness(b), qrCount: b._count.qrCodes, campaignCount: b._count.campaigns }));
}

export async function getBusiness(db: TenantDb, id: string) {
  const b = await db.reviewBusiness.findFirst({ where: { id, deletedAt: null } });
  if (!b) throw new NotFoundError('Business');
  return toBusiness(b);
}

export async function createBusiness(db: TenantDb, body: BusinessBody) {
  const googleReviewUrl = checkGoogleUrl(body.googleReviewUrl);
  const created = await db.reviewBusiness.create({
    data: scoped({ ...body, googleReviewUrl, socialLinks: checkSocialLinks(body.socialLinks ?? []), publicToken: newPublicToken() }),
  });
  return toBusiness(created);
}

export async function updateBusiness(db: TenantDb, id: string, body: Partial<BusinessBody>) {
  await getBusiness(db, id);
  const data: Record<string, unknown> = { ...body };
  if ('googleReviewUrl' in body) data.googleReviewUrl = checkGoogleUrl(body.googleReviewUrl ?? null);
  if ('socialLinks' in body) data.socialLinks = checkSocialLinks(body.socialLinks ?? []);
  const updated = await db.reviewBusiness.update({ where: { id }, data });
  return toBusiness(updated);
}

/** Soft delete: the business, its QR codes and campaigns stop working; history stays for analytics. */
export async function deleteBusiness(db: TenantDb, id: string) {
  await getBusiness(db, id);
  const now = new Date();
  await db.reviewBusiness.update({ where: { id }, data: { deletedAt: now, status: 'inactive' } });
  await db.reviewQRCode.updateMany({ where: { businessId: id, deletedAt: null }, data: { deletedAt: now, status: 'inactive' } });
  await db.reviewCampaign.updateMany({ where: { businessId: id, deletedAt: null }, data: { deletedAt: now, status: 'paused' } });
  await db.reviewAutomationJob.updateMany({ where: { businessId: id, status: { in: ['pending', 'queued'] } }, data: { status: 'cancelled', finishedAt: now, lastError: 'Business was deleted.' } });
  return { deleted: true as const };
}

/**
 * Business details from Business Setup (clinic or business profile), so the
 * owner can fill the review business in one click. Read-only; nothing is saved.
 */
export async function setupPrefill(db: TenantDb) {
  const [clinic, biz] = await Promise.all([
    db.clinic.findFirst({ select: { clinicName: true, clinicType: true, clinicDescription: true, phone: true, website: true, address: true, city: true, instagramUrl: true, facebookUrl: true, whatsappNumber: true, services: { select: { serviceName: true }, take: 30 } } }),
    db.businessProfile.findFirst({ select: { businessName: true, businessType: true, description: true, phone: true, website: true, address: true, city: true, instagramUrl: true, facebookUrl: true, whatsappNumber: true, services: { where: { isActive: true }, select: { name: true }, take: 30 } } }),
  ]);
  const src = clinic
    ? { name: clinic.clinicName, category: clinic.clinicType, description: clinic.clinicDescription, phone: clinic.phone, website: clinic.website, address: [clinic.address, clinic.city].filter(Boolean).join(', '), instagram: clinic.instagramUrl, facebook: clinic.facebookUrl, whatsapp: clinic.whatsappNumber, services: clinic.services.map((x) => x.serviceName) }
    : biz
      ? { name: biz.businessName, category: biz.businessType, description: biz.description, phone: biz.phone, website: biz.website, address: [biz.address, biz.city].filter(Boolean).join(', '), instagram: biz.instagramUrl, facebook: biz.facebookUrl, whatsapp: biz.whatsappNumber, services: biz.services.map((x) => x.name) }
      : null;
  if (!src) throw new NotFoundError('Business setup', { details: { hint: 'Complete Business Setup first.' } });
  const socialLinks = sanitizeSocialLinks([
    src.instagram && { platform: 'instagram', url: src.instagram },
    src.facebook && { platform: 'facebook', url: src.facebook },
    src.whatsapp && { platform: 'whatsapp', url: src.whatsapp },
    src.website && { platform: 'website', url: src.website },
  ].filter(Boolean));
  return {
    name: src.name ?? '',
    category: src.category ?? '',
    description: (src.description ?? '').slice(0, 2000),
    phone: src.phone ?? '',
    website: src.website ?? '',
    address: src.address.slice(0, 300),
    services: [...new Set(src.services.map((x) => x.trim()).filter(Boolean))].slice(0, 30),
    socialLinks,
  };
}

// ── campaigns ────────────────────────────────────────────────────────

export const campaignBodySchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().trim().min(2, 'Campaign name is required.').max(160),
  description: optionalText(500),
  status: z.enum(['active', 'paused']).default('active'),
});

export async function listCampaigns(db: TenantDb, q: { businessId?: string }) {
  const rows = await db.reviewCampaign.findMany({
    where: { deletedAt: null, ...(q.businessId ? { businessId: q.businessId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { business: { select: { id: true, name: true } }, _count: { select: { qrCodes: { where: { deletedAt: null } } } } },
  });
  return rows.map(({ _count, ...c }) => ({ ...c, qrCount: _count.qrCodes }));
}

export async function createCampaign(db: TenantDb, body: z.infer<typeof campaignBodySchema>) {
  await getBusiness(db, body.businessId);
  return db.reviewCampaign.create({ data: scoped(body) });
}

export async function updateCampaign(db: TenantDb, id: string, body: Partial<z.infer<typeof campaignBodySchema>>) {
  const existing = await db.reviewCampaign.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Campaign');
  const { businessId: _ignored, ...rest } = body; // a campaign never moves between businesses
  void _ignored;
  return db.reviewCampaign.update({ where: { id }, data: rest });
}

export async function deleteCampaign(db: TenantDb, id: string) {
  const existing = await db.reviewCampaign.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Campaign');
  const now = new Date();
  await db.reviewCampaign.update({ where: { id }, data: { deletedAt: now, status: 'paused' } });
  await db.reviewQRCode.updateMany({ where: { campaignId: id, deletedAt: null }, data: { deletedAt: now, status: 'inactive' } });
  return { deleted: true as const };
}

// ── QR codes ─────────────────────────────────────────────────────────

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex color like #0f172a.');
export const qrBodySchema = z.object({
  businessId: z.string().uuid(),
  campaignId: z.string().uuid().nullish().transform((v) => v ?? null),
  label: z.string().trim().min(2, 'Give the QR code a name.').max(160),
  placement: z.enum(QR_PLACEMENTS.map((p) => p.value) as [string, ...string[]]).nullish().transform((v) => v ?? null),
  fgColor: colorSchema.default('#0f172a'),
  bgColor: colorSchema.default('#ffffff'),
  includeLogo: z.boolean().default(false),
});

export async function listQrCodes(db: TenantDb, q: { businessId?: string; campaignId?: string }, origin: string) {
  const rows = await db.reviewQRCode.findMany({
    where: { deletedAt: null, ...(q.businessId ? { businessId: q.businessId } : {}), ...(q.campaignId ? { campaignId: q.campaignId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { business: { select: { id: true, name: true, logoUrl: true } }, campaign: { select: { id: true, name: true } } },
  });
  const scans = await db.reviewEngagementEvent.groupBy({ by: ['qrCodeId'], where: { eventType: 'page_view', qrCodeId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  const scanMap = new Map(scans.map((s) => [s.qrCodeId, s._count._all]));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    placement: r.placement,
    token: r.token,
    url: reviewUrl(origin, r.token),
    fgColor: r.fgColor,
    bgColor: r.bgColor,
    includeLogo: r.includeLogo,
    status: r.status,
    createdAt: r.createdAt,
    business: { id: r.business.id, name: r.business.name, hasLogo: Boolean(r.business.logoUrl) },
    campaign: r.campaign,
    scans: scanMap.get(r.id) ?? 0,
  }));
}

export async function createQrCode(db: TenantDb, body: z.infer<typeof qrBodySchema>) {
  const business = await getBusiness(db, body.businessId);
  if (body.campaignId) {
    const c = await db.reviewCampaign.findFirst({ where: { id: body.campaignId, businessId: business.id, deletedAt: null } });
    if (!c) throw new NotFoundError('Campaign');
  }
  if (body.includeLogo && !business.logoUrl) throw new ValidationError('Add a logo to this business before putting it inside the QR code.');
  return db.reviewQRCode.create({ data: scoped({ ...body, token: newPublicToken() }) });
}

export async function deleteQrCode(db: TenantDb, id: string) {
  const q = await db.reviewQRCode.findFirst({ where: { id, deletedAt: null } });
  if (!q) throw new NotFoundError('QR code');
  await db.reviewQRCode.update({ where: { id }, data: { deletedAt: new Date(), status: 'inactive' } });
  return { deleted: true as const };
}

export async function qrAsset(db: TenantDb, id: string, origin: string, format: 'png' | 'svg') {
  const q = await db.reviewQRCode.findFirst({ where: { id, deletedAt: null }, include: { business: { select: { logoUrl: true, name: true } } } });
  if (!q) throw new NotFoundError('QR code');
  const url = reviewUrl(origin, q.token);
  const fileBase = q.label.replace(/[^\w-]+/g, '_').slice(0, 60) || 'qr';
  if (format === 'svg') {
    const svg = await qrSvg(url, { fg: q.fgColor, bg: q.bgColor, logoUrl: q.includeLogo ? q.business.logoUrl : null });
    return { body: Buffer.from(svg, 'utf8'), contentType: 'image/svg+xml; charset=utf-8', fileName: `${fileBase}.svg`, svg };
  }
  const png = await qrPng(url, { fg: q.fgColor, bg: q.bgColor });
  return { body: png, contentType: 'image/png', fileName: `${fileBase}.png`, svg: null };
}

/** Link-only helpers for a business: its default public URL (no campaign tracking). */
export async function businessLink(db: TenantDb, id: string, origin: string) {
  const b = await getBusiness(db, id);
  return { url: reviewUrl(origin, b.publicToken) };
}

// ── automation jobs ──────────────────────────────────────────────────

const jobListSelect = {
  id: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  lastError: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  screenshotPath: true,
  business: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
} as const;

export async function listJobs(db: TenantDb, q: { status?: string; businessId?: string; page: number; pageSize: number }) {
  const where = { ...(q.status ? { status: q.status } : {}), ...(q.businessId ? { businessId: q.businessId } : {}) };
  const [total, rows] = await Promise.all([
    db.reviewAutomationJob.count({ where }),
    db.reviewAutomationJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: jobListSelect }),
  ]);
  return { total, items: rows.map(({ screenshotPath, ...r }) => ({ ...r, hasScreenshot: Boolean(screenshotPath) })) };
}

export async function getJob(db: TenantDb, id: string) {
  const job = await db.reviewAutomationJob.findFirst({
    where: { id },
    select: { ...jobListSelect, result: true, qrCodeId: true, approval: { select: { rating: true, language: true, createdAt: true } } },
  });
  if (!job) throw new NotFoundError('Automation job');
  const logs = await db.reviewAutomationLog.findMany({ where: { jobId: id }, orderBy: { createdAt: 'asc' }, take: 300, select: { id: true, level: true, message: true, createdAt: true } });
  const { screenshotPath, ...rest } = job;
  return { ...rest, hasScreenshot: Boolean(screenshotPath), logs };
}

const RETRYABLE = ['failed', 'cancelled'];

export async function retryJob(db: TenantDb, id: string) {
  const job = await db.reviewAutomationJob.findFirst({ where: { id }, select: { id: true, status: true, businessId: true } });
  if (!job) throw new NotFoundError('Automation job');
  if (!RETRYABLE.includes(job.status)) throw new ConflictError('Only failed or cancelled jobs can be retried.');
  const business = await db.reviewBusiness.findFirst({ where: { id: job.businessId, deletedAt: null, status: 'active' }, select: { id: true } });
  if (!business) throw new ConflictError('This business is inactive or deleted.');
  await db.reviewAutomationJob.update({
    where: { id },
    data: { status: 'pending', attempts: 0, lastError: null, nextRunAt: new Date(), lockedAt: null, lockedBy: null, finishedAt: null, cancelRequested: false },
  });
  await db.reviewAutomationLog.create({ data: scoped({ jobId: id, level: 'info', message: 'Retry requested from the dashboard.' }) });
  return { id, status: 'pending' as const };
}

export async function cancelJob(db: TenantDb, id: string) {
  const job = await db.reviewAutomationJob.findFirst({ where: { id }, select: { id: true, status: true } });
  if (!job) throw new NotFoundError('Automation job');
  if (['completed', 'cancelled', 'failed'].includes(job.status)) throw new ConflictError('This job has already finished.');
  // A running job is stopped by the worker at its next checkpoint; a waiting job is cancelled immediately.
  const waiting = ['pending', 'queued', 'awaiting_customer_confirmation'].includes(job.status);
  await db.reviewAutomationJob.update({ where: { id }, data: waiting ? { status: 'cancelled', finishedAt: new Date(), cancelRequested: true } : { cancelRequested: true } });
  await db.reviewAutomationLog.create({ data: scoped({ jobId: id, level: 'warn', message: waiting ? 'Cancelled from the dashboard.' : 'Cancel requested. The worker will stop at the next step.' }) });
  return { id, status: waiting ? ('cancelled' as const) : job.status };
}

/** Resolves a stored screenshot to a readable file, ensuring it stays inside the screenshot directory. */
export function screenshotRoot(): string {
  return path.resolve(process.env.REVIEW_SCREENSHOT_DIR || path.join(process.cwd(), '.runtime', 'review-screenshots'));
}

export async function jobScreenshot(db: TenantDb, id: string): Promise<Buffer> {
  const job = await db.reviewAutomationJob.findFirst({ where: { id }, select: { screenshotPath: true } });
  if (!job?.screenshotPath) throw new NotFoundError('Screenshot');
  const root = screenshotRoot();
  const full = path.resolve(root, job.screenshotPath);
  if (!full.startsWith(root + path.sep)) throw new NotFoundError('Screenshot');
  try {
    return await fs.promises.readFile(full);
  } catch {
    throw new NotFoundError('Screenshot');
  }
}

// ── worker health ────────────────────────────────────────────────────

export function heartbeatFile(): string {
  return path.resolve(process.env.REVIEW_WORKER_HEARTBEAT_FILE || path.join(process.cwd(), '.runtime', 'review-worker-heartbeat.json'));
}

export async function workerHealth(db: TenantDb) {
  let beat: { at?: string; pid?: number; version?: string; active?: number; concurrency?: number; processed?: number; failures?: number } | null = null;
  try {
    beat = JSON.parse(await fs.promises.readFile(heartbeatFile(), 'utf8'));
  } catch {
    beat = null;
  }
  const ageMs = beat?.at ? Date.now() - new Date(beat.at).getTime() : null;
  const [pending, running] = await Promise.all([
    db.reviewAutomationJob.count({ where: { status: { in: ['pending', 'queued'] } } }),
    db.reviewAutomationJob.count({ where: { status: { in: ['initializing', 'browser_launched', 'navigating', 'preparing_review'] } } }),
  ]);
  return {
    online: ageMs !== null && ageMs < 60_000,
    lastHeartbeatAt: beat?.at ?? null,
    pid: beat?.pid ?? null,
    concurrency: beat?.concurrency ?? null,
    processed: beat?.processed ?? 0,
    failures: beat?.failures ?? 0,
    pendingJobs: pending,
    runningJobs: running,
  };
}

// ── analytics ────────────────────────────────────────────────────────

type Range = { days: number; businessId?: string };

const FUNNEL: Array<{ key: string; label: string }> = [
  { key: 'page_view', label: 'Opened review page' },
  { key: 'rating_selected', label: 'Selected a rating' },
  { key: 'feedback_submitted', label: 'Shared feedback' },
  { key: 'ai_generated', label: 'Got AI drafts' },
  { key: 'draft_approved', label: 'Approved a draft' },
  { key: 'google_opened', label: 'Opened Google review page' },
];

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const weekKey = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // Monday
  return t.toISOString().slice(0, 10);
};
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

export async function analyticsOverview(db: TenantDb, r: Range) {
  const since = new Date(Date.now() - r.days * 86_400_000);
  const bizWhere = r.businessId ? { businessId: r.businessId } : {};
  const events = await db.reviewEngagementEvent.findMany({
    where: { createdAt: { gte: since }, ...bizWhere },
    select: { createdAt: true, eventType: true, visitorId: true, language: true, businessId: true, campaignId: true, qrCodeId: true, platform: true },
    take: 100_000,
  });
  const [aiAgg, jobGroups, approvals] = await Promise.all([
    db.reviewAIRequest.aggregate({ where: { createdAt: { gte: since }, ...bizWhere }, _count: { _all: true }, _sum: { outputCount: true, tokensUsed: true } }),
    db.reviewAutomationJob.groupBy({ by: ['status'], where: { createdAt: { gte: since }, ...bizWhere }, _count: { _all: true } }),
    db.reviewCustomerApproval.count({ where: { createdAt: { gte: since }, ...bizWhere } }),
  ]);

  const count = (type: string) => events.filter((e) => e.eventType === type).length;
  const uniq = (type: string) => new Set(events.filter((e) => e.eventType === type).map((e) => e.visitorId)).size;
  const jobs: Record<string, number> = Object.fromEntries(jobGroups.map((g) => [g.status, g._count._all]));
  const jobTotal = Object.values(jobs).reduce((a, b) => a + b, 0);

  const series = (keyFn: (d: Date) => string) => {
    const m = new Map<string, { period: string; scans: number; drafts: number; approvals: number; googleOpens: number }>();
    for (const e of events) {
      const k = keyFn(e.createdAt);
      const row = m.get(k) ?? { period: k, scans: 0, drafts: 0, approvals: 0, googleOpens: 0 };
      if (e.eventType === 'page_view') row.scans += 1;
      else if (e.eventType === 'ai_generated') row.drafts += 1;
      else if (e.eventType === 'draft_approved') row.approvals += 1;
      else if (e.eventType === 'google_opened') row.googleOpens += 1;
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => a.period.localeCompare(b.period));
  };

  const languages = new Map<string, number>();
  for (const e of events) if (e.eventType === 'ai_generated' && e.language) languages.set(e.language, (languages.get(e.language) ?? 0) + 1);

  const funnel = FUNNEL.map((s) => ({ ...s, count: uniq(s.key) }));
  const social = new Map<string, number>();
  for (const e of events) if (e.eventType === 'social_opened' && e.platform) social.set(e.platform, (social.get(e.platform) ?? 0) + 1);

  return {
    rangeDays: r.days,
    totals: {
      qrScans: count('page_view'),
      uniqueVisitors: uniq('page_view'),
      aiRequests: aiAgg._count._all,
      draftsGenerated: aiAgg._sum.outputCount ?? 0,
      approvedDrafts: approvals,
      copyActions: count('review_copied'),
      googleOpens: count('google_opened'),
      socialOpens: count('social_opened'),
      customerReportedDone: count('customer_reported_done'),
      automationJobs: jobTotal,
      prepSuccess: (jobs.awaiting_customer_confirmation ?? 0) + (jobs.completed ?? 0),
      prepFailures: jobs.failed ?? 0,
      aiTokens: aiAgg._sum.tokensUsed ?? 0,
    },
    jobsByStatus: jobs,
    daily: series(dayKey),
    weekly: series(weekKey),
    monthly: series(monthKey),
    languages: [...languages.entries()].map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count),
    funnel,
    socialByPlatform: [...social.entries()].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count),
    note: 'Google page opens are not published reviews. A review counts as confirmed only when the customer says they finished; ChatNexGen cannot verify publication on Google.',
  };
}

async function breakdown(db: TenantDb, r: Range, by: 'campaignId' | 'businessId' | 'qrCodeId') {
  const since = new Date(Date.now() - r.days * 86_400_000);
  const where = { createdAt: { gte: since }, ...(r.businessId ? { businessId: r.businessId } : {}) };
  const rows = await db.reviewEngagementEvent.groupBy({ by: [by, 'eventType'], where, _count: { _all: true } });
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const id = (row[by] as string | null) ?? '_none';
    const cur = map.get(id) ?? {};
    cur[row.eventType] = row._count._all;
    map.set(id, cur);
  }
  return map;
}

export async function analyticsCampaigns(db: TenantDb, r: Range) {
  const [stats, campaigns, qrs] = await Promise.all([
    breakdown(db, r, 'campaignId'),
    db.reviewCampaign.findMany({ where: { deletedAt: null, ...(r.businessId ? { businessId: r.businessId } : {}) }, select: { id: true, name: true, business: { select: { name: true } } } }),
    breakdown(db, r, 'qrCodeId'),
  ]);
  const qrRows = await db.reviewQRCode.findMany({ where: { deletedAt: null, ...(r.businessId ? { businessId: r.businessId } : {}) }, select: { id: true, label: true, placement: true, business: { select: { name: true } } } });
  const shape = (s: Record<string, number> | undefined) => ({ scans: s?.page_view ?? 0, drafts: s?.ai_generated ?? 0, approvals: s?.draft_approved ?? 0, googleOpens: s?.google_opened ?? 0, copies: s?.review_copied ?? 0 });
  return {
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, business: c.business.name, ...shape(stats.get(c.id)) })),
    qrCodes: qrRows.map((q) => ({ id: q.id, name: q.label, placement: q.placement, business: q.business.name, ...shape(qrs.get(q.id)) })),
  };
}

export async function analyticsBusinesses(db: TenantDb, r: Range) {
  const [stats, businesses] = await Promise.all([
    breakdown(db, { ...r, businessId: undefined }, 'businessId'),
    db.reviewBusiness.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
  ]);
  return {
    businesses: businesses.map((b) => {
      const s = stats.get(b.id);
      return { id: b.id, name: b.name, scans: s?.page_view ?? 0, drafts: s?.ai_generated ?? 0, approvals: s?.draft_approved ?? 0, googleOpens: s?.google_opened ?? 0, copies: s?.review_copied ?? 0 };
    }),
  };
}