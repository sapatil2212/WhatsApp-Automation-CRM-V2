import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { rotateRefreshToken, clearAuthCookies } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get('refreshToken')?.value

    if (!refreshToken) {
      return NextResponse.json({ error: 'No refresh token provided' }, { status: 401 })
    }

    const rotationResult = await rotateRefreshToken(refreshToken)

    if (!rotationResult) {
      // Invalidate cookies since refresh token is stolen or invalid
      await clearAuthCookies()
      return NextResponse.json({ error: 'Session expired or invalid refresh token' }, { status: 401 })
    }

    return NextResponse.json({
      accessToken: rotationResult.accessToken,
      user: rotationResult.user
    })
  } catch (error: any) {
    console.error('[refresh] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

// Support GET requests as well for easy middleware redirects if needed
export async function GET(req: NextRequest) {
  return POST(req)
}
