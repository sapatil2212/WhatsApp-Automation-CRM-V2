/**
 * Promo code rules (pure, no DB). The server re-checks everything when it
 * creates the payment, so a code applied on the signup form is only a preview.
 */

export const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

export interface PromoRules {
  code: string;
  discountType: 'percent' | 'flat';
  /** Percent (1-100) or flat rupees. */
  discountValue: number;
  /** Cap for percent discounts, in rupees. */
  maxDiscount: number | null;
  /** Plan ids; empty = every plan. */
  plans: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  isActive: boolean;
}

export interface PromoUsage {
  /** Paid uses plus payments still open, across everyone. */
  totalUsed: number;
  /** Paid uses by this email. */
  usedByEmail: number;
}

export type PromoCheck =
  | { ok: true; originalPaise: number; discountPaise: number; finalPaise: number; label: string }
  | { ok: false; reason: string };

export const normalizePromoCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '');

/** Discount in paise for an amount, never more than the amount. */
export function discountFor(rules: Pick<PromoRules, 'discountType' | 'discountValue' | 'maxDiscount'>, amountPaise: number): number {
  const raw =
    rules.discountType === 'percent'
      ? Math.round((amountPaise * Math.min(100, Math.max(0, rules.discountValue))) / 100)
      : Math.round(rules.discountValue * 100);
  const capped = rules.discountType === 'percent' && rules.maxDiscount != null ? Math.min(raw, Math.round(rules.maxDiscount * 100)) : raw;
  return Math.max(0, Math.min(amountPaise, capped));
}

export function promoLabel(rules: Pick<PromoRules, 'discountType' | 'discountValue' | 'maxDiscount'>): string {
  if (rules.discountType === 'percent') {
    const pct = `${Number(rules.discountValue.toFixed(2))}% off`;
    return rules.maxDiscount != null ? `${pct} (up to ₹${rules.maxDiscount.toLocaleString('en-IN')})` : pct;
  }
  return `₹${rules.discountValue.toLocaleString('en-IN')} off`;
}

/** Whether a code can be used now, for this plan and email, and what it takes off. */
export function checkPromo(rules: PromoRules, input: { plan: string; amountPaise: number; usage: PromoUsage; now?: Date }): PromoCheck {
  const now = input.now ?? new Date();
  if (!rules.isActive) return { ok: false, reason: 'This promo code is no longer active.' };
  if (rules.startsAt && now < rules.startsAt) return { ok: false, reason: 'This promo code is not active yet.' };
  if (rules.endsAt && now > rules.endsAt) return { ok: false, reason: 'This promo code has expired.' };
  if (rules.plans.length && !rules.plans.includes(input.plan)) return { ok: false, reason: 'This promo code does not apply to the selected plan.' };
  if (rules.maxRedemptions != null && input.usage.totalUsed >= rules.maxRedemptions) return { ok: false, reason: 'This promo code has reached its usage limit.' };
  if (input.usage.usedByEmail >= rules.perUserLimit) return { ok: false, reason: 'You have already used this promo code.' };
  const discountPaise = discountFor(rules, input.amountPaise);
  if (discountPaise <= 0) return { ok: false, reason: 'This promo code gives no discount on the selected plan.' };
  return { ok: true, originalPaise: input.amountPaise, discountPaise, finalPaise: input.amountPaise - discountPaise, label: promoLabel(rules) };
}
