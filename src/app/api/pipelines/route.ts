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
    const name = body?.name?.trim()?.slice(0, 80)
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const withDefaultStages = body?.withDefaultStages !== false // default true

    // Optional custom stage list (templates / AI designer). Sanitised here so
    // a malformed payload can never create an unusable pipeline.
    const customStages: Array<{ name: string; color: string }> | null = Array.isArray(body?.stages)
      ? body.stages
          .map((s: { name?: unknown; color?: unknown }) => ({
            name: String(s?.name ?? '').trim().slice(0, 60),
            color: /^#[0-9a-f]{6}$/i.test(String(s?.color ?? '')) ? String(s.color) : '#3b82f6',
          }))
          .filter((s: { name: string }) => s.name)
          .slice(0, 12)
      : null
    if (customStages && customStages.length < 2) {
      return NextResponse.json({ error: 'A pipeline needs at least two stages.' }, { status: 400 })
    }

    const pipeline = await prisma.$transaction(async (tx) => {
      const p = await tx.pipeline.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          name,
        },
      })

      if (customStages) {
        await tx.pipelineStage.createMany({
          data: customStages.map((s, position) => ({ pipelineId: p.id, name: s.name, color: s.color, position })),
        })
      } else if (withDefaultStages) {
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
