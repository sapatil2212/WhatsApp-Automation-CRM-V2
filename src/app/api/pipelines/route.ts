import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

const SPEC_DEFAULT_STAGES = [
  { name: 'New Lead', color: '#3b82f6', position: 0 },
  { name: 'Qualified', color: '#eab308', position: 1 },
  { name: 'Proposal Sent', color: '#f97316', position: 2 },
  { name: 'Negotiation', color: '#8b5cf6', position: 3 },
  { name: 'Won', color: '#22c55e', position: 4 },
]

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

/** GET /api/pipelines — list all pipelines for the current tenant */
export async function GET() {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const pipelines = await prisma.pipeline.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'asc' },
      include: {
        stages: { orderBy: { position: 'asc' } },
        _count: { select: { deals: true } },
      },
    })

    return NextResponse.json({ pipelines })
  } catch (err: any) {
    console.error('[GET /api/pipelines]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** POST /api/pipelines — create a pipeline, optionally with default stages */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const name = body?.name?.trim()
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const withDefaultStages = body?.withDefaultStages !== false // default true

    const pipeline = await prisma.$transaction(async (tx) => {
      const p = await tx.pipeline.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          name,
        },
      })

      if (withDefaultStages) {
        await tx.pipelineStage.createMany({
          data: SPEC_DEFAULT_STAGES.map((s) => ({
            pipelineId: p.id,
            name: s.name,
            color: s.color,
            position: s.position,
          })),
        })
      }

      return tx.pipeline.findUnique({
        where: { id: p.id },
        include: { stages: { orderBy: { position: 'asc' } } },
      })
    })

    return NextResponse.json({ pipeline }, { status: 201 })
  } catch (err: any) {
    console.error('[POST /api/pipelines]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
