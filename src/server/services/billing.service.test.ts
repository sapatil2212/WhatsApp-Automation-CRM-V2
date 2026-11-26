import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  promoCode: { findUnique: vi.fn(), update: vi.fn() },
  promoRedemption: { count: vi.fn(), updateMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  billingPayment: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  billingWebhookEvent: { create: vi.fn(), delete: vi.fn() },
}));
const activate = vi.hoisted(() => vi.fn(async () => ({ subscriptionExpiresAt: new Date(), plan: 'starter', firstActivation: true })));
type Gateway = { keyId: string; keySecret: string; webhookSecret: string | null; source: 'dashboard' | 'env' } | null;
const gateway = vi.hoisted(() => ({
  activeRazorpay: vi.fn(async (): Promise<Gateway> => null),
  keySecrets: vi.fn(async (): Promise<string[]> => []),
  webhookSecrets: vi.fn(async (): Promise<string[]> => []),
}));
const passwordOk = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../kernel', async (orig) => ({ ...(await orig<typeof import('../kernel')>()), systemDb: db }));
vi.mock('./account-activation', () => ({ activateAccount: activate }));
vi.mock('./payment-gateway.service', () => gateway);
vi.mock('@/lib/auth', () => ({ verifyPassword: passwordOk }));

import { canRenew, confirmFromCheckout, confirmPayment, handleWebhook, startCheckout, startRenewal, startRenewalWithLogin } from './billing.service';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'asha@example.com', isVerified: false, isEmailVerified: true, createdAt: new Date(), profile: { fullName: 'Asha', phoneNumber: '9876543210' } };
const PROMO = { id: 'promo-1', code: 'FREE100', discountType: 'percent', discountValue: 100, maxDiscount: null, plans: [], startsAt: null, endsAt: null, maxRedemptions: null, perUserLimit: 1, isActive: true, description: null };
const DASH: Gateway = { keyId: 'rzp_test_dash1234', keySecret: 'dash-secret', webhookSecret: 'dash-whsec', source: 'dashboard' };
const orderFetch = () =>
  vi.fn(async () => new Response(JSON.stringify({ id: 'order_abc', amount: 99_900, currency: 'INR', status: 'created', receipt: 'r' }), { status: 200 }));

beforeEach(() => {
  vi.clearAllMocks();
  gateway.activeRazorpay.mockResolvedValue(null);
  gateway.keySecrets.mockResolvedValue([]);
  gateway.webhookSecrets.mockResolvedValue([]);
  passwordOk.mockResolvedValue(true);
  db.user.findUnique.mockResolvedValue(USER);
  db.promoRedemption.count.mockResolvedValue(0);
  db.promoRedemption.updateMany.mockResolvedValue({ count: 0 });
  db.billingPayment.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'pay-row-1', ...data }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startCheckout', () => {
  it('refuses accounts that are already active or unverified, with one message', async () => {
    db.user.findUnique.mockResolvedValueOnce({ ...USER, isVerified: true });
    await expect(startCheckout({ userId: USER.id, plan: 'starter' })).rejects.toThrow(/no longer valid/);
    db.user.findUnique.mockResolvedValueOnce({ ...USER, isEmailVerified: false });
    await expect(startCheckout({ userId: USER.id, plan: 'starter' })).rejects.toThrow(/no longer valid/);
  });

  it('refuses quoted plans', async () => {
    await expect(startCheckout({ userId: USER.id, plan: 'custom' })).rejects.toThrow(/plan that can be bought online/);
  });

  it('refuses to start a paid checkout when Razorpay is not set up, without writing anything', async () => {
    await expect(startCheckout({ userId: USER.id, plan: 'managed' })).rejects.toThrow(/Online payments are not set up/);
    expect(db.billingPayment.create).not.toHaveBeenCalled();
    expect(db.promoRedemption.updateMany).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('creates the order with the active (dashboard) key', async () => {
    gateway.activeRazorpay.mockResolvedValue(DASH);
    const fetchMock = orderFetch();
    vi.stubGlobal('fetch', fetchMock);
    const res = await startCheckout({ userId: USER.id, plan: 'starter' });
    expect(res).toMatchObject({ mode: 'razorpay', keyId: 'rzp_test_dash1234', orderId: 'order_abc', finalPaise: 99_900, test: true });
    const auth = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(auth.Authorization).toBe(`Basic ${Buffer.from('rzp_test_dash1234:dash-secret').toString('base64')}`);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: USER.id }, data: { selectedPlan: 'starter' } });
  });

  it('activates right away when a promo covers the full price', async () => {
    db.promoCode.findUnique.mockResolvedValue(PROMO);
    const res = await startCheckout({ userId: USER.id, plan: 'starter', promoCode: 'free100' });
    expect(res).toMatchObject({ mode: 'free', finalPaise: 0, discountPaise: 99_900 });
    expect(db.promoCode.update).toHaveBeenCalledWith({ where: { id: 'promo-1' }, data: { timesRedeemed: { increment: 1 } } });
    expect(activate).toHaveBeenCalledWith(USER.id, { plan: 'starter', reason: 'free' });
  });

  it('rejects an invalid promo under the promo field', async () => {
    db.promoCode.findUnique.mockResolvedValue({ ...PROMO, isActive: false });
    await expect(startCheckout({ userId: USER.id, plan: 'starter', promoCode: 'FREE100' })).rejects.toMatchObject({ message: expect.stringMatching(/no longer active/) });
  });
});

describe('renewal', () => {
  const past = new Date(Date.now() - 86_400_000);
  const future = new Date(Date.now() + 10 * 86_400_000);
  const ACTIVE = { ...USER, passwordHash: 'hash', isVerified: true, selectedPlan: 'managed', subscriptionExpiresAt: future };

  it('allows active and expired accounts, not ones waiting for a first payment or suspended', () => {
    expect(canRenew({ isVerified: true, isEmailVerified: true, subscriptionExpiresAt: future })).toBe(true);
    expect(canRenew({ isVerified: false, isEmailVerified: true, subscriptionExpiresAt: past })).toBe(true);
    expect(canRenew({ isVerified: false, isEmailVerified: true, subscriptionExpiresAt: null })).toBe(false);
    expect(canRenew({ isVerified: false, isEmailVerified: true, subscriptionExpiresAt: future })).toBe(false);
    expect(canRenew({ isVerified: true, isEmailVerified: false, subscriptionExpiresAt: future })).toBe(false);
  });

  it('renews on the current plan without changing the saved plan before payment', async () => {
    gateway.activeRazorpay.mockResolvedValue(DASH);
    vi.stubGlobal('fetch', orderFetch());
    db.user.findUnique.mockResolvedValue(ACTIVE);
    const res = await startRenewal(USER.id, {});
    expect(res).toMatchObject({ mode: 'razorpay', finalPaise: 199_900, description: expect.stringMatching(/renewal/) });
    expect(db.billingPayment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ plan: 'managed', amountPaise: 199_900 }) });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('refuses accounts that cannot renew and quoted plans', async () => {
    db.user.findUnique.mockResolvedValueOnce({ ...ACTIVE, isVerified: false, subscriptionExpiresAt: null });
    await expect(startRenewal(USER.id, {})).rejects.toThrow(/cannot be renewed online/);
    db.user.findUnique.mockResolvedValueOnce({ ...ACTIVE, selectedPlan: 'custom' });
    await expect(startRenewal(USER.id, {})).rejects.toThrow(/renewed by our team/);
  });

  it('checks the password on the login renewal with one message for unknown email and wrong password', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    await expect(startRenewalWithLogin({ email: 'x@example.com', password: 'pw' })).rejects.toMatchObject({ status: 401, message: 'Incorrect email or password.' });
    passwordOk.mockResolvedValueOnce(false);
    db.user.findUnique.mockResolvedValueOnce({ ...ACTIVE, isVerified: false, subscriptionExpiresAt: past });
    await expect(startRenewalWithLogin({ email: USER.email, password: 'wrong' })).rejects.toMatchObject({ status: 401, message: 'Incorrect email or password.' });
    expect(db.billingPayment.create).not.toHaveBeenCalled();
  });
});

describe('confirmFromCheckout', () => {
  const ids = { orderId: 'order_1', paymentId: 'pay_1' };
  const sig = (secret: string) => createHmac('sha256', secret).update('order_1|pay_1').digest('hex');

  it('accepts a signature made with any configured key secret', async () => {
    gateway.keySecrets.mockResolvedValue(['dash-secret', 'env-secret']);
    db.billingPayment.findUnique.mockResolvedValue({ id: 'pay-row-1', userId: USER.id, plan: 'starter', amountPaise: 99_900, status: 'created' });
    db.billingPayment.updateMany.mockResolvedValue({ count: 1 });
    db.promoRedemption.findUnique.mockResolvedValue(null);
    await expect(confirmFromCheckout({ ...ids, signature: sig('env-secret') })).resolves.toEqual({ paid: true, activated: true });
  });

  it('rejects a signature from an unknown secret', async () => {
    gateway.keySecrets.mockResolvedValue(['dash-secret']);
    await expect(confirmFromCheckout({ ...ids, signature: sig('other') })).rejects.toThrow(/could not verify/);
    expect(activate).not.toHaveBeenCalled();
  });
});

describe('confirmPayment', () => {
  const PAYMENT = { id: 'pay-row-1', userId: USER.id, plan: 'starter', amountPaise: 79_920, status: 'created' };

  it('activates once and redeems the promo', async () => {
    db.billingPayment.findUnique.mockResolvedValue(PAYMENT);
    db.billingPayment.updateMany.mockResolvedValue({ count: 1 });
    db.promoRedemption.findUnique.mockResolvedValue({ id: 'r1', promoCodeId: 'promo-1', status: 'pending' });
    const res = await confirmPayment({ orderId: 'order_1', paymentId: 'pay_1', via: 'checkout' });
    expect(res.activated).toBe(true);
    expect(db.promoRedemption.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'redeemed' }) }));
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the webhook and checkout both arrive (second loses the race)', async () => {
    db.billingPayment.findUnique.mockResolvedValue(PAYMENT);
    db.billingPayment.updateMany.mockResolvedValue({ count: 0 });
    const res = await confirmPayment({ orderId: 'order_1', paymentId: 'pay_1', via: 'webhook' });
    expect(res).toMatchObject({ activated: false, alreadyPaid: true });
    expect(activate).not.toHaveBeenCalled();
  });

  it('refuses a paid amount that does not match the order', async () => {
    db.billingPayment.findUnique.mockResolvedValue(PAYMENT);
    await expect(confirmPayment({ orderId: 'order_1', paymentId: 'pay_1', via: 'webhook', amountPaise: 100 })).rejects.toThrow(/does not match/);
    expect(activate).not.toHaveBeenCalled();
  });
});

describe('handleWebhook', () => {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 79_920, method: 'upi' } } } });
  const sign = (b: string) => createHmac('sha256', 'whsec').update(b).digest('hex');
  // The env secret is second: deliveries signed with either secret are accepted.
  const configure = () => gateway.webhookSecrets.mockResolvedValue(['dash-whsec', 'whsec']);

  it('is refused until the webhook secret is set', async () => {
    expect((await handleWebhook(body, { signature: sign(body), eventId: 'evt_1' })).status).toBe(503);
  });

  it('rejects a bad signature', async () => {
    configure();
    expect((await handleWebhook(body, { signature: sign('other'), eventId: 'evt_1' })).status).toBe(400);
    expect(db.billingPayment.updateMany).not.toHaveBeenCalled();
  });

  it('confirms a captured payment and ignores a repeated delivery', async () => {
    configure();
    db.billingPayment.findUnique.mockResolvedValue({ id: 'pay-row-1', userId: USER.id, plan: 'starter', amountPaise: 79_920, status: 'created' });
    db.billingPayment.updateMany.mockResolvedValue({ count: 1 });
    db.promoRedemption.findUnique.mockResolvedValue(null);
    expect((await handleWebhook(body, { signature: sign(body), eventId: 'evt_1' })).status).toBe(200);
    expect(activate).toHaveBeenCalledTimes(1);

    db.billingWebhookEvent.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    const again = await handleWebhook(body, { signature: sign(body), eventId: 'evt_1' });
    expect(again).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(activate).toHaveBeenCalledTimes(1);
  });
});
