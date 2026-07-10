import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'chatnexgen_jwt_access_secret_2026_key_v1')

interface JWTPayload {
  userId: string
  email: string
  role: string
}

async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as JWTPayload
  } catch (error) {
    return null
  }
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next()

  // 1. Extract cookies
  let accessToken = request.cookies.get('accessToken')?.value
  const refreshToken = request.cookies.get('refreshToken')?.value

  let user: JWTPayload | null = null

  // 2. Validate access token
  if (accessToken) {
    user = await verifyToken(accessToken)
  }

  const path = request.nextUrl.pathname

  // 3. Token Rotation (if access token expired/invalid, but refresh token exists)
  // Skip rotation for auth API endpoints to prevent middleware deadlock loops
  if (!user && refreshToken && !path.startsWith('/api/auth/')) {
    try {
      // Call the Node.js Route Handler /api/auth/refresh to handle MySQL rotation
      const refreshUrl = new URL('/api/auth/refresh', request.url)
      const refreshRes = await fetch(refreshUrl.toString(), {
        method: 'POST',
        headers: {
          cookie: request.headers.get('cookie') || ''
        }
      })

      if (refreshRes.ok) {
        const data = await refreshRes.json()
        user = data.user
        
        // Copy set-cookie headers from the refresh response to our proxy response
        response = NextResponse.next()
        const setCookies = refreshRes.headers.getSetCookie()
        setCookies.forEach(cookieStr => {
          response.headers.append('set-cookie', cookieStr)
        })
      }
    } catch (error) {
      console.error('[Middleware Auth Refresh] Error:', error)
    }
  }

  // 4. Auth pages redirect to dashboard if logged in
  const authPaths = ['/login', '/signup', '/forgot-password']
  if (user && authPaths.includes(path)) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // 5. Protected pages redirect to login if not logged in
  const protectedPaths = [
    '/dashboard', '/inbox', '/contacts', '/pipelines',
    '/campaigns', '/automations', '/settings',
    '/templates', '/flows', '/healthcare',
  ]
  if (!user && protectedPaths.some(p => path.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('from', path)
    
    // Clear cookies so expired/invalid tokens are removed
    const clearResponse = NextResponse.redirect(url)
    clearResponse.cookies.set('accessToken', '', { maxAge: 0, path: '/' })
    clearResponse.cookies.set('refreshToken', '', { maxAge: 0, path: '/' })
    return clearResponse
  }

  // 6. API routes protection (exclude webhooks)
  if (!user && path.startsWith('/api/whatsapp/') && !path.includes('/webhook')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
