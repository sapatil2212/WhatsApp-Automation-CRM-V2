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
          id: deal.contact.id,
          name: deal.contact.name,
          phone: deal.contact.phone,
          email: deal.contact.email,
          avatar_url: deal.contact.avatarUrl,
        }
      : null,
    // map camelCase to snake_case for the existing frontend type
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

/** GET /api/pipelines/[id]/deals — list deals for a pipeline with contact + stage data */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: pipelineId } = await params

    // Verify pipeline belongs to tenant
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, tenantId: ctx.tenantId },
    })
    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const deals = await prisma.deal.findMany({
      where: { pipelineId, tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        contact: {
          select: { id: true, name: true, phone: true, email: true, avatarUrl: true },
        },
        stage: {
          select: { id: true, name: true, color: true, position: true },
        },
      },
    })

    return NextResponse.json({ deals: deals.map(serializeDeal) })
  } catch (err: any) {
    console.error('[GET /api/pipelines/[id]/deals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
