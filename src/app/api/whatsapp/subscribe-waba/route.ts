import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import { decrypt } from '@/lib/whatsapp/encryption'

async function getAuthUser() {
  const cookieStore = await cookies()
  let accessToken = cookieStore.get('accessToken')?.value
  const refreshToken = cookieStore.get('refreshToken')?.value
  let payload = accessToken ? verifyAccessToken(accessToken) : null
  if (!payload && refreshToken) {
    try {
      const rotation = await rotateRefreshToken(refreshToken)
      if (rotation) {
        payload = rotation.user
      }
    } catch { return null }
  }
  return payload
}

/**
 * POST /api/whatsapp/subscribe-waba
 * Subscribes the tenant's WABA to receive webhook events from this Meta app.
 * Without this Meta will not send message webhooks even if the URL is verified.
 */
export async function POST(_req: NextRequest) {
  try {
    const payload = await getAuthUser()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } })
    if (!profile?.tenantId) return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })

    const config = await prisma.whatsappConfig.findUnique({ where: { tenantId: profile.tenantId } })
    if (!config) return NextResponse.json({ error: 'No WhatsApp configuration found. Save credentials first.' }, { status: 404 })
    if (!config.wabaId) return NextResponse.json({ error: 'WABA ID is required. Update your configuration.' }, { status: 400 })

    let accessToken: string
    try { accessToken = decrypt(config.accessToken) }
    catch { return NextResponse.json({ error: 'Failed to decrypt access token. Re-save your configuration.' }, { status: 500 }) }

    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${config.wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    })
    const metaData = await metaRes.json()

    if (!metaRes.ok) {
      console.error('[subscribe-waba] Meta API error:', metaData)
      return NextResponse.json({ error: metaData.error?.message || 'Failed to subscribe WABA', meta_error: metaData.error }, { status: metaRes.status })
    }

    console.log('[subscribe-waba] WABA subscribed successfully:', config.wabaId)
    return NextResponse.json({ success: true, waba_id: config.wabaId, meta_response: metaData })
  } catch (error: any) {
    console.error('[subscribe-waba] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/whatsapp/subscribe-waba
 * Check current WABA webhook subscription status.
 */
export async function GET(_req: NextRequest) {
  try {
    const payload = await getAuthUser()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } })
    if (!profile?.tenantId) return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })

    const config = await prisma.whatsappConfig.findUnique({ where: { tenantId: profile.tenantId } })
    if (!config?.wabaId) return NextResponse.json({ subscribed: false, reason: 'No WABA ID configured' })

    let accessToken: string
    try { accessToken = decrypt(config.accessToken) }
    catch { return NextResponse.json({ subscribed: false, reason: 'Token decrypt failed' }) }

    const res = await fetch(`https://graph.facebook.com/v19.0/${config.wabaId}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = res.ok ? await res.json() : null

    return NextResponse.json({
      subscribed: (data?.data?.length ?? 0) > 0,
      subscribed_apps: data?.data || [],
      waba_id: config.wabaId,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
