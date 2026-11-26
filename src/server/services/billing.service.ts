/**
 * Signup billing: promo codes, Razorpay checkout and payment confirmation.
 *
 * Flow
 *   1. Signup form: the customer applies a promo → `previewPromo` (no writes).
 *   2. Payment step: `startCheckout` re-checks the promo, reserves it
 *      (PromoRedemption `pending`) and creates a Razorpay order for the final
 *      amount. A 100% code activates straight away. Without Razorpay keys
 *      (dashboard or env, see payment-gateway.service) checkout is refused.
 *      Renewals (`startRenewal`, `startRenewalWithLogin`) use the same order
 *      flow; activation extends an active subscription from its end date.
 *   3. Razorpay Checkout returns → `confirmFromCheckout` checks the signature.
 *      The webhook (`handleWebhook`) confirms the same payment server-to-server,
 *      so the account is activated even if the browser closes. Whichever comes
 *      first wins; the other is a no-op.
 *
 * Every amount is computed here in paise from the plan catalogue; nothing the
 * browser sends is trusted except the plan id and the code text.
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { planById } from '@/lib/billing/plans';
import { checkPromo, normalizePromoCode, PROMO_CODE_RE, type PromoRules } from '@/lib/billing/promo';
import { verifyPassword } from '@/lib/auth';
import { createRazorpayOrder, RAZORPAY_MIN_PAISE, razorpayMode, verifyCheckoutSignature, verifyWebhookSignature } from '@/lib/billing/razorpay';
import { ForbiddenError, getLogger, NotFoundError, systemDb, UnauthenticatedError, ValidationError } from '../kernel';
import { activateAccount } from './account-activation';
import { activeRazorpay, keySecrets, webhookSecrets } from './payment-gateway.service';

/** Shown when no Razorpay keys are set in the dashboard or the server env. */
export const PAYMENTS_OFF_MESSAGE = 'Online payments are not set up yet. Please contact support to activate your account.';

const log = getLogger('billing');
/** An open checkout holds its promo use for this long. */
const PENDING_HOLD_MS = 30 * 60_000;
const SIGNUP_WINDOW_MS = 7 * 86_400_000;

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));

export function toRules(p: { code: string; discountType: string; discountValue: Prisma.Decimal; maxDiscount: Prisma.Decimal | null; plans: unknown; startsAt: Date | null; endsAt: Date | null; maxRedemptions: number | null; perUserLimit: number; isActive: boolean }): PromoRules {
  return {
    code: p.code,
    discountType: p.discountType === 'flat' ? 'flat' : 'percent',
    discountValue: Number(p.discountValue),
    maxDiscount: num(p.maxDiscount),
    plans: Array.isArray(p.plans) ? (p.plans as string[]) : [],
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    maxRedemptions: p.maxRedemptions,
    perUserLimit: p.perUserLimit,
    isActive: p.isActive,
  };
}

function planPrice(planId: string): number {
  const plan = planById(planId);
  if (!plan?.selfServe || !plan.pricePaise) throw new ValidationError('Choose a plan that can be bought online.');
  return plan.pricePaise;
}

async function usageFor(promoId: string, email: string, exceptUserId?: string) {
  const since = new Date(Date.now() - PENDING_HOLD_MS);
  const [redeemed, holding, byEmail] = await Promise.all([
    systemDb.promoRedemption.count({ where: { promoCodeId: promoId, status: 'redeemed' } }),
    systemDb.promoRedemption.count({ where: { promoCodeId: promoId, status: 'pending', createdAt: { gte: since }, ...(exceptUserId ? { NOT: { userId: exceptUserId } } : {}) } }),
    systemDb.promoRedemption.count({ where: { promoCodeId: promoId, status: 'redeemed', email: email.toLowerCase() } }),
  ]);
  return { totalUsed: redeemed + holding, usedByEmail: byEmail };
}

async function evaluate(rawCode: string, planId: string, email: string, exceptUserId?: string) {
  const code = normalizePromoCode(rawCode);
  if (!PROMO_CODE_RE.test(code)) return { promo: null, check: { ok: false as const, reason: 'Enter a valid promo code.' } };
  const promo = await systemDb.promoCode.findUnique({ where: { code } });
  if (!promo) return { promo: null, check: { ok: false as const, reason: 'This promo code does not exist.' } };
  const amountPaise = planPrice(planId);
  const check = checkPromo(toRules(promo), { plan: planId, amountPaise, usage: await usageFor(promo.id, email, exceptUserId) });
  // Razorpay cannot take less than ₹1: a near-total discount becomes ₹1, a full one is free.
  if (check.ok && check.finalPaise > 0 && check.finalPaise < RAZORPAY_MIN_PAISE) {
    return { promo, check: { ...check, discountPaise: amountPaise - RAZORPAY_MIN_PAISE, finalPaise: RAZORPAY_MIN_PAISE } };
  }
  return { promo, check };
}

// ── 1. preview on the signup form ────────────────────────────────────

export const previewSchema = z.object({
  code: z.string().trim().min(1, 'Enter a promo code.').max(40),
  plan: z.string().trim().max(40),
  email: z.string().trim().email().max(191).optional().or(z.literal('')),
});

export async function previewPromo(body: z.infer<typeof previewSchema>) {
  const { promo, check } = await evaluate(body.code, body.plan, body.email || '');
  if (!check.ok) throw new ValidationError(check.reason, { details: { field: 'promoCode' } });
  return { code: promo!.code, label: check.label, description: promo!.description, originalPaise: check.originalPaise, discountPaise: check.discountPaise, finalPaise: check.finalPaise };
}

// ── 2. checkout ──────────────────────────────────────────────────────

export const checkoutSchema = z.object({
  userId: z.string().uuid(),
  plan: z.string().trim().max(40),
  promoCode: z.string().trim().max(40).optional().or(z.literal('')),
});

/** Only new accounts that verified their email and are not active yet can check out here. */
async function signupUser(userId: string) {
  const user = await systemDb.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isVerified: true, isEmailVerified: true, createdAt: true, profile: { select: { fullName: true, phoneNumber: true } } } });
  // One message for every rejection so ids cannot be probed.
  if (!user || user.isVerified || !user.isEmailVerified || Date.now() - user.createdAt.getTime() > SIGNUP_WINDOW_MS) throw new ForbiddenError('This checkout link is no longer valid. Please sign up again or contact support.');
  return user;
}

type Payer = { id: string; email: string; profile: { fullName: string | null; phoneNumber: string | null } | null };

/**
 * Shared by signup and renewal: re-checks the promo, reserves it and creates
 * the Razorpay order. A 100% promo activates at once without Razorpay.
 */
async function createOrder(user: Payer, input: { plan: string; promoCode?: string; kind: 'signup' | 'renewal' }) {
  const originalPaise = planPrice(input.plan);
  let promoId: string | null = null;
  let discountPaise = 0;
  if (input.promoCode) {
    const { promo, check } = await evaluate(input.promoCode, input.plan, user.email, user.id);
    if (!check.ok) throw new ValidationError(check.reason, { details: { field: 'promoCode' } });
    promoId = promo!.id;
    discountPaise = check.discountPaise;
  }
  const finalPaise = originalPaise - discountPaise;
  // Checked before any write so a missing gateway leaves nothing half-done.
  const config = finalPaise > 0 ? await activeRazorpay() : null;
  if (finalPaise > 0 && !config) throw new ValidationError(PAYMENTS_OFF_MESSAGE);

  // A new checkout replaces any earlier unpaid one from this user.
  await systemDb.promoRedemption.updateMany({ where: { userId: user.id, status: 'pending' }, data: { status: 'released' } });
  if (input.kind === 'signup') await systemDb.user.update({ where: { id: user.id }, data: { selectedPlan: input.plan } });

  const reserve = (paymentId: string, status: 'pending' | 'redeemed') =>
    promoId
      ? systemDb.promoRedemption.create({
          data: { promoCodeId: promoId, userId: user.id, email: user.email.toLowerCase(), plan: input.plan, originalPaise, discountPaise, finalPaise, status, paymentId, redeemedAt: status === 'redeemed' ? new Date() : null },
        })
      : Promise.resolve(null);

  // Fully covered by the promo: no payment needed.
  if (finalPaise === 0 || !config) {
    const payment = await systemDb.billingPayment.create({
      data: { userId: user.id, email: user.email, plan: input.plan, provider: 'free', amountPaise: 0, originalPaise, discountPaise, promoCodeId: promoId, status: 'paid', confirmedVia: 'promo', paidAt: new Date() },
    });
    await reserve(payment.id, 'redeemed');
    if (promoId) await systemDb.promoCode.update({ where: { id: promoId }, data: { timesRedeemed: { increment: 1 } } });
    await activateAccount(user.id, { plan: input.plan, reason: 'free' });
    return { mode: 'free' as const, originalPaise, discountPaise, finalPaise: 0 };
  }

  const payment = await systemDb.billingPayment.create({
    data: { userId: user.id, email: user.email, plan: input.plan, amountPaise: finalPaise, originalPaise, discountPaise, promoCodeId: promoId },
  });
  try {
    const order = await createRazorpayOrder(config, {
      amountPaise: finalPaise,
      receipt: `cnx_${payment.id.slice(0, 30)}`,
      notes: { paymentId: payment.id, userId: user.id, plan: input.plan, kind: input.kind, ...(promoId ? { promo: normalizePromoCode(input.promoCode ?? '') } : {}) },
    });
    await systemDb.billingPayment.update({ where: { id: payment.id }, data: { providerOrderId: order.id } });
    await reserve(payment.id, 'pending');
    const plan = planById(input.plan)!;
    return {
      mode: 'razorpay' as const,
      keyId: config.keyId,
      test: razorpayMode(config.keyId) === 'test',
      orderId: order.id,
      originalPaise,
      discountPaise,
      finalPaise,
      currency: 'INR',
      description: `${plan.name} plan · ${input.kind === 'renewal' ? '1 month renewal' : '1 month'}`,
      prefill: { name: user.profile?.fullName ?? '', email: user.email, contact: user.profile?.phoneNumber ?? '' },
    };
  } catch (error) {
    await systemDb.billingPayment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: (error as Error).message.slice(0, 490) } });
    log.error('razorpay order failed', { userId: user.id, kind: input.kind, err: error });
    throw new ValidationError('We could not start the payment. Please try again in a minute.');
  }
}

export async function startCheckout(body: z.infer<typeof checkoutSchema>) {
  const user = await signupUser(body.userId);
  return createOrder(user, { plan: body.plan, promoCode: body.promoCode || undefined, kind: 'signup' });
}

// ── 2b. renewal ──────────────────────────────────────────────────────

export const renewalSchema = z.object({
  /** Defaults to the account's current plan. */
  plan: z.string().trim().max(40).optional().or(z.literal('')),
  promoCode: z.string().trim().max(40).optional().or(z.literal('')),
});

export const renewalLoginSchema = renewalSchema.extend({
  email: z.string().trim().email('Enter a valid email.').max(191),
  password: z.string().min(1, 'Enter your password.').max(200),
});

const RENEW_SELECT = {
  id: true,
  email: true,
  passwordHash: true,
  isVerified: true,
  isEmailVerified: true,
  selectedPlan: true,
  subscriptionExpiresAt: true,
  profile: { select: { fullName: true, phoneNumber: true } },
} as const;

type RenewUser = Prisma.UserGetPayload<{ select: typeof RENEW_SELECT }>;

/**
 * Who may renew online: an active account (extends from its end date) or one
 * whose subscription ran out. New accounts waiting for their first payment use
 * signup checkout; suspended accounts (inactive with time left) must talk to us.
 */
export function canRenew(user: Pick<RenewUser, 'isVerified' | 'isEmailVerified' | 'subscriptionExpiresAt'>, now = new Date()): boolean {
  if (!user.isEmailVerified) return false;
  if (user.isVerified) return true;
  return Boolean(user.subscriptionExpiresAt && user.subscriptionExpiresAt < now);
}

function renewalPlan(user: RenewUser, requested?: string) {
  const id = requested || user.selectedPlan || '';
  const plan = planById(id);
  if (!plan?.selfServe || !plan.pricePaise) {
    throw new ValidationError(requested ? 'Choose a plan that can be bought online.' : 'Your plan is renewed by our team. Please contact support.', { details: { field: 'plan' } });
  }
  return plan.id;
}

async function renew(user: RenewUser, body: z.infer<typeof renewalSchema>) {
  if (!canRenew(user)) throw new ForbiddenError('This account cannot be renewed online. Please contact support.');
  return createOrder(user, { plan: renewalPlan(user, body.plan || undefined), promoCode: body.promoCode || undefined, kind: 'renewal' });
}

/** Logged-in renewal from the Subscription page. */
export async function startRenewal(userId: string, body: z.infer<typeof renewalSchema>) {
  const user = await systemDb.user.findUnique({ where: { id: userId }, select: RENEW_SELECT });
  if (!user) throw new NotFoundError('Account');
  return renew(user, body);
}

/**
 * Renewal from the login page: an expired account cannot sign in, so the
 * password is checked here instead. Same message for unknown email and wrong
 * password.
 */
export async function startRenewalWithLogin(body: z.infer<typeof renewalLoginSchema>) {
  const user = await systemDb.user.findUnique({ where: { email: body.email }, select: RENEW_SELECT });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw new UnauthenticatedError('Incorrect email or password.');
  return renew(user, body);
}

// ── 3. confirmation ──────────────────────────────────────────────────

/** Marks the payment paid once, redeems its promo and activates the account. */
export async function confirmPayment(input: { orderId: string; paymentId: string; via: 'checkout' | 'webhook'; amountPaise?: number; method?: string | null }) {
  const payment = await systemDb.billingPayment.findUnique({ where: { providerOrderId: input.orderId } });
  if (!payment) throw new NotFoundError('Payment');
  if (payment.status === 'paid') return { activated: false, alreadyPaid: true, payment };
  if (input.amountPaise != null && input.amountPaise !== payment.amountPaise) {
    log.error('payment amount mismatch', { orderId: input.orderId, expected: payment.amountPaise, got: input.amountPaise });
    throw new ValidationError('Payment amount does not match the order.');
  }
  // The status guard makes checkout + webhook arriving together activate only once.
  const won = await systemDb.billingPayment.updateMany({
    where: { id: payment.id, status: { not: 'paid' } },
    data: { status: 'paid', providerPaymentId: input.paymentId, paidAt: new Date(), confirmedVia: input.via, method: input.method?.slice(0, 30) ?? null, failureReason: null },
  });
  if (!won.count) return { activated: false, alreadyPaid: true, payment };

  const redemption = await systemDb.promoRedemption.findUnique({ where: { paymentId: payment.id } });
  if (redemption && redemption.status !== 'redeemed') {
    await systemDb.promoRedemption.update({ where: { id: redemption.id }, data: { status: 'redeemed', redeemedAt: new Date() } });
    await systemDb.promoCode.update({ where: { id: redemption.promoCodeId }, data: { timesRedeemed: { increment: 1 } } });
  }
  if (payment.userId) await activateAccount(payment.userId, { plan: payment.plan, reason: 'payment' });
  log.info('payment confirmed', { orderId: input.orderId, via: input.via, amount: payment.amountPaise });
  return { activated: true, alreadyPaid: false, payment };
}

export const verifySchema = z.object({
  orderId: z.string().trim().min(5).max(64),
  paymentId: z.string().trim().min(5).max(64),
  signature: z.string().trim().length(64),
});

export async function confirmFromCheckout(body: z.infer<typeof verifySchema>) {
  // The order may have been created with the dashboard key or the env key.
  const secrets = await keySecrets();
  if (!secrets.length) throw new ValidationError(PAYMENTS_OFF_MESSAGE);
  if (!secrets.some((secret) => verifyCheckoutSignature(body, secret))) {
    log.warn('checkout signature rejected', { orderId: body.orderId });
    throw new ValidationError('We could not verify this payment. If money was deducted, it will be confirmed automatically within a few minutes.');
  }
  const res = await confirmPayment({ orderId: body.orderId, paymentId: body.paymentId, via: 'checkout' });
  return { paid: true, activated: res.activated || res.alreadyPaid };
}

/** Payment state for the signup page to poll while the webhook catches up. */
export async function paymentStatus(orderId: string) {
  const p = await systemDb.billingPayment.findUnique({ where: { providerOrderId: orderId }, select: { status: true, failureReason: true } });
  if (!p) throw new NotFoundError('Payment');
  return { status: p.status, failureReason: p.status === 'failed' ? p.failureReason : null };
}

// ── webhook ──────────────────────────────────────────────────────────

interface WebhookPayment {
  id: string;
  order_id: string | null;
  amount: number;
  method?: string;
  status?: string;
  error_description?: string | null;
}

export async function handleWebhook(rawBody: string, headers: { signature: string | null; eventId: string | null }) {
  const secrets = await webhookSecrets();
  if (!secrets.length) {
    log.error('razorpay webhook received but no webhook secret is set (Super Admin → Integrations or RAZORPAY_WEBHOOK_SECRET)');
    return { status: 503, body: { error: 'Webhook not configured' } };
  }
  if (!secrets.some((secret) => verifyWebhookSignature(rawBody, headers.signature, secret))) {
    log.warn('razorpay webhook signature rejected');
    return { status: 400, body: { error: 'Invalid signature' } };
  }
  let event: { event?: string; payload?: { payment?: { entity?: WebhookPayment } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } };
  }
  const name = String(event.event ?? '');
  // Razorpay retries deliveries; each event id is handled once.
  if (headers.eventId) {
    try {
      await systemDb.billingWebhookEvent.create({ data: { id: headers.eventId.slice(0, 64), event: name.slice(0, 60) } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { status: 200, body: { ok: true, duplicate: true } };
      throw e;
    }
  }
  const entity = event.payload?.payment?.entity;
  try {
    if ((name === 'payment.captured' || name === 'order.paid') && entity?.order_id) {
      const known = await systemDb.billingPayment.findUnique({ where: { providerOrderId: entity.order_id }, select: { id: true } });
      if (known) await confirmPayment({ orderId: entity.order_id, paymentId: entity.id, via: 'webhook', amountPaise: entity.amount, method: entity.method ?? null });
    } else if (name === 'payment.failed' && entity?.order_id) {
      await systemDb.billingPayment.updateMany({
        where: { providerOrderId: entity.order_id, status: 'created' },
        data: { status: 'failed', failureReason: (entity.error_description ?? 'Payment failed').slice(0, 490), method: entity.method?.slice(0, 30) ?? null },
      });
    }
  } catch (error) {
    // Let Razorpay retry: forget this delivery so the retry is processed.
    if (headers.eventId) await systemDb.billingWebhookEvent.delete({ where: { id: headers.eventId.slice(0, 64) } }).catch(() => undefined);
    log.error('razorpay webhook processing failed', { event: name, err: error });
    return { status: 500, body: { error: 'Processing failed' } };
  }
  return { status: 200, body: { ok: true } };
}
