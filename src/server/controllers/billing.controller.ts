/**
 * Billing, promo codes and marketing offers.
 *
 * Public (signup / home page)
 *   POST /api/billing/promo/validate          preview a promo on the signup form
 *   POST /api/billing/checkout                start payment for a new account
 *   POST /api/billing/renewal                 renew while signed in (Subscription page)
 *   POST /api/billing/renewal/login           renew an expired account (email + password)
 *   POST /api/billing/razorpay/verify         Razorpay Checkout success callback
 *   GET  /api/billing/razorpay/status         poll an order while the webhook catches up
 *   POST /api/billing/razorpay/webhook        Razorpay → server (signature checked)
 *   GET  /api/public/offers                   live home-page pop-ups
 *   POST /api/public/offers/[id]/event        view / click / dismiss counters
 *
 * Super admin
 *   GET/POST          /api/super-admin/offers
 *   PATCH/DELETE      /api/super-admin/offers/[id]
 *   GET/POST          /api/super-admin/promo-codes
 *   PATCH/DELETE      /api/super-admin/promo-codes/[id]
 *   GET               /api/super-admin/promo-codes/history
 *   GET               /api/super-admin/payments
 *   GET/PUT           /api/super-admin/integrations/razorpay
 *   POST              /api/super-admin/integrations/razorpay/test
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createHandler, createRawHandler, requireSuperAdmin } from '../kernel';
import {
  checkoutSchema,
  confirmFromCheckout,
  handleWebhook,
  paymentStatus,
  previewPromo,
  previewSchema,
  renewalLoginSchema,
  renewalSchema,
  startCheckout,
  startRenewal,
  startRenewalWithLogin,
  verifySchema,
} from '../services/billing.service';
import { gatewaySaveSchema, gatewayStatus, gatewayTestSchema, saveGateway, testGateway } from '../services/payment-gateway.service';
import {
  createOffer,
  createPromoCode,
  deleteOffer,
  deletePromoCode,
  historyQuerySchema,
  listOffers,
  listPayments,
  listPromoCodes,
  offerEventSchema,
  offerSchema,
  paymentsQuerySchema,
  promoHistory,
  promoSchema,
  promoUpdateSchema,
  publicOffers,
  recordOfferEvent,
  updateOffer,
  updatePromoCode,
} from '../services/platform-offers.service';

const idParams = z.object({ id: z.string().uuid() });
const loose = z.any();

export const billingController = {
  // ── public ──
  promoValidate: createHandler({ operation: 'billing.promo.validate', auth: 'public', body: previewSchema, response: loose, rateLimit: { limit: 20, windowMs: 60_000 }, handle: ({ body }) => previewPromo(body) }),
  checkout: createHandler({ operation: 'billing.checkout', auth: 'public', body: checkoutSchema, response: loose, rateLimit: { limit: 10, windowMs: 60_000 }, handle: ({ body }) => startCheckout(body) }),
  renewal: createHandler({ operation: 'billing.renewal', auth: 'tenant', body: renewalSchema, response: loose, rateLimit: { limit: 10, windowMs: 60_000 }, handle: ({ ctx, body }) => startRenewal(ctx.userId, body) }),
  renewalLogin: createHandler({
    operation: 'billing.renewal.login',
    auth: 'public',
    body: renewalLoginSchema,
    response: loose,
    // Checks a password, so limit per IP like the login route.
    rateLimit: { limit: 8, windowMs: 60_000, key: ({ request }) => `renewal-login:${request.headers.get('x-forwarded-for') ?? 'anon'}` },
    handle: ({ body }) => startRenewalWithLogin(body),
  }),
  verify: createHandler({ operation: 'billing.razorpay.verify', auth: 'public', body: verifySchema, response: loose, rateLimit: { limit: 20, windowMs: 60_000 }, handle: ({ body }) => confirmFromCheckout(body) }),
  status: createHandler({
    operation: 'billing.razorpay.status',
    auth: 'public',
    query: z.object({ orderId: z.string().trim().min(5).max(64) }),
    response: loose,
    rateLimit: { limit: 60, windowMs: 60_000 },
    handle: ({ query }) => paymentStatus(query.orderId),
  }),
  webhook: createRawHandler({
    operation: 'billing.razorpay.webhook',
    auth: 'public',
    async handle({ request }) {
      // The signature covers the exact bytes, so read the raw body before any parsing.
      const raw = await request.text();
      const res = await handleWebhook(raw, { signature: request.headers.get('x-razorpay-signature'), eventId: request.headers.get('x-razorpay-event-id') });
      return NextResponse.json(res.body, { status: res.status });
    },
  }),
  publicOffers: createHandler({ operation: 'offers.public', auth: 'public', response: loose, rateLimit: { limit: 120, windowMs: 60_000 }, handle: () => publicOffers() }),
  offerEvent: createHandler({ operation: 'offers.event', auth: 'public', params: idParams, body: offerEventSchema, response: loose, rateLimit: { limit: 60, windowMs: 60_000 }, handle: ({ params, body }) => recordOfferEvent(params.id, body.type) }),

  // ── super admin ──
  offers: createHandler({ operation: 'admin.offers.list', auth: 'superAdmin', response: loose, handle: () => listOffers() }),
  offerCreate: createHandler({ operation: 'admin.offers.create', auth: 'superAdmin', body: offerSchema, response: loose, status: 201, message: 'Offer saved.', handle: ({ body }) => createOffer(body) }),
  offerUpdate: createHandler({ operation: 'admin.offers.update', auth: 'superAdmin', params: idParams, body: offerSchema, response: loose, message: 'Offer saved.', handle: ({ params, body }) => updateOffer(params.id, body) }),
  offerToggle: createHandler({
    operation: 'admin.offers.toggle',
    auth: 'superAdmin',
    params: idParams,
    body: z.object({ isActive: z.boolean() }),
    response: loose,
    handle: ({ params, body }) => updateOffer(params.id, { isActive: body.isActive }),
  }),
  offerDelete: createHandler({ operation: 'admin.offers.delete', auth: 'superAdmin', params: idParams, response: loose, message: 'Offer deleted.', handle: ({ params }) => deleteOffer(params.id) }),

  promos: createHandler({ operation: 'admin.promos.list', auth: 'superAdmin', response: loose, handle: () => listPromoCodes() }),
  promoCreate: createHandler({ operation: 'admin.promos.create', auth: 'superAdmin', body: promoSchema, response: loose, status: 201, message: 'Promo code created.', handle: ({ body }) => createPromoCode(body) }),
  promoUpdate: createHandler({ operation: 'admin.promos.update', auth: 'superAdmin', params: idParams, body: promoUpdateSchema, response: loose, message: 'Promo code saved.', handle: ({ params, body }) => updatePromoCode(params.id, body) }),
  promoDelete: createHandler({ operation: 'admin.promos.delete', auth: 'superAdmin', params: idParams, response: loose, message: 'Promo code deleted.', handle: ({ params }) => deletePromoCode(params.id) }),
  promoHistory: createHandler({ operation: 'admin.promos.history', auth: 'superAdmin', query: historyQuerySchema, response: loose, handle: ({ query }) => promoHistory(query) }),
  payments: createHandler({
    operation: 'admin.payments.list',
    auth: 'superAdmin',
    query: paymentsQuerySchema,
    response: loose,
    async handle({ query }) {
      const [list, gateway] = await Promise.all([listPayments(query), gatewayStatus()]);
      return {
        ...list,
        razorpay: {
          configured: Boolean(gateway.active),
          source: gateway.active?.source ?? null,
          mode: gateway.active?.mode ?? null,
          webhookSecretSet: Boolean(gateway.active?.webhookSecretSet),
          webhookUrl: gateway.webhookUrl,
          lastWebhook: gateway.lastWebhook,
        },
      };
    },
  }),

  // ── integrations (Razorpay keys) ──
  gateway: createHandler({ operation: 'admin.integrations.razorpay.get', auth: 'superAdmin', response: loose, handle: () => gatewayStatus() }),
  gatewaySave: createHandler({
    operation: 'admin.integrations.razorpay.save',
    auth: 'superAdmin',
    body: gatewaySaveSchema,
    response: loose,
    message: 'Razorpay settings saved.',
    async handle({ body }) {
      const admin = await requireSuperAdmin();
      return saveGateway(body, admin.email);
    },
  }),
  gatewayTest: createHandler({
    operation: 'admin.integrations.razorpay.test',
    auth: 'superAdmin',
    body: gatewayTestSchema,
    response: loose,
    rateLimit: { limit: 10, windowMs: 60_000 },
    handle: ({ body }) => testGateway(body),
  }),
};
