import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

async function getAuthContext() {
  const cookieStore = await cookies()
  let accessToken = cookieStore.get('accessToken')?.value
  const refreshToken = cookieStore.get('refreshToken')?.value

  let payload = accessToken ? verifyAccessToken(accessToken) : null
  if (!payload && refreshToken) {
    const rotation = await rotateRefreshToken(refreshToken)
    if (rotation) payload = rotation.user
  }
  if (!payload) return null

  const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } })
  if (!profile?.tenantId) return null

  return { userId: payload.userId, tenantId: profile.tenantId }
}

function serializeDeal(deal: any) {
  return {
    ...deal,
    value: Number(deal.value ?? 0),
    contact: deal.contact
      ? {
          ...deal.contact,
          avatar_url: deal.contact.avatarUrl,
        }
      : null,
    pipeline_id: deal.pipelineId,
    stage_id: deal.stageId,
    contact_id: deal.contactId,
    conversation_id: deal.conversationId,
    assigned_to: deal.assignedTo,
    expected_close_date: deal.expectedCloseDate
      ? new Date(deal.expectedCloseDate).toISOString().split('T')[0]
      : null,
    created_at: deal.createdAt,
    updated_at: deal.updatedAt,
  }
}

/** POST /api/deals — create a new deal */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { title, value, currency, contact_id, pipeline_id, stage_id, notes, expected_close_date } = body

    if (!title?.trim() || !contact_id || !pipeline_id || !stage_id) {
      return NextResponse.json(
        { error: 'title, contact_id, pipeline_id, and stage_id are required' },
        { status: 400 },
      )
    }

    // Verify pipeline belongs to tenant
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipeline_id, tenantId: ctx.tenantId },
    })
    if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const deal = await prisma.deal.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        pipelineId: pipeline_id,
        stageId: stage_id,
        contactId: contact_id,
        title: title.trim(),
        value: parseFloat(value) || 0,
        currency: currency || 'USD',
        notes: notes?.trim() || null,
        expectedCloseDate: expected_close_date ? new Date(expected_close_date) : null,
        status: 'active',
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, email: true, avatarUrl: true } },
        stage: { select: { id: true, name: true, color: true, position: true } },
      },
    })

    return NextResponse.json({ deal: serializeDeal(deal) }, { status: 201 })
  } catch (err: any) {
    console.error('[POST /api/deals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
