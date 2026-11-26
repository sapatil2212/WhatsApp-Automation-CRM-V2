/**
 * Turns on a paid account: marks the user verified, starts or extends the
 * subscription by one month, activates the tenant on its plan, marks any
 * promo use as redeemed and sends the welcome email.
 *
 * Shared by manual approval (super admin), Razorpay checkout and the Razorpay
 * webhook. Safe to call twice for the same payment: callers only activate once
 * per payment, and an already-active account is extended from its end date.
 */

import { sendSystemEmail } from '@/lib/email/smtp';
import { emailButton, emailDivider, emailHeading, emailLayout, emailSubtitle, emailText, emailTokens } from '@/lib/email/template';
import { getLogger, systemDb } from '../kernel';

const log = getLogger('account-activation');

export async function activateAccount(userId: string, opts: { plan?: string | null; reason: 'manual' | 'payment' | 'free' }) {
  const user = await systemDb.user.findUnique({ where: { id: userId }, include: { profile: true, tenantsOwned: { select: { id: true } } } });
  if (!user) throw new Error('User not found.');

  const now = new Date();
  // An active subscription is extended from its end date, otherwise it starts today.
  const base = user.isVerified && user.subscriptionExpiresAt && user.subscriptionExpiresAt > now ? new Date(user.subscriptionExpiresAt) : now;
  const subscriptionExpiresAt = new Date(base);
  subscriptionExpiresAt.setMonth(subscriptionExpiresAt.getMonth() + 1);
  const plan = opts.plan || user.selectedPlan || 'starter';
  const firstActivation = !user.isVerified;

  await systemDb.user.update({ where: { id: userId }, data: { isVerified: true, subscriptionExpiresAt, selectedPlan: plan } });
  if (user.tenantsOwned[0]) await systemDb.tenant.update({ where: { id: user.tenantsOwned[0].id }, data: { plan, isActive: true } });

  // Manual (UPI) signups reserve the promo without a payment row; count them as used now.
  const pending = await systemDb.promoRedemption.findMany({ where: { userId, status: 'pending', paymentId: null }, select: { id: true, promoCodeId: true } });
  for (const r of pending) {
    const done = await systemDb.promoRedemption.updateMany({ where: { id: r.id, status: 'pending' }, data: { status: 'redeemed', redeemedAt: now } });
    if (done.count) await systemDb.promoCode.update({ where: { id: r.promoCodeId }, data: { timesRedeemed: { increment: 1 } } });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const dashboardUrl = `${siteUrl}/dashboard`;
  const fullName = user.profile?.fullName || 'Valued Partner';
  const until = subscriptionExpiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const intro =
    opts.reason === 'manual'
      ? 'Your payment has been confirmed and your 1-month subscription has started.'
      : opts.reason === 'free'
        ? 'Your promo code covered the full amount, so your 1-month subscription has started.'
        : firstActivation
          ? 'We received your payment and your 1-month subscription has started.'
          : 'We received your payment and your subscription has been extended by one month.';

  sendSystemEmail({
    to: user.email,
    subject: firstActivation ? '🎉 Your ChatNexGen workspace is active' : '✅ ChatNexGen subscription renewed',
    text: `Hi ${fullName}, ${intro} Active until ${until}. Log in: ${dashboardUrl}`,
    html: emailLayout({
      title: firstActivation ? 'Your ChatNexGen account is active' : 'Your ChatNexGen subscription is renewed',
      preview: `Active until ${until}.`,
      contentHtml:
        emailHeading(firstActivation ? 'Account activated 🎉' : 'Subscription renewed ✅') +
        emailSubtitle(`Welcome to ChatNexGen, ${fullName}!`) +
        emailDivider() +
        emailText(`${intro} Your workspace is ready to use.`) +
        emailText(`Subscription active until <strong>${until}</strong>.`, { size: 12, color: emailTokens.muted }) +
        emailButton(dashboardUrl, 'Log in to dashboard'),
    }),
  }).catch((e: unknown) => log.warn('activation email failed', { userId, err: e }));

  log.info('account activated', { userId, plan, reason: opts.reason, until: subscriptionExpiresAt.toISOString() });
  return { subscriptionExpiresAt, plan, firstActivation };
}
