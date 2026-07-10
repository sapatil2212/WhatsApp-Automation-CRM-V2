import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    let accessToken = cookieStore.get('accessToken')?.value
    const refreshToken = cookieStore.get('refreshToken')?.value

    let payload = accessToken ? verifyAccessToken(accessToken) : null

    if (!payload && refreshToken) {
      const rotation = await rotateRefreshToken(refreshToken)
      if (rotation) {
        payload = rotation.user
      }
    }

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Resolve tenantId
    const profile = await prisma.profile.findUnique({
      where: { userId: payload.userId }
    })

    if (!profile || !profile.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }

    // Count unread conversations scoped by tenantId
    const unreadCount = await prisma.conversation.count({
      where: {
        tenantId: profile.tenantId,
        unreadCount: { gt: 0 }
      }
    })

    return NextResponse.json({ count: unreadCount })
  } catch (error: any) {
    console.error('Error fetching unread count:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
