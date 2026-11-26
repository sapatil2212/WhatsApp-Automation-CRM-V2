/**
 * Razorpay credentials from two places ("hybrid"):
 *
 *   1. Super Admin → Integrations (stored in CmsSetting, secrets encrypted
 *      with ENCRYPTION_KEY, AES-256-GCM). Used when saved and switched on.
 *   2. Server environment (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET /
 *      RAZORPAY_WEBHOOK_SECRET in .env.local or the host's env). Fallback.
 *
 * Secrets never leave the server: the admin UI only sees masked values and
 * whether each one is set.
 */

import { z } from 'zod';

import { RAZORPAY_API, razorpayEnvConfig, razorpayMode, type RazorpayConfig } from '@/lib/billing/razorpay';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { getLogger, systemDb, ValidationError } from '../kernel';
import { publicSiteUrl } from '../site-origin';

const log = getLogger('payment-gateway');
const SETTING_KEY = 'payment_gateway_razorpay';
const CACHE_MS = 30_000;
export const KEY_ID_RE = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;

interface Stored {
  enabled: boolean;
  keyId: string | null;
  keySecretEnc: string | null;
  webhookSecretEnc: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type ActiveRazorpay = RazorpayConfig & { source: 'dashboard' | 'env' };

let cache: { at: number; value: ActiveRazorpay | null; secrets: string[] } | null = null;
export function clearGatewayCache() {
  cache = null;
}

const envConfig = razorpayEnvConfig;

async function readStored(): Promise<Stored> {
  const row = await systemDb.cmsSetting.findUnique({ where: { key: SETTING_KEY } });
  const v = (row?.value ?? {}) as Partial<Stored>;
  return { enabled: Boolean(v.enabled), keyId: v.keyId ?? null, keySecretEnc: v.keySecretEnc ?? null, webhookSecretEnc: v.webhookSecretEnc ?? null, updatedAt: v.updatedAt ?? null, updatedBy: v.updatedBy ?? null };
}

function open(enc: string | null): string | null {
  if (!enc) return null;
  try {
    return decrypt(enc);
  } catch (e) {
    log.error('stored Razorpay secret could not be decrypted (ENCRYPTION_KEY changed?)', { err: e });
    return null;
  }
}

function dashboardConfig(s: Stored): RazorpayConfig | null {
  if (!s.enabled || !s.keyId) return null;
  const keySecret = open(s.keySecretEnc);
  if (!keySecret) return null;
  return { keyId: s.keyId, keySecret, webhookSecret: open(s.webhookSecretEnc) };
}

async function load() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const stored = await readStored().catch((e) => {
    log.error('could not read Razorpay settings', { err: e });
    return null;
  });
  const dash = stored ? dashboardConfig(stored) : null;
  const env = envConfig();
  const value: ActiveRazorpay | null = dash ? { ...dash, source: 'dashboard' } : env ? { ...env, source: 'env' } : null;
  // Webhooks are accepted with either secret, so switching source never drops a delivery in flight.
  const secrets = [...new Set([dash?.webhookSecret, env?.webhookSecret, stored ? open(stored.webhookSecretEnc) : null].filter((s): s is string => Boolean(s)))];
  // Checkout signatures are made with the key secret of whichever key created the order.
  cache = { at: Date.now(), value, secrets };
  return cache;
}

/** The credentials payments use right now, or null when Razorpay is not set up anywhere. */
export async function activeRazorpay(): Promise<ActiveRazorpay | null> {
  return (await load()).value;
}

/** Every webhook secret currently configured (dashboard and env). */
export async function webhookSecrets(): Promise<string[]> {
  return (await load()).secrets;
}

/** Every key secret currently configured, for verifying checkout signatures. */
export async function keySecrets(): Promise<string[]> {
  const stored = await readStored().catch(() => null);
  return [...new Set([stored ? open(stored.keySecretEnc) : null, envConfig()?.keySecret].filter((s): s is string => Boolean(s)))];
}

// ── admin ────────────────────────────────────────────────────────────

const mask = (s: string | null | undefined) => (s ? `${s.slice(0, 13)}${'•'.repeat(Math.max(0, Math.min(8, s.length - 13)))}` : null);

export async function gatewayStatus() {
  const [stored, active, lastEvent] = await Promise.all([
    readStored(),
    activeRazorpay(),
    systemDb.billingWebhookEvent.findFirst({ orderBy: { receivedAt: 'desc' }, select: { event: true, receivedAt: true } }),
  ]);
  const env = envConfig();
  const site = publicSiteUrl();
  return {
    active: active ? { source: active.source, mode: razorpayMode(active.keyId), keyId: mask(active.keyId), webhookSecretSet: Boolean(active.webhookSecret) } : null,
    dashboard: {
      enabled: stored.enabled,
      keyId: stored.keyId,
      keySecretSet: Boolean(stored.keySecretEnc),
      webhookSecretSet: Boolean(stored.webhookSecretEnc),
      decryptOk: !stored.keySecretEnc || Boolean(open(stored.keySecretEnc)),
      updatedAt: stored.updatedAt,
      updatedBy: stored.updatedBy,
    },
    env: { keyId: mask(env?.keyId), keySecretSet: Boolean(env?.keySecret), webhookSecretSet: Boolean(env?.webhookSecret) },
    encryptionReady: Boolean(process.env.ENCRYPTION_KEY && /^[0-9a-f]{64}$/i.test(process.env.ENCRYPTION_KEY)),
    webhookUrl: `${site || 'https://chatnexgen.online'}/api/billing/razorpay/webhook`,
    webhookEvents: ['payment.captured', 'order.paid', 'payment.failed'],
    lastWebhook: lastEvent ? { event: lastEvent.event, at: lastEvent.receivedAt.toISOString() } : null,
  };
}

export const gatewaySaveSchema = z.object({
  enabled: z.boolean(),
  keyId: z.string().trim().max(40).optional().or(z.literal('')),
  /** Empty = keep the saved secret. */
  keySecret: z.string().trim().max(80).optional().or(z.literal('')),
  webhookSecret: z.string().trim().max(200).optional().or(z.literal('')),
  clear: z.boolean().optional(),
});

export async function saveGateway(body: z.infer<typeof gatewaySaveSchema>, adminEmail: string) {
  if (body.clear) {
    await systemDb.cmsSetting.deleteMany({ where: { key: SETTING_KEY } });
    clearGatewayCache();
    log.info('razorpay dashboard settings removed', { by: adminEmail });
    return gatewayStatus();
  }
  const current = await readStored();
  if (!process.env.ENCRYPTION_KEY || !/^[0-9a-f]{64}$/i.test(process.env.ENCRYPTION_KEY)) {
    throw new ValidationError('ENCRYPTION_KEY (64 hex characters) must be set on the server before secrets can be saved here.');
  }
  const keyId = body.keyId || current.keyId;
  if (keyId && !KEY_ID_RE.test(keyId)) throw new ValidationError('The Key ID looks wrong. It starts with rzp_test_ or rzp_live_.', { details: { field: 'keyId' } });
  if (body.webhookSecret && body.webhookSecret.length < 12) throw new ValidationError('Use a webhook secret of at least 12 characters.', { details: { field: 'webhookSecret' } });
  const next: Stored = {
    enabled: body.enabled,
    keyId: keyId ?? null,
    keySecretEnc: body.keySecret ? encrypt(body.keySecret) : current.keySecretEnc,
    webhookSecretEnc: body.webhookSecret ? encrypt(body.webhookSecret) : current.webhookSecretEnc,
    updatedAt: new Date().toISOString(),
    updatedBy: adminEmail,
  };
  if (next.enabled && (!next.keyId || !next.keySecretEnc)) throw new ValidationError('Add the Key ID and Key Secret before switching this on.');
  await systemDb.cmsSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value: next as never }, update: { value: next as never } });
  clearGatewayCache();
  log.info('razorpay dashboard settings saved', { by: adminEmail, enabled: next.enabled, mode: next.keyId ? razorpayMode(next.keyId) : null });
  return gatewayStatus();
}

export const gatewayTestSchema = z.object({
  /** Test what is typed, or (empty) the saved / active keys. */
  keyId: z.string().trim().max(40).optional().or(z.literal('')),
  keySecret: z.string().trim().max(80).optional().or(z.literal('')),
});

/** Calls Razorpay with the keys to confirm they work (lists one order; changes nothing). */
export async function testGateway(body: z.infer<typeof gatewayTestSchema>, fetchImpl: typeof fetch = fetch) {
  let keyId = body.keyId || '';
  let keySecret = body.keySecret || '';
  if (!keyId || !keySecret) {
    const stored = await readStored();
    const fromDash = stored.keyId ? { keyId: stored.keyId, keySecret: open(stored.keySecretEnc) ?? '' } : null;
    const fallback = fromDash?.keySecret ? fromDash : envConfig();
    keyId = keyId || fallback?.keyId || '';
    keySecret = keySecret || fallback?.keySecret || '';
  }
  if (!keyId || !keySecret) throw new ValidationError('Add a Key ID and Key Secret to test.');
  if (!KEY_ID_RE.test(keyId)) throw new ValidationError('The Key ID looks wrong. It starts with rzp_test_ or rzp_live_.');
  const res = await fetchImpl(`${RAZORPAY_API}/orders?count=1`, {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` },
    signal: AbortSignal.timeout(15_000),
  }).catch((e: Error) => {
    throw new ValidationError(`Could not reach Razorpay: ${e.message}`);
  });
  if (res.status === 401) return { ok: false, mode: razorpayMode(keyId), message: 'Razorpay rejected these keys. Check that the Key ID and Key Secret belong together and are not revoked.' };
  if (!res.ok) return { ok: false, mode: razorpayMode(keyId), message: `Razorpay answered HTTP ${res.status}. Try again in a minute.` };
  return { ok: true, mode: razorpayMode(keyId), message: `Keys work (${razorpayMode(keyId) === 'live' ? 'live mode: real payments' : 'test mode: no real money'}).` };
}
