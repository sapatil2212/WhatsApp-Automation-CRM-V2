import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { listMessageTemplates, type MetaTemplateListEntry } from '@/lib/whatsapp/meta-api'
import { fromMetaCategory, toLocalStatus } from '@/lib/whatsapp/template-payload'
import { requireTenant, requireWhatsAppCreds } from '@/lib/whatsapp/template-context'

/**
 * Pull templates from Meta (the source of truth for status) into this
 * tenant's local catalog, upserting by (tenant, name, language).
 *
 * Also returns per-template details the catalog has no column for —
 * rejection reason, quality rating, Meta id — so the UI can explain *why*
 * a template was rejected. Local-only templates are never deleted.
 */

interface MetaComponent {
  type: string
  text?: string
  format?: string
  buttons?: unknown[]
}

const PAGE_CAP = 20

export async function POST() {
  try {
    const ctx = await requireTenant()
    if (!ctx.ok) return ctx.response
    const { tenantId, userId } = ctx.value

    const creds = await requireWhatsAppCreds(tenantId)
    if (!creds.ok) return creds.response

    const metaTemplates: MetaTemplateListEntry[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      pages++
      const page = await listMessageTemplates({ ...creds.value, after: cursor })
      metaTemplates.push(...page.templates)
      cursor = page.nextCursor ?? undefined
    } while (cursor && pages < PAGE_CAP)

    const existing = await prisma.messageTemplate.findMany({
      where: { tenantId },
      select: { id: true, name: true, language: true, status: true },
    })
    const byKey = new Map(existing.map((t) => [`${t.name}:${t.language}`, t]))

    let inserted = 0
    let updated = 0
    const changes: Array<{ name: string; language: string; from: string | null; to: string }> = []
    const errors: Array<{ name: string; language: string; message: string }> = []

    for (const t of metaTemplates) {
      const components = (t.components ?? []) as MetaComponent[]
      const find = (type: string) => components.find((c) => c.type === type)
      const header = find('HEADER')
      const status = toLocalStatus(t.status)
      const data = {
        name: t.name,
        category: fromMetaCategory(t.category),
        language: t.language,
        headerType: header?.format?.toLowerCase() ?? null,
        headerContent: header?.text ?? null,
        bodyText: find('BODY')?.text ?? '',
        footerText: find('FOOTER')?.text ?? null,
        buttons: (find('BUTTONS')?.buttons as object | undefined) ?? undefined,
        status,
      }
      const local = byKey.get(`${t.name}:${t.language}`)
      try {
        if (local) {
          await prisma.messageTemplate.update({ where: { id: local.id }, data })
          updated++
          if (local.status !== status) changes.push({ name: t.name, language: t.language, from: local.status, to: status })
        } else {
          await prisma.messageTemplate.create({ data: { ...data, tenantId, userId } })
          inserted++
          changes.push({ name: t.name, language: t.language, from: null, to: status })
        }
      } catch (err) {
        errors.push({ name: t.name, language: t.language, message: err instanceof Error ? err.message : 'write failed' })
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      changes,
      errors,
      truncated: Boolean(cursor),
      synced_at: new Date().toISOString(),
      details: metaTemplates.map((t) => ({
        meta_id: t.id,
        name: t.name,
        language: t.language,
        meta_status: t.status,
        rejected_reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
        quality: t.quality_score?.score ?? null,
      })),
    })
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync templates' },
      { status: 502 },
    )
  }
}
