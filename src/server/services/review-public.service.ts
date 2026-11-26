/**
 * Google Review module: public (customer) services behind /review/[token].
 *
 * The token is the only credential. It is resolved with systemDb because no
 * tenant is known yet; every write after that goes through tenantDb(tenantId)
 * using the tenant found on the token's own row, never one sent by the client.
 *
 * Fairness rules enforced here, not just in the UI:
 *  - every rating (1 to 5) gets the same flow and reaches the same Google link;
 *  - AI only rewrites what the customer said, and low ratings stay critical.
 */

import { z } from 'zod';

import { LANGUAGE_CODES, MAX_REVIEW_CHARS, type ReviewLanguage } from '@/lib/reviews/constants';
import { PUBLIC_TOKEN_RE } from '@/lib/reviews/token';
import { sanitizeSocialLinks, SOCIAL_PLATFORMS, type SocialLink } from '@/lib/reviews/social-platforms';

import { ConflictError, NotFoundError, RateLimitError, scoped, systemDb, tenantDb, ValidationError, type TenantDb } from '../kernel';
import { generateDrafts, transformDraft } from './review-ai.service';

export const tokenParams = z.object({ token: z.string().regex(PUBLIC_TOKEN_RE, 'Invalid link.') });
const visitorId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const rating = z.coerce.number().int().min(1).max(5);
const language = z.enum(LANGUAGE_CODES);

const AI_DAILY_CAP = Number(process.env.REVIEW_AI_DAILY_CAP ?? 300);

interface Resolved {
  tenantId: string;
  db: TenantDb;
  business: { id: string; name: string; category: string | null; description: string | null; logoUrl: string | null; services: string[]; defaultLanguage: string; googleReviewUrl: string | null; socialLinks: SocialLink[] };
  qrCodeId: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

/** Looks the token up as a QR code first, then as a business default link. */
async function resolve(token: string): Promise<Resolved> {
  // systemDb: the token is how we learn the tenant. Nothing else is read before this.
  const qr = await systemDb.reviewQRCode.findFirst({
    where: { token, deletedAt: null, status: 'active' },
    select: { id: true, tenantId: true, campaign: { select: { id: true, name: true, status: true, deletedAt: true } }, business: true },
  });
  const biz = qr?.business ?? (await systemDb.reviewBusiness.findFirst({ where: { publicToken: token } }));
  if (!biz || biz.deletedAt || biz.status !== 'active') throw new NotFoundError('Review page');
  if (qr?.campaign && (qr.campaign.deletedAt || qr.campaign.status !== 'active')) throw new NotFoundError('Review page');
  return {
    tenantId: biz.tenantId,
    db: tenantDb(biz.tenantId),
    business: {
      id: biz.id,
      name: biz.name,
      category: biz.category,
      description: biz.description,
      logoUrl: biz.logoUrl,
      services: Array.isArray(biz.services) ? (biz.services as string[]) : [],
      defaultLanguage: biz.defaultLanguage,
      googleReviewUrl: biz.googleReviewUrl,
      socialLinks: sanitizeSocialLinks(biz.socialLinks),
    },
    qrCodeId: qr?.id ?? null,
    campaignId: qr?.campaign?.id ?? null,
    campaignName: qr?.campaign?.name ?? null,
  };
}

export async function publicPage(token: string) {
  const r = await resolve(token);
  return {
    business: {
      name: r.business.name,
      category: r.business.category,
      description: r.business.description,
      logoUrl: r.business.logoUrl,
      defaultLanguage: r.business.defaultLanguage,
    },
    campaign: r.campaignName,
    googleConfigured: Boolean(r.business.googleReviewUrl),
    // Universal QR page: every platform the business is on.
    socialLinks: r.business.socialLinks,
    // Tap-to-select highlights for the review (the customer picks what applies).
    services: r.business.services.slice(0, 8),
    maxChars: MAX_REVIEW_CHARS,
  };
}

// ── AI ───────────────────────────────────────────────────────────────

export const feedbackBodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('generate'), visitorId, rating, language, feedback: z.string().trim().max(1500).default('') }),
  z.object({ mode: z.enum(['translate', 'shorten', 'expand']), visitorId, rating, language, text: z.string().trim().min(8).max(MAX_REVIEW_CHARS) }),
]);

async function aiBudgetLeft(r: Resolved): Promise<void> {
  const used = await r.db.reviewAIRequest.count({ where: { businessId: r.business.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (used >= AI_DAILY_CAP) throw new RateLimitError(3600);
}

export async function publicFeedback(token: string, body: z.infer<typeof feedbackBodySchema>) {
  const r = await resolve(token);
  await aiBudgetLeft(r);
  const lang = body.language as ReviewLanguage;
  const kind = body.mode;
  const inputChars = (kind === 'generate' ? body.feedback : body.text).length;
  try {
    if (body.mode === 'generate') {
      const out = await generateDrafts({ business: r.business, rating: body.rating, feedback: body.feedback, language: lang, count: 3 });
      await r.db.reviewAIRequest.create({ data: scoped({ businessId: r.business.id, qrCodeId: r.qrCodeId, kind, language: lang, rating: body.rating, inputChars, outputCount: out.value.length, tokensUsed: out.tokensUsed }) });
      await r.db.reviewEngagementEvent.create({ data: scoped({ businessId: r.business.id, campaignId: r.campaignId, qrCodeId: r.qrCodeId, visitorId: body.visitorId, eventType: 'ai_generated', language: lang, rating: body.rating }) });
      return { drafts: out.value };
    }
    const out = await transformDraft({ kind: body.mode, text: body.text, language: lang, rating: body.rating });
    await r.db.reviewAIRequest.create({ data: scoped({ businessId: r.business.id, qrCodeId: r.qrCodeId, kind, language: lang, rating: body.rating, inputChars, outputCount: 1, tokensUsed: out.tokensUsed }) });
    return { drafts: [out.value] };
  } catch (e) {
    await r.db.reviewAIRequest.create({ data: scoped({ businessId: r.business.id, qrCodeId: r.qrCodeId, kind, language: lang, rating: body.rating, inputChars, success: false, error: (e as Error).message.slice(0, 290) }) }).catch(() => undefined);
    throw new ValidationError((e as Error).message);
  }
}

// ── approval → automation job ────────────────────────────────────────

export const approveBodySchema = z.object({
  visitorId,
  rating,
  language,
  feedback: z.string().trim().max(1500).default(''),
  finalText: z.string().trim().min(8, 'Write at least a short review.').max(MAX_REVIEW_CHARS),
  edited: z.boolean().default(false),
  /** The customer must personally confirm the wording. */
  confirmed: z.literal(true, { errorMap: () => ({ message: 'Please confirm this is your own review.' }) }),
});

export async function publicApprove(token: string, body: z.infer<typeof approveBodySchema>) {
  const r = await resolve(token);
  if (!r.business.googleReviewUrl) throw new ConflictError('This business has not set up its Google review link yet.');
  const approval = await r.db.reviewCustomerApproval.create({
    data: scoped({
      businessId: r.business.id,
      campaignId: r.campaignId,
      qrCodeId: r.qrCodeId,
      visitorId: body.visitorId,
      rating: body.rating,
      language: body.language,
      feedbackText: body.feedback || null,
      finalText: body.finalText,
      edited: body.edited,
    }),
    select: { id: true },
  });
  await r.db.reviewEngagementEvent.create({ data: scoped({ businessId: r.business.id, campaignId: r.campaignId, qrCodeId: r.qrCodeId, visitorId: body.visitorId, eventType: 'draft_approved', language: body.language, rating: body.rating }) });

  // The worker only checks and prepares the Google page. It never publishes anything.
  const job = await r.db.reviewAutomationJob.create({
    data: scoped({ businessId: r.business.id, campaignId: r.campaignId, qrCodeId: r.qrCodeId, approvalId: approval.id }),
    select: { id: true },
  });
  await r.db.reviewAutomationLog.create({ data: scoped({ jobId: job.id, level: 'info', message: 'Customer approved the wording. Job created.' }) });
  return { jobId: job.id, googleUrl: r.business.googleReviewUrl };
}

export const statusQuerySchema = z.object({ jobId: z.string().uuid() });

/** Customer-safe progress: a label and whether the page is ready, nothing internal. */
export async function publicJobStatus(token: string, jobId: string) {
  const r = await resolve(token);
  const job = await r.db.reviewAutomationJob.findFirst({ where: { id: jobId, businessId: r.business.id }, select: { status: true, lastError: true } });
  if (!job) throw new NotFoundError('Job');
  const ready = ['awaiting_customer_confirmation', 'completed'].includes(job.status);
  const failed = job.status === 'failed' || job.status === 'cancelled';
  return { status: job.status, ready, failed };
}

// ── events ───────────────────────────────────────────────────────────

export const PUBLIC_EVENTS = ['page_view', 'rating_selected', 'feedback_submitted', 'review_copied', 'google_opened', 'customer_reported_done', 'social_opened'] as const;
export const eventBodySchema = z.object({
  visitorId,
  eventType: z.enum(PUBLIC_EVENTS),
  rating: rating.optional(),
  language: language.optional(),
  jobId: z.string().uuid().optional(),
  platform: z.enum(SOCIAL_PLATFORMS).optional(),
});

export async function publicEvent(token: string, body: z.infer<typeof eventBodySchema>) {
  const r = await resolve(token);
  // Only platforms this business actually shows can be counted.
  if (body.eventType === 'social_opened' && !r.business.socialLinks.some((l) => l.platform === body.platform)) throw new ValidationError('Unknown platform.');
  // A page refresh is not a second scan: one page_view per visitor per 30 minutes.
  if (body.eventType === 'page_view') {
    const recent = await r.db.reviewEngagementEvent.count({
      where: { businessId: r.business.id, qrCodeId: r.qrCodeId, visitorId: body.visitorId, eventType: 'page_view', createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
    });
    if (recent > 0) return { recorded: false };
  }
  await r.db.reviewEngagementEvent.create({
    data: scoped({ businessId: r.business.id, campaignId: r.campaignId, qrCodeId: r.qrCodeId, visitorId: body.visitorId, eventType: body.eventType, rating: body.rating ?? null, language: body.language ?? null, platform: body.eventType === 'social_opened' ? body.platform ?? null : null }),
  });
  // The customer says they finished on Google. This is self-reported, never verified.
  if (body.eventType === 'customer_reported_done' && body.jobId) {
    await r.db.reviewAutomationJob.updateMany({ where: { id: body.jobId, businessId: r.business.id, status: 'awaiting_customer_confirmation' }, data: { status: 'completed', finishedAt: new Date() } });
    await r.db.reviewAutomationLog.create({ data: scoped({ jobId: body.jobId, level: 'info', message: 'Customer reported they finished on Google (not verified).' }) }).catch(() => undefined);
  }
  return { recorded: true };
}