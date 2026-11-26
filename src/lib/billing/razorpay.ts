/**
 * Razorpay REST client (orders) and signature checks. Server-only.
 *
 * Keys come from Super Admin → Integrations or, as a fallback, the
 * environment (.env.local / server env):
 *   RAZORPAY_KEY_ID         rzp_test_… or rzp_live_…  (public; sent to Checkout)
 *   RAZORPAY_KEY_SECRET     secret for that key        (never sent to the browser)
 *   RAZORPAY_WEBHOOK_SECRET secret set on the webhook in the Razorpay dashboard
 *
 * Docs: orders https://razorpay.com/docs/api/orders/ ,
 * checkout signature https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/ ,
 * webhooks https://razorpay.com/docs/webhooks/validate-test/
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const RAZORPAY_API = 'https://api.razorpay.com/v1';
/** Razorpay's minimum order amount (₹1). */
export const RAZORPAY_MIN_PAISE = 100;

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
}

/**
 * Keys from the server env only. Payments use `activeRazorpay()` in
 * payment-gateway.service, which prefers keys saved in Super Admin → Integrations.
 */
export function razorpayEnvConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null };
}

export const razorpayMode = (keyId: string) => (keyId.startsWith('rzp_live_') ? 'live' : 'test');

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

/** Checkout handler result: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }, keySecret: string): boolean {
  if (!input.orderId || !input.paymentId || !/^[a-f0-9]{64}$/i.test(input.signature)) return false;
  return safeEqualHex(hmac(keySecret, `${input.orderId}|${input.paymentId}`), input.signature.toLowerCase());
}

/** Webhook: HMAC_SHA256(raw request body, webhook secret) in `x-razorpay-signature`. */
export function verifyWebhookSignature(rawBody: string | Buffer, signature: string | null, webhookSecret: string): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return safeEqualHex(hmac(webhookSecret, rawBody), signature.toLowerCase());
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string | null;
}

export async function createRazorpayOrder(
  config: RazorpayConfig,
  input: { amountPaise: number; receipt: string; notes: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
): Promise<RazorpayOrder> {
  const res = await fetchImpl(`${RAZORPAY_API}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify({ amount: input.amountPaise, currency: 'INR', receipt: input.receipt.slice(0, 40), notes: input.notes, payment_capture: 1 }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as (RazorpayOrder & { error?: { description?: string } }) | null;
  if (!res.ok || !body?.id) {
    throw new Error(body?.error?.description ? `Razorpay: ${body.error.description}` : `Razorpay order failed (HTTP ${res.status}).`);
  }
  return body;
}
