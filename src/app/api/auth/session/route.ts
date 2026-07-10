import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

export async function GET(req: NextRequest) {
  console.log('--- HITTING /api/auth/session GET ROUTE ---')
  try {
    const cookieStore = await cookies()
    let accessToken = cookieStore.get('accessToken')?.value
    const refreshToken = cookieStore.get('refreshToken')?.value

    let payload = accessToken ? verifyAccessToken(accessToken) : null

    // If access token is expired/missing but refresh token exists, try to rotate
    if (!payload && refreshToken) {
      const rotation = await rotateRefreshToken(refreshToken)
      if (rotation) {
        accessToken = rotation.accessToken
        payload = rotation.user
      }
    }

    if (!payload) {
      return NextResponse.json({ user: null, profile: null })
    }

    // Load User with profile
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { profile: true }
    })

    if (!user) {
      return NextResponse.json({ user: null, profile: null })
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        created_at: user.createdAt.toISOString()
      },
      profile: user.profile ? {
        id: user.profile.id,
        fullName: user.profile.fullName,
        email: user.profile.email,
        avatarUrl: user.profile.avatarUrl,
        role: user.profile.role,
        tenantId: user.profile.tenantId,
        businessName: user.profile.businessName,
        businessType: user.profile.businessType,
        phoneNumber: (user.profile as any).phoneNumber,
        betaFeatures: user.profile.betaFeatures ?? []
      } : null
    })

  } catch (error: any) {
    console.error('[session] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
