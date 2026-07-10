import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { email, password, currentPassword } = await req.json()

    // 1. Authenticate user from session cookies
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

    // 2. Fetch current user password hash
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // 3. Verify current password if changing password or email
    if (currentPassword) {
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!isMatch) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
      }
    }

    const updates: any = {}

    // 4. Handle new password hashing
    if (password) {
      if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
      }
      updates.passwordHash = await bcrypt.hash(password, 10)
    }

    // 5. Handle email change
    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      // Check if email already exists
      const existing = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      })
      if (existing) {
        return NextResponse.json({ error: 'Email address already in use' }, { status: 400 })
      }
      updates.email = email.toLowerCase()
    }

    // 6. Save updates to User and Profile models
    if (Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: updates
      })

      if (updates.email) {
        await prisma.profile.update({
          where: { userId: user.id },
          data: { email: updates.email }
        })
      }
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Update user route error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
