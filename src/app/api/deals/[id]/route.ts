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

type Params = { params: Promise<{ id: string }> }

/** PATCH /api/deals/[id] — update deal fields */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await prisma.deal.findFirst({ where: { id, tenantId: ctx.tenantId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const updateData: Record<string, any> = {}
    if (body.title !== undefined) updateData.title = body.title.trim()
    if (body.value !== undefined) updateData.value = parseFloat(body.value) || 0
    if (body.currency !== undefined) updateData.currency = body.currency
    if (body.stage_id !== undefined) updateData.stageId = body.stage_id
    if (body.contact_id !== undefined) updateData.contactId = body.contact_id || null
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null
    if (body.expected_close_date !== undefined) {
      updateData.expectedCloseDate = body.expected_close_date
        ? new Date(body.expected_close_date)
        : null
    }
    if (body.status !== undefined) updateData.status = body.status

    const deal = await prisma.deal.update({
      where: { id },
      data: updateData,
      include: {
        contact: { select: { id: true, name: true, phone: true, email: true, avatarUrl: true } },
        stage: { select: { id: true, name: true, color: true, position: true } },
      },
    })

    return NextResponse.json({ deal: serializeDeal(deal) })
  } catch (err: any) {
    console.error('[PATCH /api/deals/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** DELETE /api/deals/[id] — delete a deal */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await prisma.deal.findFirst({ where: { id, tenantId: ctx.tenantId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.deal.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/deals/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
