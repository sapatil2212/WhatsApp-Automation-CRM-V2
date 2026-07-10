import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { clearAuthCookies } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get('refreshToken')?.value

    if (refreshToken) {
      // Remove token from database
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken }
      }).catch(() => {
        // Ignore database errors during logout if token was already deleted or doesn't exist
      })
    }

    // Clear cookies
    await clearAuthCookies()

    return NextResponse.json({ message: 'Logged out successfully' })
  } catch (error: any) {
    console.error('[logout] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
