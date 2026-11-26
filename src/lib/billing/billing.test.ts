import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { formatPaise, planById } from './plans';
import { checkPromo, discountFor, normalizePromoCode, PROMO_CODE_RE, promoLabel, type PromoRules } from './promo';
import { verifyCheckoutSignature, verifyWebhookSignature } from './razorpay';

const rules = (over: Partial<PromoRules> = {}): PromoRules => ({
  code: 'WELCOME20',
  discountType: 'percent',
  discountValue: 20,
  maxDiscount: null,
  plans: [],
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  perUserLimit: 1,
  isActive: true,
  ...over,
});
const fresh = { totalUsed: 0, usedByEmail: 0 };

describe('plan prices', () => {
  it('charges the listed monthly price in paise', () => {
    expect(planById('starter')?.pricePaise).toBe(99_900);
    expect(planById('managed')?.pricePaise).toBe(199_900);
    expect(planById('custom')?.pricePaise).toBeNull();
  });
  it('formats rupees', () => {
    expect(formatPaise(99_900)).toBe('₹999');
    expect(formatPaise(159_920)).toBe('₹1,599.20');
    expect(formatPaise(0)).toBe('₹0');
  });
});

describe('promo discounts', () => {
  it('takes a percentage, with an optional cap', () => {
    expect(discountFor(rules(), 199_900)).toBe(39_980);
    expect(discountFor(rules({ maxDiscount: 300 }), 199_900)).toBe(30_000);
  });
  it('takes a flat amount and never more than the price', () => {
    expect(discountFor(rules({ discountType: 'flat', discountValue: 500 }), 99_900)).toBe(50_000);
    expect(discountFor(rules({ discountType: 'flat', discountValue: 5000 }), 99_900)).toBe(99_900);
    expect(discountFor(rules({ discountValue: 150 }), 99_900)).toBe(99_900);
  });
  it('describes the discount', () => {
    expect(promoLabel(rules())).toBe('20% off');
    expect(promoLabel(rules({ maxDiscount: 300 }))).toBe('20% off (up to ₹300)');
    expect(promoLabel(rules({ discountType: 'flat', discountValue: 500 }))).toBe('₹500 off');
  });
  it('normalises and validates code text', () => {
    expect(normalizePromoCode(' welcome 20 ')).toBe('WELCOME20');
    expect(PROMO_CODE_RE.test('WELCOME20')).toBe(true);
    expect(PROMO_CODE_RE.test('AB')).toBe(false);
    expect(PROMO_CODE_RE.test('NO SPACE')).toBe(false);
  });
});

describe('promo eligibility', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  const ok = (r: PromoRules, usage = fresh, plan = 'starter') => checkPromo(r, { plan, amountPaise: planById(plan)!.pricePaise!, usage, now });

  it('applies a valid code and returns the final amount', () => {
    expect(ok(rules())).toMatchObject({ ok: true, originalPaise: 99_900, discountPaise: 19_980, finalPaise: 79_920 });
  });
  it.each([
    ['paused', rules({ isActive: false }), fresh, /no longer active/],
    ['not started', rules({ startsAt: new Date('2026-12-05') }), fresh, /not active yet/],
    ['expired', rules({ endsAt: new Date('2026-11-30') }), fresh, /expired/],
    ['wrong plan', rules({ plans: ['managed'] }), fresh, /does not apply/],
    ['used up', rules({ maxRedemptions: 10 }), { totalUsed: 10, usedByEmail: 0 }, /usage limit/],
    ['already used by this email', rules(), { totalUsed: 1, usedByEmail: 1 }, /already used/],
  ])('rejects a code that is %s', (_label, r, usage, reason) => {
    const res = ok(r, usage);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toMatch(reason);
  });
  it('allows several uses per email when the limit says so', () => {
    expect(ok(rules({ perUserLimit: 3 }), { totalUsed: 2, usedByEmail: 2 }).ok).toBe(true);
  });
});

describe('razorpay signatures', () => {
  const secret = 'test_secret_123';
  const sign = (data: string, key = secret) => createHmac('sha256', key).update(data).digest('hex');

  it('accepts a genuine checkout signature and rejects tampering', () => {
    const sig = sign('order_ABC|pay_XYZ');
    expect(verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: sig }, secret)).toBe(true);
    expect(verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_OTHER', signature: sig }, secret)).toBe(false);
    expect(verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: sign('order_ABC|pay_XYZ', 'wrong') }, secret)).toBe(false);
    expect(verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: 'not-hex' }, secret)).toBe(false);
  });

  it('checks the webhook signature over the exact raw body', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 79920 } } } });
    expect(verifyWebhookSignature(body, sign(body), secret)).toBe(true);
    expect(verifyWebhookSignature(body.replace('79920', '1'), sign(body), secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });
});
