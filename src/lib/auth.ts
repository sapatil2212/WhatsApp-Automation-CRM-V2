import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { prisma } from './prisma'

const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret_key_change_me'
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default_jwt_refresh_secret_key_change_me'

export interface TokenPayload {
  userId: string
  email: string
  role: string
}

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Generate Access Token (short-lived: 15 minutes)
 */
export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' })
}

/**
 * Generate Refresh Token (long-lived: 7 days)
 */
export function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' })
}

/**
 * Verify Access Token
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload
  } catch {
    return null
  }
}

/**
 * Verify Refresh Token
 */
export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload
  } catch {
    return null
  }
}

/**
 * Set HTTPOnly cookies for Auth
 */
export async function setAuthCookies(accessToken: string, refreshToken: string) {
  const cookieStore = await cookies()
  
  // Access Token: 15 minutes
  cookieStore.set('accessToken', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 15 * 60, // 15 mins in seconds
    path: '/'
  })

  // Refresh Token: 7 days
  cookieStore.set('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    path: '/'
  })
}

/**
 * Clear HTTPOnly cookies (logout)
 */
export async function clearAuthCookies() {
  const cookieStore = await cookies()
  cookieStore.set('accessToken', '', { maxAge: 0, path: '/' })
  cookieStore.set('refreshToken', '', { maxAge: 0, path: '/' })
}

// Global in-memory cache for concurrency grace period during parallel token rotation
const globalStore = globalThis as any;
globalStore.rotatedTokens = globalStore.rotatedTokens || new Map<string, { 
  accessToken: string; 
  refreshToken: string; 
  user: TokenPayload; 
  rotatedAt: number; 
}>();

const rotatedTokens = globalStore.rotatedTokens;

// Clear entries older than 1 minute to prevent memory leak
function cleanRotatedTokens() {
  const now = Date.now();
  for (const [key, value] of rotatedTokens.entries()) {
    if (now - value.rotatedAt > 60 * 1000) {
      rotatedTokens.delete(key);
    }
  }
}

/**
 * Rotate Refresh Token in DB & Cookies
 * Prevents replay attacks by invalidating the used refresh token and issuing a new one.
 */
export async function rotateRefreshToken(token: string): Promise<{ accessToken: string, refreshToken: string, user: TokenPayload } | null> {
  // 1. Verify token
  const payload = verifyRefreshToken(token)
  if (!payload) return null

  // Check memory cache for recent concurrency grace period matches
  cleanRotatedTokens();
  const cached = rotatedTokens.get(token);
  if (cached && Date.now() - cached.rotatedAt < 15 * 1000) {
    // Re-set cookies for this parallel request and return the cached tokens
    await setAuthCookies(cached.accessToken, cached.refreshToken);
    return {
      accessToken: cached.accessToken,
      refreshToken: cached.refreshToken,
      user: cached.user
    };
  }

  try {
    // 2. Check if token exists in DB
    const existingToken = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: { include: { profile: true } } }
    })

    if (!existingToken) {
      // Replay attack / theft check: if the token is valid but not in DB, 
      // it might have been used before. Invalidate ALL tokens for the user as a safety precaution.
      await prisma.refreshToken.deleteMany({
        where: { userId: payload.userId }
      })
      return null
    }

    // Check expiration
    if (new Date() > existingToken.expiresAt) {
      await prisma.refreshToken.delete({ where: { token } })
      return null
    }

    // Check if the super admin has blocked/suspended this user's access OR if subscription has expired
    const isSubscriptionExpired = existingToken.user.subscriptionExpiresAt && existingToken.user.subscriptionExpiresAt < new Date();
    if (!existingToken.user.isVerified || isSubscriptionExpired) {
      if (isSubscriptionExpired && existingToken.user.isVerified) {
        // Automatically mark as unverified/expired in the database
        await prisma.user.update({
          where: { id: existingToken.user.id },
          data: { isVerified: false }
        });
      }
      // Revoke all their refresh tokens — forces immediate logout
      await prisma.refreshToken.deleteMany({ where: { userId: existingToken.user.id } })
      return null
    }

    // 3. User information
    const userPayload: TokenPayload = {
      userId: existingToken.user.id,
      email: existingToken.user.email,
      role: existingToken.user.role
    }

    // 4. Generate new tokens
    const newAccessToken = generateAccessToken(userPayload)
    const newRefreshToken = generateRefreshToken(userPayload)

    // 5. Update DB (atomic transaction to swap tokens)
    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { token } }),
      prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: userPayload.userId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        }
      })
    ])

    // 6. Set new cookies
    await setAuthCookies(newAccessToken, newRefreshToken)

    // Cache this rotation result for parallel requests
    rotatedTokens.set(token, {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: userPayload,
      rotatedAt: Date.now()
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: userPayload
    }
  } catch (error) {
    console.error('[rotateRefreshToken] Error:', error)
    return null
  }
}
