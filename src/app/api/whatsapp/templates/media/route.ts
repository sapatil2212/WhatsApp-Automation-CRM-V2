import { NextRequest, NextResponse } from 'next/server'
import { MetaApiError, uploadTemplateMedia } from '@/lib/whatsapp/meta-api'
import { requireTenant, requireWhatsAppCreds } from '@/lib/whatsapp/template-context'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * Upload a sample header file to Meta (Resumable Upload API) and return the
 * `header_handle` required to submit an IMAGE / VIDEO / DOCUMENT template.
 */

const ALLOWED: Record<string, { types: string[]; maxBytes: number }> = {
  image: { types: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024 },
  video: { types: ['video/mp4', 'video/3gpp'], maxBytes: 16 * 1024 * 1024 },
  document: { types: ['application/pdf'], maxBytes: 16 * 1024 * 1024 },
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireTenant()
    if (!ctx.ok) return ctx.response

    const limit = checkRateLimit(`template-media:${ctx.value.userId}`, { limit: 10, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    const form = await request.formData()
    const file = form.get('file')
    const kind = String(form.get('kind') ?? '')
    const rule = ALLOWED[kind]
    if (!rule) return NextResponse.json({ error: 'Unknown media type.' }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
    if (!rule.types.includes(file.type)) {
      return NextResponse.json({ error: `A ${kind} header must be ${rule.types.join(' or ')}.` }, { status: 400 })
    }
    if (file.size > rule.maxBytes) {
      return NextResponse.json({ error: `File is too large (max ${Math.round(rule.maxBytes / 1024 / 1024)} MB).` }, { status: 400 })
    }

    const creds = await requireWhatsAppCreds(ctx.value.tenantId)
    if (!creds.ok) return creds.response

    const handle = await uploadTemplateMedia({
      accessToken: creds.value.accessToken,
      bytes: await file.arrayBuffer(),
      mimeType: file.type,
      fileName: file.name,
    })
    return NextResponse.json({ handle })
  } catch (error) {
    console.error('Template media upload failed:', error)
    const status = error instanceof MetaApiError && error.httpStatus < 500 ? 400 : 502
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status },
    )
  }
}
