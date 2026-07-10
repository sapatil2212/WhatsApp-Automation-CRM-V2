import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, generateAccessToken, generateRefreshToken, setAuthCookies } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 1. Fetch user with profile
    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // 2. Verify password
    const isPasswordValid = await verifyPassword(password, user.passwordHash)
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // 3. Check subscription and verification status
    if (!user.isVerified) {
      if (user.subscriptionExpiresAt && user.subscriptionExpiresAt < new Date()) {
        return NextResponse.json(
          { error: 'subscription_expired', message: 'Your subscription has ended. Please renew to continue.' },
          { status: 403 }
        )
      }

      if (!user.isEmailVerified) {
        return NextResponse.json(
          { error: 'email_unverified', message: 'Please verify your email address first.' },
          { status: 403 }
        )
      }

      return NextResponse.json(
        { error: 'pending_approval', message: 'Your account is pending approval or has been suspended. Please contact your administrator.' },
        { status: 403 }
      )
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role
    }

    const accessToken = generateAccessToken(payload)
    const refreshToken = generateRefreshToken(payload)

    // 4. Clean up old refresh tokens for this user, then save new one
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } })
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      }
    })

    // 5. Set Cookies and return response
    await setAuthCookies(accessToken, refreshToken)

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: user.profile ? {
          id: user.profile.id,
          fullName: user.profile.fullName,
          tenantId: user.profile.tenantId,
          businessName: user.profile.businessName,
          businessType: user.profile.businessType,
          phoneNumber: (user.profile as any).phoneNumber
        } : null
      }
    })

  } catch (error: any) {
    console.error('[login] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
