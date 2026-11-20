import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { rotateRefreshToken, verifyAccessToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * Shared request context for the template routes: the signed-in user, their
 * tenant, and (optionally) the tenant's decrypted WhatsApp credentials.
 *
 * Credentials are resolved per *tenant* — not per user — so every teammate
 * in a workspace can submit and sync templates, not just whoever connected
 * the account.
 */

export async function getAuthUser() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('accessToken')?.value;
  const refreshToken = cookieStore.get('refreshToken')?.value;

  let payload = accessToken ? verifyAccessToken(accessToken) : null;
  if (!payload && refreshToken) {
    const rotation = await rotateRefreshToken(refreshToken);
    if (rotation) payload = rotation.user;
  }
  return payload;
}

export type TenantContext = { userId: string; tenantId: string };
export type WhatsAppCreds = { wabaId: string; accessToken: string };

type Ok<T> = { ok: true; value: T };
type Fail = { ok: false; response: NextResponse };

export async function requireTenant(): Promise<Ok<TenantContext> | Fail> {
  const payload = await getAuthUser();
  if (!payload) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } });
  if (!profile?.tenantId) {
    return { ok: false, response: NextResponse.json({ error: 'Tenant context not found' }, { status: 403 }) };
  }
  return { ok: true, value: { userId: payload.userId, tenantId: profile.tenantId } };
}

export async function requireWhatsAppCreds(tenantId: string): Promise<Ok<WhatsAppCreds> | Fail> {
  const config = await prisma.whatsappConfig.findUnique({
    where: { tenantId },
    select: { wabaId: true, accessToken: true },
  });
  const fail = (error: string) => ({ ok: false as const, response: NextResponse.json({ error }, { status: 400 }) });
  if (!config) return fail('WhatsApp is not connected. Connect your WhatsApp Business account in Settings first.');
  if (!config.wabaId) return fail('WhatsApp Business Account (WABA) ID is missing. Re-connect your account in Settings.');
  try {
    return { ok: true, value: { wabaId: config.wabaId, accessToken: decrypt(config.accessToken) } };
  } catch {
    return fail('The stored WhatsApp access token could not be decrypted. Reconnect WhatsApp in Settings.');
  }
}
