/**
 * Centralised identity + tenant resolution.
 *
 * This is the *only* place in the codebase that turns cookies into an
 * authenticated principal. Before this existed, six different helpers
 * each re-implemented "read accessToken, maybe rotate refreshToken, look
 * up profile.tenantId" — and three of them got it wrong in a way that
 * accepted any non-empty cookie value.
 *
 * Resolution is memoised on the ambient request context, so a handler
 * that needs the context in three places pays for one profile lookup.
 */

import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { rotateRefreshToken, verifyAccessToken, verifySuperAdminToken } from '@/lib/auth';

import { systemDb } from './db';
import { ForbiddenError, InternalError, TenantContextMissingError, UnauthenticatedError } from './errors';
import { getLogger } from './logger';
import { getRequestContext, setRequestIdentity } from './request-context';

const log = getLogger('kernel.auth');

export interface AuthContext {
  readonly userId: string;
  readonly email: string;
  /** Coarse account role from the User row (`tenant_admin`, `user`, …). */
  readonly role: string;
  readonly tenantId: string;
  readonly profileId: string;
}

/** Identity without a tenant — used by routes that run pre-provisioning. */
export interface PrincipalContext {
  readonly userId: string;
  readonly email: string;
  readonly role: string;
}

interface ContextCarrier {
  __principal?: PrincipalContext | null;
  __authContext?: AuthContext | null;
}

function carrier(): ContextCarrier | undefined {
  return getRequestContext() as unknown as ContextCarrier | undefined;
}

/**
 * Verifies the access token; if it is expired but a refresh token is
 * present, rotates it (which also re-issues both cookies). Returns null
 * when there is no usable session.
 */
export async function resolvePrincipal(): Promise<PrincipalContext | null> {
  const cached = carrier();
  if (cached && cached.__principal !== undefined) return cached.__principal;

  const cookieStore = await cookies();
  const accessToken = cookieStore.get('accessToken')?.value;
  const refreshToken = cookieStore.get('refreshToken')?.value;

  let payload = accessToken ? verifyAccessToken(accessToken) : null;

  if (!payload && refreshToken) {
    const rotation = await rotateRefreshToken(refreshToken);
    payload = rotation?.user ?? null;
  }

  const principal: PrincipalContext | null = payload
    ? { userId: payload.userId, email: payload.email, role: payload.role }
    : null;

  if (cached) cached.__principal = principal;
  if (principal) setRequestIdentity({ userId: principal.userId });

  return principal;
}

export async function requirePrincipal(): Promise<PrincipalContext> {
  const principal = await resolvePrincipal();
  if (!principal) throw new UnauthenticatedError();
  return principal;
}

/**
 * Full tenant-bound context. Throws `TenantContextMissingError` (403,
 * distinct code) when the account exists but has no profile/tenant, so
 * the client can send the user to onboarding instead of showing a
 * permission error.
 */
export async function resolveAuthContext(): Promise<AuthContext | null> {
  const cached = carrier();
  if (cached && cached.__authContext !== undefined) return cached.__authContext;

  const principal = await resolvePrincipal();
  if (!principal) {
    if (cached) cached.__authContext = null;
    return null;
  }

  // systemDb justification: resolving which tenant a user belongs to is
  // by definition a pre-tenant query.
  const profile = await systemDb.profile.findUnique({
    where: { userId: principal.userId },
    select: { id: true, tenantId: true },
  });

  if (!profile?.tenantId) {
    log.warn('authenticated user has no tenant', { hasProfile: Boolean(profile) });
    if (cached) cached.__authContext = null;
    throw new TenantContextMissingError();
  }

  const context: AuthContext = {
    userId: principal.userId,
    email: principal.email,
    role: principal.role,
    tenantId: profile.tenantId,
    profileId: profile.id,
  };

  if (cached) cached.__authContext = context;
  setRequestIdentity({ userId: context.userId, tenantId: context.tenantId });

  return context;
}

export async function requireAuthContext(): Promise<AuthContext> {
  const context = await resolveAuthContext();
  if (!context) throw new UnauthenticatedError();
  return context;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Shared-secret auth for scheduled jobs. Constant-time compare on every
 * cron route — previously only `/api/flows/cron` did this and
 * `/api/automations/cron` used `!==`.
 */
export function requireCronSecret(headerValue: string | null): void {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    // 501 rather than 401: the operator has not configured the feature,
    // which is a deployment gap, not an auth failure.
    throw new InternalError('AUTOMATION_CRON_SECRET is not configured; scheduled jobs are disabled.');
  }
  if (!headerValue || !constantTimeEquals(headerValue, expected)) {
    throw new UnauthenticatedError('Invalid cron secret.');
  }
}

/**
 * Platform-operator auth.
 * Cryptographically verifies the signed super admin JWT.
 */
export async function requireSuperAdmin(): Promise<{ email: string }> {
  const cookieStore = await cookies();
  const sessionToken =
    cookieStore.get('super_admin_session')?.value ?? cookieStore.get('admin_session')?.value ?? null;

  if (!sessionToken) {
    throw new ForbiddenError('Operator access required.');
  }

  const verified = verifySuperAdminToken(sessionToken);
  if (!verified) {
    throw new ForbiddenError('Invalid or expired operator session.');
  }

  return { email: verified.email };
}
