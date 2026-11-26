import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  createMessageTemplate,
  deleteMessageTemplate,
  editMessageTemplate,
  listMessageTemplates,
  MetaApiError,
  uploadTemplateMedia,
} from '@/lib/whatsapp/meta-api'
import { buildComponents, draftFromBody, toLocalStatus, toMetaCategory } from '@/lib/whatsapp/template-payload'
import { isMediaHandle, validateTemplate } from '@/lib/whatsapp/template-rules'
import { requireTenant, requireWhatsAppCreds } from '@/lib/whatsapp/template-context'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * WhatsApp Message Template management with Meta's approval workflow.
 *
 *   GET    → list this tenant's templates (local catalog)
 *   POST   → validate → build Meta components → submit (or edit-and-resubmit
 *            a rejected/paused template of the same name) → store locally
 *            with Meta's returned status.
 *   DELETE → remove from Meta + local catalog
 *
 * Status then moves PENDING → APPROVED/REJECTED via the
 * `message_template_status_update` webhook (see webhook.controller.ts) and
 * the manual/auto sync route (templates/sync).
 */

const MAX_MEDIA_BYTES = 16 * 1024 * 1024

// ─────────────────────────────────────────────────────────────
// GET — list templates
// ─────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const ctx = await requireTenant()
    if (!ctx.ok) return ctx.response

    const templates = await prisma.messageTemplate.findMany({
      where: { tenantId: ctx.value.tenantId },
      orderBy: { updatedAt: 'desc' },
    })

    return NextResponse.json({
      templates: templates.map((t) => ({
        id: t.id,
        user_id: t.userId,
        name: t.name,
        category: t.category,
        language: t.language,
        header_type: t.headerType,
        header_content: t.headerContent,
        body_text: t.bodyText,
        footer_text: t.footerText,
        buttons: t.buttons,
        status: t.status,
        event_type: t.eventType,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      })),
    })
  } catch (error) {
    console.error('Error listing templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Resolve the header media into a Meta upload handle. */
async function resolveMediaHandle(sample: string, accessToken: string): Promise<string> {
  const value = sample.trim()
  if (isMediaHandle(value)) return value
  if (!/^https:\/\//i.test(value)) {
    throw new MetaApiError('Upload a sample file for the media header (or provide a public https:// link).', 400)
  }
  const res = await fetch(value, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new MetaApiError(`Could not download the sample media (HTTP ${res.status}).`, 400)
  const bytes = await res.arrayBuffer()
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new MetaApiError('Sample media must be 16 MB or smaller.', 400)
  const mimeType = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]
  return uploadTemplateMedia({ accessToken, bytes, mimeType })
}

function isDuplicateNameError(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false
  return err.subcode === 2388023 || err.subcode === 2388024 || /already exists|being deleted/i.test(err.message)
}

// ─────────────────────────────────────────────────────────────
// POST — submit to Meta + save
// ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireTenant()
    if (!ctx.ok) return ctx.response
    const { userId, tenantId } = ctx.value

    const limit = checkRateLimit(`template-submit:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    let raw: Record<string, unknown>
    try {
      raw = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }
    const draft = draftFromBody(raw)

    // Same rules the builder shows live — last line of defence.
    const errors = validateTemplate(draft).filter((i) => i.severity === 'error')
    if (errors.length) {
      return NextResponse.json({ error: errors[0].message, issues: errors }, { status: 400 })
    }

    const creds = await requireWhatsAppCreds(tenantId)
    if (!creds.ok) return creds.response
    const { wabaId, accessToken } = creds.value

    const category = toMetaCategory(draft.category)
    let mediaHandle: string | undefined
    let metaStatus = 'PENDING'
    let metaId: string | undefined
    let resubmitted = false

    try {
      if (['image', 'video', 'document'].includes(draft.header_type) && draft.category !== 'Authentication') {
        mediaHandle = await resolveMediaHandle(draft.header_example, accessToken)
      }
      const { components } = buildComponents(draft, mediaHandle)

      try {
        const created = await createMessageTemplate({
          wabaId,
          accessToken,
          name: draft.name,
          language: draft.language,
          category,
          components,
        })
        metaStatus = created.status
        metaId = created.id
      } catch (err) {
        if (!isDuplicateNameError(err)) throw err

        // A template with this name+language already exists on Meta. If it was
        // rejected or paused we can edit it in place, which re-queues review.
        const { templates } = await listMessageTemplates({ wabaId, accessToken, name: draft.name })
        const existing = templates.find((t) => t.name === draft.name && t.language === draft.language)
        const editable = existing && ['REJECTED', 'PAUSED'].includes(existing.status.toUpperCase())
        if (!existing || !editable) {
          const state = existing ? existing.status.toLowerCase() : 'existing'
          return NextResponse.json(
            {
              error: `A ${state} template named "${draft.name}" (${draft.language}) already exists on Meta. Choose a different name${existing?.status === 'APPROVED' ? ', or sync from Meta to see it' : ''}.`,
              code: 'DUPLICATE_NAME',
            },
            { status: 409 },
          )
        }
        await editMessageTemplate({ templateId: existing.id, accessToken, components })
        metaStatus = 'PENDING'
        metaId = existing.id
        resubmitted = true
      }
    } catch (err) {
      console.error('Meta template submission failed:', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      return NextResponse.json(
        { error: `Meta did not accept the template: ${message}` },
        { status: err instanceof MetaApiError && err.httpStatus >= 500 ? 502 : 400 },
      )
    }

    const { localButtons } = buildComponents(draft, mediaHandle)
    const isAuth = draft.category === 'Authentication'
    const headerType = !isAuth && draft.header_type !== 'none' ? draft.header_type : null
    const data = {
      tenantId,
      userId,
      name: draft.name,
      category: draft.category,
      language: draft.language,
      headerType,
      headerContent: headerType === 'text' ? draft.header_text.trim() || null : null,
      bodyText: isAuth ? '{{1}} is your verification code.' : draft.body_text.trim(),
      footerText: isAuth
        ? draft.auth?.code_expiration_minutes
          ? `This code expires in ${draft.auth.code_expiration_minutes} minutes.`
          : null
        : draft.footer_text.trim() || null,
      buttons: localButtons ? (localButtons as unknown as object) : undefined,
      status: toLocalStatus(metaStatus),
    }

    const existingLocal = await prisma.messageTemplate.findFirst({
      where: { tenantId, name: draft.name, language: draft.language },
      select: { id: true },
    })
    const saved = existingLocal
      ? await prisma.messageTemplate.update({ where: { id: existingLocal.id }, data })
      : await prisma.messageTemplate.create({ data })

    return NextResponse.json({
      success: true,
      meta_status: metaStatus,
      meta_id: metaId,
      resubmitted,
      template: { id: saved.id, name: saved.name, language: saved.language, status: saved.status },
    })
  } catch (error) {
    console.error('Error submitting template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE — remove from Meta + local
// ─────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireTenant()
    if (!ctx.ok) return ctx.response
    const { tenantId } = ctx.value

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Template id is required.' }, { status: 400 })

    const template = await prisma.messageTemplate.findFirst({ where: { id, tenantId } })
    if (!template) return NextResponse.json({ error: 'Template not found.' }, { status: 404 })

    let metaWarning: string | undefined
    if (template.status !== 'Draft') {
      const creds = await requireWhatsAppCreds(tenantId)
      if (creds.ok) {
        try {
          await deleteMessageTemplate({ wabaId: creds.value.wabaId, accessToken: creds.value.accessToken, name: template.name })
        } catch (err) {
          // Already gone on Meta, token issue, etc. — don't block the local delete.
          console.warn('Meta template delete failed (continuing):', err)
          metaWarning = err instanceof Error ? err.message : 'Meta delete failed'
        }
      }
    }

    await prisma.messageTemplate.delete({ where: { id: template.id } })
    return NextResponse.json({ success: true, meta_warning: metaWarning })
  } catch (error) {
    console.error('Error deleting template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
