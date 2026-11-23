/**
 * Google Review module endpoints.
 *
 * Tenant (dashboard, session + tenant required):
 *   /api/reviews/businesses, /campaigns, /qr, /ai, /automation, /analytics
 * Public (customer, token is the credential):
 *   /api/public/reviews/[token]  (page data, /feedback, /approve, /events, /status)
 */

import { requestOrigin as siteOrigin } from '../site-origin';
import { z } from 'zod';

import { LANGUAGE_CODES } from '@/lib/reviews/constants';
import { GOOGLE_LINK_STEPS, validateGoogleReviewUrl } from '@/lib/reviews/google-url';
import { reviewUrl } from '@/lib/reviews/qr';

import { createHandler, createRawHandler, NotFoundError, scoped, tenantDb, ValidationError, type TenantDb } from '../kernel';
import { generateDrafts, transformDraft } from '../services/review-ai.service';
import {
  analyticsBusinesses,
  analyticsCampaigns,
  analyticsOverview,
  businessBodySchema,
  businessLink,
  campaignBodySchema,
  cancelJob,
  createBusiness,
  createCampaign,
  createQrCode,
  deleteBusiness,
  deleteCampaign,
  deleteQrCode,
  getBusiness,
  getJob,
  jobScreenshot,
  listBusinesses,
  listCampaigns,
  listJobs,
  listQrCodes,
  qrAsset,
  qrBodySchema,
  retryJob,
  updateBusiness,
  updateCampaign,
  workerHealth,
} from '../services/review.service';
import {
  approveBodySchema,
  eventBodySchema,
  feedbackBodySchema,
  publicApprove,
  publicEvent,
  publicFeedback,
  publicJobStatus,
  publicPage,
  statusQuerySchema,
  tokenParams,
} from '../services/review-public.service';

const loose = z.any();
const idParams = z.object({ id: z.string().uuid() });
const rangeQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30), businessId: z.string().uuid().optional() });

const ipOf = (request: Request) => (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
const publicKey = (name: string) => ({ request }: { request: Request }) => `review-public:${name}:${ipOf(request)}`;

/** CSRF defence for the public POSTs: a browser always sends Origin, and it must be this site. */
function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return; // non-browser caller; still rate limited and token-gated
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ValidationError('Bad request origin.');
  }
  if (host && originHost !== host) throw new ValidationError('Cross-site requests are not allowed.');
}

const uuidAt = (request: Request, index: number) => {
  const part = new URL(request.url).pathname.split('/').filter(Boolean)[index];
  if (!part || !/^[0-9a-f-]{36}$/i.test(part)) throw new NotFoundError('Resource');
  return part;
};

const fileResponse = (data: Uint8Array, contentType: string, fileName?: string, inline = true) =>
  new Response(Buffer.from(data), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(fileName ? { 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fileName.replace(/[^\w.-]/g, '_')}"` } : {}),
    },
  });

async function logAi(db: TenantDb, input: { businessId: string; kind: string; language: string; rating: number | null; inputChars: number; outputCount: number; tokensUsed: number }) {
  await db.reviewAIRequest.create({ data: scoped(input) });
}

export const reviewController = {
  // ── businesses ────────────────────────────────────────────────────
  businessList: createHandler({
    operation: 'reviews.business.list',
    auth: 'tenant',
    query: z.object({ search: z.string().trim().max(100).optional(), status: z.enum(['active', 'inactive']).optional() }),
    response: loose,
    handle: ({ db, query }) => listBusinesses(db, query),
  }),
  businessCreate: createHandler({
    operation: 'reviews.business.create',
    auth: 'tenant',
    body: businessBodySchema,
    response: loose,
    status: 201,
    handle: ({ db, body }) => createBusiness(db, body),
  }),
  businessGet: createHandler({ operation: 'reviews.business.get', auth: 'tenant', params: idParams, response: loose, handle: ({ db, params }) => getBusiness(db, params.id) }),
  businessUpdate: createHandler({
    operation: 'reviews.business.update',
    auth: 'tenant',
    params: idParams,
    body: businessBodySchema.partial(),
    response: loose,
    handle: ({ db, params, body }) => updateBusiness(db, params.id, body),
  }),
  businessDelete: createHandler({ operation: 'reviews.business.delete', auth: 'tenant', params: idParams, response: loose, handle: ({ db, params }) => deleteBusiness(db, params.id) }),
  businessLink: createHandler({
    operation: 'reviews.business.link',
    auth: 'tenant',
    params: idParams,
    response: loose,
    handle: ({ db, params, request }) => businessLink(db, params.id, siteOrigin(request)),
  }),
  validateUrl: createHandler({
    operation: 'reviews.googleUrl.validate',
    auth: 'tenant',
    body: z.object({ url: z.string().max(2000) }),
    response: loose,
    rateLimit: { limit: 60, windowMs: 60_000 },
    handle: async ({ body }) => ({ ...validateGoogleReviewUrl(body.url), steps: GOOGLE_LINK_STEPS }),
  }),

  // ── campaigns ─────────────────────────────────────────────────────
  campaignList: createHandler({ operation: 'reviews.campaign.list', auth: 'tenant', query: z.object({ businessId: z.string().uuid().optional() }), response: loose, handle: ({ db, query }) => listCampaigns(db, query) }),
  campaignCreate: createHandler({ operation: 'reviews.campaign.create', auth: 'tenant', body: campaignBodySchema, response: loose, status: 201, handle: ({ db, body }) => createCampaign(db, body) }),
  campaignUpdate: createHandler({ operation: 'reviews.campaign.update', auth: 'tenant', params: idParams, body: campaignBodySchema.partial(), response: loose, handle: ({ db, params, body }) => updateCampaign(db, params.id, body) }),
  campaignDelete: createHandler({ operation: 'reviews.campaign.delete', auth: 'tenant', params: idParams, response: loose, handle: ({ db, params }) => deleteCampaign(db, params.id) }),

  // ── QR codes ──────────────────────────────────────────────────────
  qrList: createHandler({
    operation: 'reviews.qr.list',
    auth: 'tenant',
    query: z.object({ businessId: z.string().uuid().optional(), campaignId: z.string().uuid().optional() }),
    response: loose,
    handle: ({ db, query, request }) => listQrCodes(db, query, siteOrigin(request)),
  }),
  qrGenerate: createHandler({
    operation: 'reviews.qr.generate',
    auth: 'tenant',
    body: qrBodySchema,
    response: loose,
    status: 201,
    rateLimit: { limit: 30, windowMs: 60_000 },
    async handle({ db, body, request }) {
      const created = await createQrCode(db, body);
      return { id: created.id, token: created.token, url: reviewUrl(siteOrigin(request), created.token) };
    },
  }),
  qrDelete: createHandler({ operation: 'reviews.qr.delete', auth: 'tenant', params: idParams, response: loose, handle: ({ db, params }) => deleteQrCode(db, params.id) }),
  qrImage: createRawHandler({
    operation: 'reviews.qr.image',
    auth: 'tenant',
    async handle({ request, ctx }) {
      const id = uuidAt(request, 3);
      const format = new URL(request.url).searchParams.get('format') === 'svg' ? 'svg' : 'png';
      const asset = await qrAsset(tenantDb(ctx!.tenantId), id, siteOrigin(request), format);
      const download = new URL(request.url).searchParams.get('download') === '1';
      return fileResponse(asset.body, asset.contentType, asset.fileName, !download);
    },
  }),

  // ── AI (dashboard preview / testing) ──────────────────────────────
  aiGenerate: createHandler({
    operation: 'reviews.ai.generate',
    auth: 'tenant',
    body: z.object({ businessId: z.string().uuid(), rating: z.coerce.number().int().min(1).max(5), feedback: z.string().trim().max(1500).default(''), language: z.enum(LANGUAGE_CODES).default('en') }),
    response: loose,
    rateLimit: { limit: 20, windowMs: 60_000 },
    async handle({ db, body }) {
      const b = await getBusiness(db, body.businessId);
      const out = await generateDrafts({ business: { name: b.name, category: b.category, description: b.description, services: Array.isArray(b.services) ? (b.services as string[]) : [] }, rating: body.rating, feedback: body.feedback, language: body.language });
      await logAi(db, { businessId: b.id, kind: 'generate', language: body.language, rating: body.rating, inputChars: body.feedback.length, outputCount: out.value.length, tokensUsed: out.tokensUsed });
      return { drafts: out.value };
    },
  }),
  aiTranslate: createHandler({
    operation: 'reviews.ai.translate',
    auth: 'tenant',
    body: z.object({ businessId: z.string().uuid(), text: z.string().trim().min(8).max(1000), language: z.enum(LANGUAGE_CODES), rating: z.coerce.number().int().min(1).max(5).default(5), kind: z.enum(['translate', 'shorten', 'expand']).default('translate') }),
    response: loose,
    rateLimit: { limit: 20, windowMs: 60_000 },
    async handle({ db, body }) {
      const b = await getBusiness(db, body.businessId);
      const out = await transformDraft({ kind: body.kind, text: body.text, language: body.language, rating: body.rating });
      await logAi(db, { businessId: b.id, kind: body.kind, language: body.language, rating: body.rating, inputChars: body.text.length, outputCount: 1, tokensUsed: out.tokensUsed });
      return { text: out.value };
    },
  }),

  // ── automation ────────────────────────────────────────────────────
  automationPrepare: createHandler({
    operation: 'reviews.automation.prepare',
    auth: 'tenant',
    body: z.object({ businessId: z.string().uuid() }),
    response: loose,
    status: 201,
    rateLimit: { limit: 10, windowMs: 60_000 },
    /** Dashboard "test my Google link" job: no customer text, it only checks that the page can be reached. */
    async handle({ db, body }) {
      const b = await getBusiness(db, body.businessId);
      if (!b.googleReviewUrl) throw new ValidationError('Add a Google review link to this business first.');
      const job = await db.reviewAutomationJob.create({ data: scoped({ businessId: b.id }), select: { id: true } });
      await db.reviewAutomationLog.create({ data: scoped({ jobId: job.id, level: 'info', message: 'Link check requested from the dashboard.' }) });
      return { id: job.id, status: 'pending' };
    },
  }),
  jobList: createHandler({
    operation: 'reviews.jobs.list',
    auth: 'tenant',
    query: z.object({ status: z.string().max(40).optional(), businessId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }),
    response: loose,
    handle: ({ db, query }) => listJobs(db, query),
  }),
  jobGet: createHandler({ operation: 'reviews.jobs.get', auth: 'tenant', params: idParams, response: loose, handle: ({ db, params }) => getJob(db, params.id) }),
  jobRetry: createHandler({ operation: 'reviews.jobs.retry', auth: 'tenant', params: idParams, response: loose, rateLimit: { limit: 20, windowMs: 60_000 }, handle: ({ db, params }) => retryJob(db, params.id) }),
  jobCancel: createHandler({ operation: 'reviews.jobs.cancel', auth: 'tenant', params: idParams, response: loose, handle: ({ db, params }) => cancelJob(db, params.id) }),
  jobScreenshot: createRawHandler({
    operation: 'reviews.jobs.screenshot',
    auth: 'tenant',
    async handle({ request, ctx }) {
      const data = await jobScreenshot(tenantDb(ctx!.tenantId), uuidAt(request, 4));
      return fileResponse(data, 'image/png');
    },
  }),
  workerHealth: createHandler({ operation: 'reviews.worker.health', auth: 'tenant', response: loose, handle: ({ db }) => workerHealth(db) }),

  // ── analytics ─────────────────────────────────────────────────────
  analyticsOverview: createHandler({ operation: 'reviews.analytics.overview', auth: 'tenant', query: rangeQuery, response: loose, handle: ({ db, query }) => analyticsOverview(db, query) }),
  analyticsCampaigns: createHandler({ operation: 'reviews.analytics.campaigns', auth: 'tenant', query: rangeQuery, response: loose, handle: ({ db, query }) => analyticsCampaigns(db, query) }),
  analyticsBusinesses: createHandler({ operation: 'reviews.analytics.businesses', auth: 'tenant', query: rangeQuery, response: loose, handle: ({ db, query }) => analyticsBusinesses(db, query) }),

  // ── public ────────────────────────────────────────────────────────
  publicPage: createHandler({ operation: 'reviews.public.page', auth: 'public', params: tokenParams, response: loose, rateLimit: { limit: 90, windowMs: 60_000, key: publicKey('page') as never }, handle: ({ params }) => publicPage(params.token) }),
  publicFeedback: createHandler({
    operation: 'reviews.public.feedback',
    auth: 'public',
    params: tokenParams,
    body: feedbackBodySchema,
    response: loose,
    rateLimit: { limit: 10, windowMs: 60_000, key: publicKey('ai') as never },
    handle: ({ params, body, request }) => {
      assertSameOrigin(request);
      return publicFeedback(params.token, body);
    },
  }),
  publicApprove: createHandler({
    operation: 'reviews.public.approve',
    auth: 'public',
    params: tokenParams,
    body: approveBodySchema,
    response: loose,
    status: 201,
    rateLimit: { limit: 6, windowMs: 60_000, key: publicKey('approve') as never },
    handle: ({ params, body, request }) => {
      assertSameOrigin(request);
      return publicApprove(params.token, body);
    },
  }),
  publicEvent: createHandler({
    operation: 'reviews.public.event',
    auth: 'public',
    params: tokenParams,
    body: eventBodySchema,
    response: loose,
    rateLimit: { limit: 60, windowMs: 60_000, key: publicKey('event') as never },
    handle: ({ params, body, request }) => {
      assertSameOrigin(request);
      return publicEvent(params.token, body);
    },
  }),
  publicStatus: createHandler({
    operation: 'reviews.public.status',
    auth: 'public',
    params: tokenParams,
    query: statusQuerySchema,
    response: loose,
    rateLimit: { limit: 60, windowMs: 60_000, key: publicKey('status') as never },
    handle: ({ params, query }) => publicJobStatus(params.token, query.jobId),
  }),
};