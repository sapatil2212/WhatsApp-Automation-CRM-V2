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

type Params = { params: Promise<{ id: string }> }

/** GET /api/pipelines/[id]/stages — list stages for a pipeline */
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

    const stages = await prisma.pipelineStage.findMany({
      where: { pipelineId },
      orderBy: { position: 'asc' },
    })

    return NextResponse.json({ stages })
  } catch (err: any) {
    console.error('[GET /api/pipelines/[id]/stages]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** POST /api/pipelines/[id]/stages — add a new stage */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: pipelineId } = await params

    // Verify pipeline belongs to tenant
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, tenantId: ctx.tenantId },
    })
    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    const name = body?.name?.trim()
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const color = body?.color || '#3b82f6'
    const maxPos = await prisma.pipelineStage.aggregate({
      where: { pipelineId },
      _max: { position: true },
    })
    const position = (maxPos._max.position ?? -1) + 1

    const stage = await prisma.pipelineStage.create({
      data: { pipelineId, name, color, position },
    })

    return NextResponse.json({ stage }, { status: 201 })
  } catch (err: any) {
    console.error('[POST /api/pipelines/[id]/stages]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** PUT /api/pipelines/[id]/stages — bulk upsert stages (reorder + rename + color) */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: pipelineId } = await params

    // Verify pipeline belongs to tenant
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, tenantId: ctx.tenantId },
    })
    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    const stagesInput: Array<{ id: string; name: string; color: string; position: number }> =
      body?.stages ?? []

    if (!Array.isArray(stagesInput)) {
      return NextResponse.json({ error: 'stages must be an array' }, { status: 400 })
    }

    // Upsert each stage in a transaction
    const stages = await prisma.$transaction(
      stagesInput.map((s, i) =>
        prisma.pipelineStage.upsert({
          where: { id: s.id },
          update: { name: s.name, color: s.color, position: i },
          create: { id: s.id, pipelineId, name: s.name, color: s.color, position: i },
        }),
      ),
    )

    return NextResponse.json({ stages })
  } catch (err: any) {
    console.error('[PUT /api/pipelines/[id]/stages]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
