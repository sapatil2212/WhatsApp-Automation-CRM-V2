import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { clearAuthCookies, verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    let isGlobal = false
    try {
      const body = await req.json()
      if (body?.global) {
        isGlobal = true
      }
    } catch {
      // Body might be empty or invalid
    }

    const cookieStore = await cookies()
    const refreshToken = cookieStore.get('refreshToken')?.value
    const accessToken = cookieStore.get('accessToken')?.value

    if (isGlobal) {
      let payload = accessToken ? verifyAccessToken(accessToken) : null
      if (!payload && refreshToken) {
        const rotation = await rotateRefreshToken(refreshToken)
        if (rotation) {
          payload = rotation.user
        }
      }

      if (payload?.userId) {
        // Delete ALL refresh tokens for this user
        await prisma.refreshToken.deleteMany({
          where: { userId: payload.userId }
        }).catch(() => {})
      }
    } else if (refreshToken) {
      // Remove just the current token from database
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken }
      }).catch(() => {})
    }

    // Clear cookies
    await clearAuthCookies()

    return NextResponse.json({ message: 'Logged out successfully' })
  } catch (error: any) {
    console.error('[logout] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
