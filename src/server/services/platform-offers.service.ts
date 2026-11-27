/**
 * Super admin: home-page pop-up offers, promo codes, promo history and
 * payments. Platform tables (no tenant), so everything uses systemDb and is
 * only reachable through `auth: 'superAdmin'` routes — except the two public
 * offer endpoints, which expose active offers only.
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { normalizePromoCode, PROMO_CODE_RE, promoLabel } from '@/lib/billing/promo';
import { SELF_SERVE_PLANS } from '@/lib/billing/plans';
import { ConflictError, NotFoundError, systemDb, ValidationError } from '../kernel';
import { toRules } from './billing.service';

const MAX_IMAGE_CHARS = 7_000_000; // ~5 MB image as a data URL
const dt = z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.date().nullable());
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

// ── offers ───────────────────────────────────────────────────────────

export const OFFER_KINDS = ['welcome', 'exit_intent'] as const;

export const offerSchema = z
  .object({
    kind: z.enum(OFFER_KINDS),
    title: z.string().trim().max(160).nullish().transform((v) => v ?? ''),
    body: optText(1000),
    imageUrl: z
      .string()
      .max(MAX_IMAGE_CHARS, 'Image is too large (max 5 MB).')
      .refine((v) => /^(https:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(v), 'Use an https image link or upload a PNG, JPEG, WebP or GIF.')
      .nullish()
      .transform((v) => (v ? v : null)),
    ctaLabel: optText(60),
    ctaUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => !v || /^(\/(?!\/)|https:\/\/)/.test(v), 'Use a page on this site (like /signup) or an https link.')
      .nullish()
      .transform((v) => (v ? v : null)),
    promoCodeId: z.string().uuid().nullish().transform((v) => v ?? null),
    delaySeconds: z.coerce.number().int().min(0).max(120).default(3),
    frequency: z.enum(['session', 'day', 'week', 'always']).default('session'),
    isActive: z.boolean().default(false),
    startsAt: dt.default(null),
    endsAt: dt.default(null),
  })
  .refine((v) => Boolean(v.title || v.body || v.imageUrl || v.ctaLabel || v.promoCodeId), { message: 'Add at least an image, headline or message.', path: ['title'] })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { message: 'The end date must be after the start date.', path: ['endsAt'] });

const offerInclude = { promoCode: { select: { id: true, code: true, isActive: true } } } as const;

export async function listOffers() {
  const rows = await systemDb.marketingOffer.findMany({ orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }], include: offerInclude });
  return rows;
}

/** Only one offer of each kind can be live at a time; activating one pauses the others. */
async function pauseOthers(kind: string, keepId: string) {
  await systemDb.marketingOffer.updateMany({ where: { kind, isActive: true, NOT: { id: keepId } }, data: { isActive: false } });
}

async function checkPromoRef(id: string | null) {
  if (id && !(await systemDb.promoCode.findUnique({ where: { id }, select: { id: true } }))) throw new ValidationError('That promo code no longer exists.');
}

export async function createOffer(body: z.infer<typeof offerSchema>) {
  await checkPromoRef(body.promoCodeId);
  const row = await systemDb.marketingOffer.create({ data: body, include: offerInclude });
  if (row.isActive) await pauseOthers(row.kind, row.id);
  return row;
}

export async function updateOffer(id: string, body: Partial<z.infer<typeof offerSchema>>) {
  const existing = await systemDb.marketingOffer.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Offer');
  if (body.promoCodeId !== undefined) await checkPromoRef(body.promoCodeId);
  const row = await systemDb.marketingOffer.update({ where: { id }, data: body, include: offerInclude });
  if (row.isActive) await pauseOthers(row.kind, row.id);
  return row;
}

export async function deleteOffer(id: string) {
  const res = await systemDb.marketingOffer.deleteMany({ where: { id } });
  if (!res.count) throw new NotFoundError('Offer');
  return { deleted: true };
}

/** Live offers for the home page: one welcome and one exit-intent at most. */
export async function publicOffers(now = new Date()) {
  const rows = await systemDb.marketingOffer.findMany({
    where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
    orderBy: { updatedAt: 'desc' },
    include: { promoCode: { select: { code: true, isActive: true, endsAt: true } } },
  });
  const pick = (kind: string) => rows.find((r) => r.kind === kind);
  const shape = (r: (typeof rows)[number] | undefined) =>
    r
      ? {
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          imageUrl: r.imageUrl,
          ctaLabel: r.ctaLabel,
          ctaUrl: r.ctaUrl,
          // Only advertise a code that can still be used.
          promoCode: r.promoCode?.isActive && (!r.promoCode.endsAt || r.promoCode.endsAt > now) ? r.promoCode.code : null,
          delaySeconds: r.delaySeconds,
          frequency: r.frequency,
          version: r.updatedAt.getTime(),
        }
      : null;
  return { welcome: shape(pick('welcome')), exitIntent: shape(pick('exit_intent')) };
}

export const offerEventSchema = z.object({ type: z.enum(['view', 'click', 'dismiss']) });

export async function recordOfferEvent(id: string, type: z.infer<typeof offerEventSchema>['type']) {
  const field = type === 'view' ? 'views' : type === 'click' ? 'clicks' : 'dismissals';
  const res = await systemDb.marketingOffer.updateMany({ where: { id, isActive: true }, data: { [field]: { increment: 1 } } });
  return { recorded: res.count > 0 };
}

// ── promo codes ──────────────────────────────────────────────────────

const PLAN_IDS = SELF_SERVE_PLANS.map((p) => p.id) as [string, ...string[]];

export const promoSchema = z
  .object({
    code: z
      .string()
      .transform(normalizePromoCode)
      .refine((v) => PROMO_CODE_RE.test(v), 'Use 3 to 40 letters, numbers, - or _, starting with a letter or number.'),
    description: optText(300),
    discountType: z.enum(['percent', 'flat']),
    discountValue: z.coerce.number().positive('The discount must be more than 0.'),
    maxDiscount: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().positive().nullable()).default(null),
    plans: z.array(z.enum(PLAN_IDS)).default([]),
    startsAt: dt.default(null),
    endsAt: dt.default(null),
    maxRedemptions: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().int().min(1).nullable()).default(null),
    perUserLimit: z.coerce.number().int().min(1).max(100).default(1),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.discountType !== 'percent' || v.discountValue <= 100, { message: 'A percentage discount can be at most 100.', path: ['discountValue'] })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { message: 'The end date must be after the start date.', path: ['endsAt'] });

export const promoUpdateSchema = z.object({
  description: optText(300).optional(),
  maxRedemptions: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(1).nullable()).optional(),
  perUserLimit: z.coerce.number().int().min(1).max(100).optional(),
  startsAt: dt.optional(),
  endsAt: dt.optional(),
  plans: z.array(z.enum(PLAN_IDS)).optional(),
  isActive: z.boolean().optional(),
});

async function promoStats(ids: string[]) {
  if (!ids.length) return new Map<string, { redeemed: number; pending: number; discountPaise: number; revenuePaise: number }>();
  const groups = await systemDb.promoRedemption.groupBy({ by: ['promoCodeId', 'status'], where: { promoCodeId: { in: ids } }, _count: { _all: true }, _sum: { discountPaise: true, finalPaise: true } });
  const out = new Map<string, { redeemed: number; pending: number; discountPaise: number; revenuePaise: number }>();
  for (const g of groups) {
    const s = out.get(g.promoCodeId) ?? { redeemed: 0, pending: 0, discountPaise: 0, revenuePaise: 0 };
    if (g.status === 'redeemed') {
      s.redeemed += g._count._all;
      s.discountPaise += g._sum.discountPaise ?? 0;
      s.revenuePaise += g._sum.finalPaise ?? 0;
    } else if (g.status === 'pending') s.pending += g._count._all;
    out.set(g.promoCodeId, s);
  }
  return out;
}

function shapePromo(p: Prisma.PromoCodeGetPayload<object>, stats?: { redeemed: number; pending: number; discountPaise: number; revenuePaise: number }) {
  const rules = toRules(p);
  const now = new Date();
  const state = !p.isActive ? 'paused' : p.endsAt && p.endsAt < now ? 'expired' : p.startsAt && p.startsAt > now ? 'scheduled' : p.maxRedemptions != null && p.timesRedeemed >= p.maxRedemptions ? 'used_up' : 'active';
  return {
    id: p.id,
    code: p.code,
    description: p.description,
    discountType: rules.discountType,
    discountValue: rules.discountValue,
    maxDiscount: rules.maxDiscount,
    label: promoLabel(rules),
    plans: rules.plans,
    startsAt: p.startsAt?.toISOString() ?? null,
    endsAt: p.endsAt?.toISOString() ?? null,
    maxRedemptions: p.maxRedemptions,
    perUserLimit: p.perUserLimit,
    timesRedeemed: p.timesRedeemed,
    isActive: p.isActive,
    state,
    stats: stats ?? { redeemed: 0, pending: 0, discountPaise: 0, revenuePaise: 0 },
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listPromoCodes() {
  const rows = await systemDb.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  const stats = await promoStats(rows.map((r) => r.id));
  return rows.map((r) => shapePromo(r, stats.get(r.id)));
}

export async function createPromoCode(body: z.infer<typeof promoSchema>) {
  try {
    const row = await systemDb.promoCode.create({ data: { ...body, plans: body.plans } });
    return shapePromo(row);
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new ConflictError(`The code ${body.code} already exists.`);
    throw e;
  }
}

/** The code and the discount are fixed once created, so past redemptions stay accurate. */
export async function updatePromoCode(id: string, body: z.infer<typeof promoUpdateSchema>) {
  const existing = await systemDb.promoCode.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Promo code');
  const startsAt = body.startsAt !== undefined ? body.startsAt : existing.startsAt;
  const endsAt = body.endsAt !== undefined ? body.endsAt : existing.endsAt;
  if (startsAt && endsAt && endsAt <= startsAt) throw new ValidationError('The end date must be after the start date.');
  const row = await systemDb.promoCode.update({ where: { id }, data: { ...body, ...(body.plans ? { plans: body.plans } : {}) } });
  return shapePromo(row, (await promoStats([id])).get(id));
}

export async function deletePromoCode(id: string) {
  const p = await systemDb.promoCode.findUnique({ where: { id }, select: { timesRedeemed: true } });
  if (!p) throw new NotFoundError('Promo code');
  if (p.timesRedeemed > 0) throw new ConflictError('This code has been used, so it is kept for the payment history. Pause it instead.');
  await systemDb.promoCode.delete({ where: { id } });
  return { deleted: true };
}

// ── promo history ────────────────────────────────────────────────────

export const historyQuerySchema = z.object({
  promoCodeId: z.string().uuid().optional(),
  status: z.enum(['pending', 'redeemed', 'released']).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export async function promoHistory(q: z.infer<typeof historyQuerySchema>) {
  const where: Prisma.PromoRedemptionWhereInput = {
    ...(q.promoCodeId ? { promoCodeId: q.promoCodeId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.search ? { OR: [{ email: { contains: q.search.toLowerCase() } }, { promoCode: { code: { contains: q.search.toUpperCase() } } }] } : {}),
  };
  const [total, rows, totals] = await Promise.all([
    systemDb.promoRedemption.count({ where }),
    systemDb.promoRedemption.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        promoCode: { select: { code: true } },
        user: { select: { id: true, profile: { select: { fullName: true, businessName: true } } } },
        payment: { select: { provider: true, providerPaymentId: true, status: true, paidAt: true } },
      },
    }),
    systemDb.promoRedemption.aggregate({ where: { ...where, status: 'redeemed' }, _count: { _all: true }, _sum: { discountPaise: true, finalPaise: true, originalPaise: true } }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      code: r.promoCode.code,
      email: r.email,
      name: r.user?.profile?.fullName ?? null,
      business: r.user?.profile?.businessName ?? null,
      plan: r.plan,
      originalPaise: r.originalPaise,
      discountPaise: r.discountPaise,
      finalPaise: r.finalPaise,
      status: r.status,
      provider: r.payment?.provider ?? (r.status === 'redeemed' ? 'manual' : null),
      providerPaymentId: r.payment?.providerPaymentId ?? null,
      createdAt: r.createdAt.toISOString(),
      redeemedAt: r.redeemedAt?.toISOString() ?? null,
    })),
    totals: { redeemed: totals._count._all, discountPaise: totals._sum.discountPaise ?? 0, revenuePaise: totals._sum.finalPaise ?? 0, listPricePaise: totals._sum.originalPaise ?? 0 },
    pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
  };
}

// ── payments ─────────────────────────────────────────────────────────

export const paymentsQuerySchema = z.object({
  status: z.enum(['created', 'paid', 'failed']).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export async function listPayments(q: z.infer<typeof paymentsQuerySchema>) {
  const where: Prisma.BillingPaymentWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.search ? { OR: [{ email: { contains: q.search.toLowerCase() } }, { providerOrderId: { contains: q.search } }, { providerPaymentId: { contains: q.search } }] } : {}),
  };
  const [total, rows, paid] = await Promise.all([
    systemDb.billingPayment.count({ where }),
    systemDb.billingPayment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { promoCode: { select: { code: true } } } }),
    systemDb.billingPayment.aggregate({ where: { status: 'paid' }, _count: { _all: true }, _sum: { amountPaise: true, discountPaise: true } }),
  ]);
  return {
    items: rows.map((p) => ({
      id: p.id,
      email: p.email,
      plan: p.plan,
      provider: p.provider,
      amountPaise: p.amountPaise,
      originalPaise: p.originalPaise,
      discountPaise: p.discountPaise,
      promoCode: p.promoCode?.code ?? null,
      orderId: p.providerOrderId,
      paymentId: p.providerPaymentId,
      status: p.status,
      method: p.method,
      failureReason: p.failureReason,
      confirmedVia: p.confirmedVia,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    totals: { paid: paid._count._all, revenuePaise: paid._sum.amountPaise ?? 0, discountPaise: paid._sum.discountPaise ?? 0 },
    pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
  };
}
