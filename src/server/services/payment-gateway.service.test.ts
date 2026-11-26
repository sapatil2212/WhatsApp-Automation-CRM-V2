import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  cmsSetting: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  billingWebhookEvent: { findFirst: vi.fn() },
}));

vi.mock('../kernel', async (orig) => ({ ...(await orig<typeof import('../kernel')>()), systemDb: db }));
// Reversible stand-in so the test does not depend on ENCRYPTION_KEY.
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith('enc:')) throw new Error('bad ciphertext');
    return s.slice(4);
  },
}));

import { activeRazorpay, clearGatewayCache, keySecrets, saveGateway, testGateway, webhookSecrets } from './payment-gateway.service';

const ENV = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'ENCRYPTION_KEY'] as const;
const saved = (over: object = {}) => ({ value: { enabled: true, keyId: 'rzp_live_dash12345678', keySecretEnc: 'enc:dash-secret', webhookSecretEnc: 'enc:dash-whsec', ...over } });
const setEnv = () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_env12345678';
  process.env.RAZORPAY_KEY_SECRET = 'env-secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'env-whsec';
};

beforeEach(() => {
  vi.clearAllMocks();
  clearGatewayCache();
  for (const k of ENV) delete process.env[k];
  db.cmsSetting.findUnique.mockResolvedValue(null);
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

describe('activeRazorpay', () => {
  it('is null when nothing is configured', async () => {
    expect(await activeRazorpay()).toBeNull();
    expect(await webhookSecrets()).toEqual([]);
  });

  it('falls back to the env keys', async () => {
    setEnv();
    expect(await activeRazorpay()).toMatchObject({ source: 'env', keyId: 'rzp_test_env12345678', keySecret: 'env-secret' });
  });

  it('prefers saved dashboard keys while they are switched on', async () => {
    setEnv();
    db.cmsSetting.findUnique.mockResolvedValue(saved());
    expect(await activeRazorpay()).toMatchObject({ source: 'dashboard', keyId: 'rzp_live_dash12345678', keySecret: 'dash-secret', webhookSecret: 'dash-whsec' });
  });

  it('uses env when the dashboard keys are switched off or cannot be decrypted', async () => {
    setEnv();
    db.cmsSetting.findUnique.mockResolvedValue(saved({ enabled: false }));
    expect((await activeRazorpay())?.source).toBe('env');
    clearGatewayCache();
    db.cmsSetting.findUnique.mockResolvedValue(saved({ keySecretEnc: 'garbage' }));
    expect((await activeRazorpay())?.source).toBe('env');
  });

  it('accepts webhook and checkout signatures from both sources', async () => {
    setEnv();
    db.cmsSetting.findUnique.mockResolvedValue(saved());
    expect((await webhookSecrets()).sort()).toEqual(['dash-whsec', 'env-whsec']);
    expect((await keySecrets()).sort()).toEqual(['dash-secret', 'env-secret']);
  });
});

describe('saveGateway', () => {
  it('needs ENCRYPTION_KEY before storing secrets', async () => {
    await expect(saveGateway({ enabled: true, keyId: 'rzp_test_abcdefgh12', keySecret: 's' }, 'admin@x.com')).rejects.toThrow(/ENCRYPTION_KEY/);
    expect(db.cmsSetting.upsert).not.toHaveBeenCalled();
  });

  it('stores secrets encrypted and keeps a saved secret when the field is left blank', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    db.cmsSetting.findUnique.mockResolvedValue(saved());
    db.billingWebhookEvent.findFirst.mockResolvedValue(null);
    await saveGateway({ enabled: true, keyId: '', keySecret: '', webhookSecret: 'new-webhook-secret' }, 'admin@x.com');
    const value = db.cmsSetting.upsert.mock.calls[0][0].update.value;
    expect(value).toMatchObject({ enabled: true, keyId: 'rzp_live_dash12345678', keySecretEnc: 'enc:dash-secret', webhookSecretEnc: 'enc:new-webhook-secret', updatedBy: 'admin@x.com' });
  });

  it('rejects a malformed key id and a short webhook secret', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    await expect(saveGateway({ enabled: false, keyId: 'pk_live_123' }, 'a@x.com')).rejects.toThrow(/rzp_test_ or rzp_live_/);
    await expect(saveGateway({ enabled: false, keyId: 'rzp_test_abcdefgh12', webhookSecret: 'short' }, 'a@x.com')).rejects.toThrow(/12 characters/);
  });

  it('cannot switch on without a key secret', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    await expect(saveGateway({ enabled: true, keyId: 'rzp_test_abcdefgh12' }, 'a@x.com')).rejects.toThrow(/Key ID and Key Secret/);
  });
});

describe('testGateway', () => {
  it('reports rejected keys without throwing', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    const res = await testGateway({ keyId: 'rzp_test_abcdefgh12', keySecret: 'nope' }, fetchMock as unknown as typeof fetch);
    expect(res).toMatchObject({ ok: false, mode: 'test' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.razorpay.com/v1/orders?count=1', expect.anything());
  });

  it('confirms working keys', async () => {
    const res = await testGateway({ keyId: 'rzp_live_abcdefgh12', keySecret: 'ok' }, (async () => new Response('{"items":[]}', { status: 200 })) as unknown as typeof fetch);
    expect(res).toMatchObject({ ok: true, mode: 'live' });
  });
});
