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

type Params = { params: Promise<{ stageId: string }> }

/** DELETE /api/pipelines/stages/[stageId] — remove a stage (only if no deals) */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { stageId } = await params

    // Verify stage belongs to a pipeline owned by this tenant
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipeline: { tenantId: ctx.tenantId } },
    })
    if (!stage) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Check for deals in this stage
    const dealCount = await prisma.deal.count({ where: { stageId } })
    if (dealCount > 0) {
      return NextResponse.json(
        { error: 'Move or delete deals in this stage first' },
        { status: 409 },
      )
    }

    await prisma.pipelineStage.delete({ where: { id: stageId } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/pipelines/stages/[stageId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
