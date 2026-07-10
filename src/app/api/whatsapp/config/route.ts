import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

const MASKED_TOKEN = '••••••••••••••••'

/**
 * Shared helper: resolves the authenticated user payload from JWT cookies.
 * Returns null if unauthenticated.
 */
async function getAuthUser() {
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

  return payload
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 */
export async function GET(_req: NextRequest) {
  try {
    const payload = await getAuthUser()
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Resolve tenant context
    const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } })
    if (!profile?.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }

    const config = await prisma.whatsappConfig.findUnique({
      where: { tenantId: profile.tenantId },
      select: { phoneNumberId: true, accessToken: true, status: true },
    })

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    let decryptedToken: string
    try {
      decryptedToken = decrypt(config.accessToken)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed. Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    // Validate credentials against Meta
    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phoneNumberId,
        accessToken: decryptedToken,
      })
      return NextResponse.json({ connected: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates WhatsApp config for the authenticated user's tenant.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthUser()
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } })
    if (!profile?.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }
    const { tenantId } = profile

    const body = await request.json()
    const { phone_number_id, waba_id, access_token, verify_token, meta_app_secret } = body

    if (!phone_number_id) {
      return NextResponse.json({ error: 'phone_number_id is required' }, { status: 400 })
    }

    let resolvedAccessToken = access_token
    let resolvedMetaAppSecret = meta_app_secret

    // 1. If tokens are masked, fetch existing config to resolve them
    if (access_token === MASKED_TOKEN || meta_app_secret === MASKED_TOKEN) {
      const existing = await prisma.whatsappConfig.findUnique({
        where: { tenantId }
      })
      if (existing) {
        if (access_token === MASKED_TOKEN) {
          resolvedAccessToken = decrypt(existing.accessToken)
        }
        if (meta_app_secret === MASKED_TOKEN && existing.metaAppSecret) {
          resolvedMetaAppSecret = decrypt(existing.metaAppSecret)
        }
      }
    }

    if (!resolvedAccessToken) {
      return NextResponse.json({ error: 'access_token is required' }, { status: 400 })
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: resolvedAccessToken,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during save:', message)
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 })
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    let encryptedMetaAppSecret: string | null
    try {
      encryptedAccessToken = encrypt(resolvedAccessToken)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
      encryptedMetaAppSecret = resolvedMetaAppSecret ? encrypt(resolvedMetaAppSecret) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        { error: 'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string.' },
        { status: 500 }
      )
    }

    // Upsert via Prisma
    await prisma.whatsappConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        userId: payload.userId,
        phoneNumberId: phone_number_id,
        wabaId: waba_id || null,
        accessToken: encryptedAccessToken,
        verifyToken: encryptedVerifyToken,
        metaAppSecret: encryptedMetaAppSecret,
        status: 'connected',
        connectedAt: new Date(),
      },
      update: {
        phoneNumberId: phone_number_id,
        wabaId: waba_id || null,
        accessToken: encryptedAccessToken,
        verifyToken: encryptedVerifyToken !== undefined ? encryptedVerifyToken : undefined,
        metaAppSecret: encryptedMetaAppSecret !== undefined ? encryptedMetaAppSecret : undefined,
        status: 'connected',
        connectedAt: new Date(),
      },
    })

    return NextResponse.json({ success: true, phone_info: phoneInfo })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/whatsapp/config/data  — alias handled here via query param ?action=data
 * Returns the saved config row (safe fields) without hitting Meta API.
 */
export async function PUT(request: NextRequest) {
  // We repurpose PUT as a "read config row" endpoint for the frontend form.
  try {
    const payload = await getAuthUser()
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } })
    if (!profile?.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }

    const config = await prisma.whatsappConfig.findUnique({
      where: { tenantId: profile.tenantId },
      select: {
        id: true,
        phoneNumberId: true,
        wabaId: true,
        accessToken: true,  // encrypted – frontend will mask it
        verifyToken: true,
        metaAppSecret: true,
        status: true,
        connectedAt: true,
      },
    })

    if (!config) return NextResponse.json({ data: null })

    let decryptedVerifyToken: string | null = null
    if (config.verifyToken) {
      try {
        decryptedVerifyToken = decrypt(config.verifyToken)
      } catch (err) {
        console.error('Failed to decrypt verifyToken:', err)
      }
    }

    return NextResponse.json({
      data: {
        id: config.id,
        phone_number_id: config.phoneNumberId,
        waba_id: config.wabaId,
        access_token: config.accessToken ? MASKED_TOKEN : '',   // Mask it
        verify_token: decryptedVerifyToken || '',
        meta_app_secret: config.metaAppSecret ? MASKED_TOKEN : '', // Mask it
        status: config.status,
        connected_at: config.connectedAt,
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp config PUT (read):', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 */
export async function DELETE(_req: NextRequest) {
  try {
    const payload = await getAuthUser()
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } })
    if (!profile?.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }

    await prisma.whatsappConfig.deleteMany({
      where: { tenantId: profile.tenantId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
