import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import {
  createMessageTemplate,
  deleteMessageTemplate,
  TEMPLATE_LIMITS,
  type MetaTemplateCategory,
  type MetaTemplateComponentInput,
  type MetaTemplateButtonInput,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * WhatsApp Message Template management with Meta's approval workflow.
 *
 *   GET    → list this tenant's templates (local catalog)
 *   POST   → build the Meta component payload, submit for approval,
 *            store locally with the returned status (Pending/Approved)
 *   DELETE → remove from Meta + local catalog
 *
 * This is the piece that was missing: the old Settings UI only wrote
 * Drafts to the DB and never told Meta about them, so broadcasts using
 * those names failed with #132001. Now a template can travel the full
 * lifecycle — Draft → submit → Pending → Approved — from inside the app,
 * including call-to-action (URL / phone) and quick-reply buttons.
 */

// ── auth (mirrors /api/whatsapp/config) ──────────────────────
async function getAuthUser() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('accessToken')?.value
  const refreshToken = cookieStore.get('refreshToken')?.value

  let payload = accessToken ? verifyAccessToken(accessToken) : null
  if (!payload && refreshToken) {
    const rotation = await rotateRefreshToken(refreshToken)
    if (rotation) payload = rotation.user
  }
  return payload
}

// ── category / status normalization ─────────────────────────
function toMetaCategory(c: string): MetaTemplateCategory {
  switch (c.toUpperCase()) {
    case 'UTILITY':
      return 'UTILITY'
    case 'AUTHENTICATION':
      return 'AUTHENTICATION'
    default:
      return 'MARKETING'
  }
}

function toLocalStatus(
  meta: string,
): 'Draft' | 'Pending' | 'Approved' | 'Rejected' {
  switch (meta.toUpperCase()) {
    case 'APPROVED':
      return 'Approved'
    case 'REJECTED':
    case 'DISABLED':
    case 'PAUSED':
      return 'Rejected'
    case 'PENDING':
    default:
      return 'Pending'
  }
}

// ── request shape from the builder UI ────────────────────────
interface TemplateButtonInput {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'
  text: string
  url?: string
  phone_number?: string
  /** sample value for a URL button that uses a {{1}} suffix */
  example?: string
}

interface TemplateRequestBody {
  name: string
  category: string
  language: string
  header_type?: 'none' | 'text' | 'image' | 'video' | 'document'
  header_text?: string
  /** sample media URL for a media header (required by Meta on submit) */
  header_example?: string
  /** sample values for {{1}}..{{n}} in a TEXT header */
  header_text_example?: string[]
  body_text: string
  /** sample values for {{1}}..{{n}} in the body */
  body_example?: string[]
  footer_text?: string
  buttons?: TemplateButtonInput[]
}

/**
 * Count the highest {{n}} placeholder in a string. Meta requires
 * `example` values for every placeholder, and the numbering must be
 * gap-free (1..n) — we surface both problems before submitting.
 */
function placeholderCount(text: string): { max: number; gapFree: boolean } {
  const nums = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) =>
    Number(m[1]),
  )
  if (nums.length === 0) return { max: 0, gapFree: true }
  const unique = [...new Set(nums)].sort((a, b) => a - b)
  const max = unique[unique.length - 1]
  const gapFree = unique.every((n, i) => n === i + 1)
  return { max, gapFree }
}

/**
 * Assemble + validate the Meta components array from the builder body.
 * Throws Error(message) on the first validation failure.
 */
function buildComponents(body: TemplateRequestBody): {
  components: MetaTemplateComponentInput[]
  localButtons: MetaTemplateButtonInput[] | null
} {
  const components: MetaTemplateComponentInput[] = []

  // HEADER ---------------------------------------------------
  const headerType = body.header_type ?? 'none'
  if (headerType === 'text') {
    const text = (body.header_text ?? '').trim()
    if (!text) throw new Error('Text header selected but header text is empty.')
    if (text.length > TEMPLATE_LIMITS.headerTextMaxLength) {
      throw new Error(
        `Header text exceeds ${TEMPLATE_LIMITS.headerTextMaxLength} characters.`,
      )
    }
    const { max, gapFree } = placeholderCount(text)
    if (max > 1) throw new Error('A text header supports at most one {{1}} variable.')
    if (!gapFree) throw new Error('Header variables must be numbered starting at {{1}}.')
    const header: MetaTemplateComponentInput = { type: 'HEADER', format: 'TEXT', text }
    if (max === 1) {
      const sample = body.header_text_example?.[0]
      if (!sample) throw new Error('Provide a sample value for the header {{1}} variable.')
      header.example = { header_text: [sample] }
    }
    components.push(header)
  } else if (headerType === 'image' || headerType === 'video' || headerType === 'document') {
    const sample = (body.header_example ?? '').trim()
    if (!sample) {
      throw new Error(
        `A ${headerType} header requires a sample media URL so Meta can review it.`,
      )
    }
    components.push({
      type: 'HEADER',
      format: headerType.toUpperCase() as 'IMAGE' | 'VIDEO' | 'DOCUMENT',
      example: { header_handle: [sample] },
    })
  }

  // BODY -----------------------------------------------------
  const bodyText = (body.body_text ?? '').trim()
  if (!bodyText) throw new Error('Body text is required.')
  if (bodyText.length > TEMPLATE_LIMITS.bodyMaxLength) {
    throw new Error(`Body text exceeds ${TEMPLATE_LIMITS.bodyMaxLength} characters.`)
  }
  const bodyPh = placeholderCount(bodyText)
  if (!bodyPh.gapFree) {
    throw new Error('Body variables must be sequential starting at {{1}} with no gaps.')
  }
  const bodyComponent: MetaTemplateComponentInput = { type: 'BODY', text: bodyText }
  if (bodyPh.max > 0) {
    const examples = (body.body_example ?? []).map((s) => (s ?? '').trim())
    if (examples.length < bodyPh.max || examples.some((s) => !s)) {
      throw new Error(
        `Provide a sample value for each of the ${bodyPh.max} body variable(s).`,
      )
    }
    bodyComponent.example = { body_text: [examples.slice(0, bodyPh.max)] }
  }
  components.push(bodyComponent)

  // FOOTER ---------------------------------------------------
  const footer = (body.footer_text ?? '').trim()
  if (footer) {
    if (footer.length > TEMPLATE_LIMITS.footerMaxLength) {
      throw new Error(`Footer exceeds ${TEMPLATE_LIMITS.footerMaxLength} characters.`)
    }
    components.push({ type: 'FOOTER', text: footer })
  }

  // BUTTONS --------------------------------------------------
  let localButtons: MetaTemplateButtonInput[] | null = null
  const rawButtons = (body.buttons ?? []).filter((b) => b.text?.trim())
  if (rawButtons.length > 0) {
    if (rawButtons.length > TEMPLATE_LIMITS.maxButtons) {
      throw new Error(`A template supports at most ${TEMPLATE_LIMITS.maxButtons} buttons.`)
    }
    let urlCount = 0
    let phoneCount = 0
    let quickCount = 0
    const buttons: MetaTemplateButtonInput[] = rawButtons.map((b) => {
      const text = b.text.trim()
      if (text.length > TEMPLATE_LIMITS.buttonTextMaxLength) {
        throw new Error(
          `Button "${text}" exceeds ${TEMPLATE_LIMITS.buttonTextMaxLength} characters.`,
        )
      }
      if (b.type === 'URL') {
        urlCount++
        const url = (b.url ?? '').trim()
        if (!url) throw new Error(`URL button "${text}" is missing its link.`)
        if (!/^https?:\/\//i.test(url)) {
          throw new Error(`URL button "${text}" link must start with http(s)://`)
        }
        const btn: MetaTemplateButtonInput = { type: 'URL', text, url }
        if (/\{\{\s*1\s*\}\}/.test(url)) {
          const sample = (b.example ?? '').trim()
          if (!sample) {
            throw new Error(
              `URL button "${text}" uses {{1}} — provide a sample URL suffix.`,
            )
          }
          btn.example = [sample]
        }
        return btn
      }
      if (b.type === 'PHONE_NUMBER') {
        phoneCount++
        const phone = (b.phone_number ?? '').trim()
        if (!/^\+?[1-9]\d{6,14}$/.test(phone)) {
          throw new Error(`Call button "${text}" needs a valid phone number in E.164.`)
        }
        return { type: 'PHONE_NUMBER', text, phone_number: phone }
      }
      quickCount++
      return { type: 'QUICK_REPLY', text }
    })
    if (urlCount > TEMPLATE_LIMITS.maxUrlButtons) {
      throw new Error(`At most ${TEMPLATE_LIMITS.maxUrlButtons} URL buttons are allowed.`)
    }
    if (phoneCount > TEMPLATE_LIMITS.maxPhoneButtons) {
      throw new Error(`At most ${TEMPLATE_LIMITS.maxPhoneButtons} call button is allowed.`)
    }
    if (quickCount > TEMPLATE_LIMITS.maxQuickReply) {
      throw new Error(`At most ${TEMPLATE_LIMITS.maxQuickReply} quick-reply buttons are allowed.`)
    }
    components.push({ type: 'BUTTONS', buttons })
    localButtons = buttons
  }

  return { components, localButtons }
}

// ─────────────────────────────────────────────────────────────
// GET — list templates
// ─────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const payload = await getAuthUser()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.profile.findUnique({
      where: { userId: payload.userId },
    })
    if (!profile?.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }

    const templates = await prisma.messageTemplate.findMany({
      where: { tenantId: profile.tenantId },
      orderBy: { createdAt: 'desc' },
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
        created_at: t.createdAt,
      })),
    })
  } catch (error) {
    console.error('Error listing templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────
// POST — submit to Meta + save
// ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthUser()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limit = checkRateLimit(`template-submit:${payload.userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    const profile = await prisma.profile.findUnique({
      where: { userId: payload.userId },
    })
    if (!profile?.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }

    const body = (await request.json()) as TemplateRequestBody

    const name = (body.name ?? '').trim().toLowerCase().replace(/\s+/g, '_')
    if (!name) return NextResponse.json({ error: 'Template name is required.' }, { status: 400 })
    if (!/^[a-z0-9_]+$/.test(name)) {
      return NextResponse.json(
        { error: 'Name may only contain lowercase letters, numbers and underscores.' },
        { status: 400 },
      )
    }
    if (name.length > TEMPLATE_LIMITS.nameMaxLength) {
      return NextResponse.json({ error: 'Template name is too long.' }, { status: 400 })
    }

    const language = (body.language ?? 'en_US').trim() || 'en_US'
    const category = toMetaCategory(body.category ?? 'Marketing')

    let components: MetaTemplateComponentInput[]
    let localButtons: MetaTemplateButtonInput[] | null
    try {
      const built = buildComponents(body)
      components = built.components
      localButtons = built.localButtons
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Invalid template' },
        { status: 400 },
      )
    }

    // Resolve credentials (need WABA id + token to submit to Meta).
    const config = await prisma.whatsappConfig.findUnique({
      where: { tenantId: profile.tenantId },
      select: { wabaId: true, accessToken: true },
    })
    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Connect your account in Settings first.' },
        { status: 400 },
      )
    }
    if (!config.wabaId) {
      return NextResponse.json(
        { error: 'WABA ID missing. Re-connect your WhatsApp Business account in Settings.' },
        { status: 400 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.accessToken)
    } catch {
      return NextResponse.json(
        { error: 'Stored access token could not be decrypted. Reset your config in Settings.' },
        { status: 400 },
      )
    }

    // Submit to Meta for approval.
    let metaStatus = 'PENDING'
    try {
      const result = await createMessageTemplate({
        wabaId: config.wabaId,
        accessToken,
        name,
        language,
        category,
        components,
      })
      metaStatus = result.status
    } catch (err) {
      console.error('Meta template submission failed. Details:', err);
      return NextResponse.json(
        {
          error: `Meta rejected the submission: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
        },
        { status: 400 },
      )
    }

    // Persist locally (upsert on name+language for this tenant).
    const headerType = body.header_type && body.header_type !== 'none' ? body.header_type : null
    const headerContent =
      body.header_type === 'text' ? (body.header_text ?? '').trim() || null : null

    const existing = await prisma.messageTemplate.findFirst({
      where: { tenantId: profile.tenantId, name, language },
      select: { id: true },
    })

    const data = {
      tenantId: profile.tenantId,
      userId: payload.userId,
      name,
      category: category.charAt(0) + category.slice(1).toLowerCase(),
      language,
      headerType,
      headerContent,
      bodyText: (body.body_text ?? '').trim(),
      footerText: (body.footer_text ?? '').trim() || null,
      buttons: localButtons ? (localButtons as unknown as object) : undefined,
      status: toLocalStatus(metaStatus),
    }

    const saved = existing
      ? await prisma.messageTemplate.update({ where: { id: existing.id }, data })
      : await prisma.messageTemplate.create({ data })

    return NextResponse.json({
      success: true,
      meta_status: metaStatus,
      template: {
        id: saved.id,
        name: saved.name,
        language: saved.language,
        status: saved.status,
      },
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
    const payload = await getAuthUser()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.profile.findUnique({
      where: { userId: payload.userId },
    })
    if (!profile?.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Template id is required.' }, { status: 400 })

    const template = await prisma.messageTemplate.findFirst({
      where: { id, tenantId: profile.tenantId },
    })
    if (!template) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    // Best-effort delete on Meta if it was ever submitted (not a Draft).
    if (template.status !== 'Draft') {
      const config = await prisma.whatsappConfig.findUnique({
        where: { tenantId: profile.tenantId },
        select: { wabaId: true, accessToken: true },
      })
      if (config?.wabaId) {
        try {
          const accessToken = decrypt(config.accessToken)
          await deleteMessageTemplate({
            wabaId: config.wabaId,
            accessToken,
            name: template.name,
          })
        } catch (err) {
          // Don't block local delete if Meta delete fails (already gone,
          // token issue, etc.) — surface as a soft warning.
          console.warn('Meta template delete failed (continuing):', err)
        }
      }
    }

    await prisma.messageTemplate.delete({ where: { id: template.id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
