import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

/**
 * Shared helper: resolves the authenticated user from JWT cookies.
 */
async function getAuthUser() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('accessToken')?.value
  const refreshToken = cookieStore.get('refreshToken')?.value

  let payload = accessToken ? verifyAccessToken(accessToken) : null

  if (!payload && refreshToken) {
    const rotation = await rotateRefreshToken(refreshToken)
    if (rotation) {
      payload = rotation.user
    }
  }

  return payload
}

/**
 * GET /api/auth/account
 *
 * Returns the full account data for the logged-in user:
 * User fields + Profile fields + Tenant info.
 */
export async function GET(_req: NextRequest) {
  try {
    const payload = await getAuthUser()
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        profile: true,
        tenantsOwned: {
          select: {
            id: true,
            name: true,
            plan: true,
            isActive: true,
            createdAt: true,
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      account: {
        id: user.id,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        isEmailVerified: user.isEmailVerified,
        selectedPlan: user.selectedPlan,
        paymentProofAttached: user.paymentProofAttached,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      profile: user.profile ? {
        id: user.profile.id,
        fullName: user.profile.fullName,
        email: user.profile.email,
        avatarUrl: user.profile.avatarUrl,
        role: user.profile.role,
        businessName: user.profile.businessName,
        businessType: user.profile.businessType,
        phoneNumber: (user.profile as any).phoneNumber,
        tenantId: user.profile.tenantId,
      } : null,
      tenant: user.tenantsOwned?.[0] ?? null,
    })

  } catch (error: any) {
    console.error('[account GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/auth/account
 *
 * Updates the logged-in user's profile fields (fullName, businessName,
 * businessType, phoneNumber, avatarUrl).
 */
export async function PATCH(req: NextRequest) {
  try {
    const payload = await getAuthUser()
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { fullName, businessName, businessType, phoneNumber, avatarUrl } = body

    const profileData: Record<string, any> = {}
    if (fullName !== undefined) profileData.fullName = fullName.trim()
    if (businessName !== undefined) {
      const trimmed = businessName.trim()
      profileData.businessName = trimmed || null

      // Sync to Tenant
      await prisma.tenant.updateMany({
        where: { ownerUserId: payload.userId },
        data: { name: trimmed || 'My Organization' }
      }).catch(() => {})

      // Sync to BusinessProfile if exists
      const hasBusiness = await prisma.businessProfile.findUnique({
        where: { userId: payload.userId }
      })
      if (hasBusiness) {
        await prisma.businessProfile.update({
          where: { userId: payload.userId },
          data: { businessName: trimmed || null }
        }).catch(() => {})
      }
    }
    if (businessType !== undefined) profileData.businessType = businessType.trim() || null
    if (phoneNumber !== undefined) profileData.phoneNumber = phoneNumber.trim() || null
    if (avatarUrl !== undefined) profileData.avatarUrl = avatarUrl

    if (Object.keys(profileData).length > 0) {
      await prisma.profile.update({
        where: { userId: payload.userId },
        data: profileData,
      })
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('[account PATCH] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
