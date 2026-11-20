import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import { invalidateClinicCache } from '@/lib/healthcare/clinic-cache'

async function getAuthContext() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('accessToken')?.value
  const refreshToken = cookieStore.get('refreshToken')?.value

  let payload = accessToken ? verifyAccessToken(accessToken) : null

  if (!payload && refreshToken) {
    const rotation = await rotateRefreshToken(refreshToken)
    if (rotation) payload = rotation.user
  }

  if (payload) {
    const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } })
    return {
      userId: payload.userId,
      tenantId: profile?.tenantId || payload.userId,
    }
  }

  return null
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { question, answer, keywords } = body

    if (!question || !answer) {
      return NextResponse.json({ error: 'Question and answer are required' }, { status: 400 })
    }

    // Verify FAQ belongs to clinic of user/tenant
    const faq = await prisma.clinicFAQ.findUnique({
      where: { id },
      include: { clinic: true },
    })

    if (!faq || (faq.clinic.userId !== ctx.userId && faq.clinic.tenantId !== ctx.tenantId)) {
      return NextResponse.json({ error: 'FAQ not found or unauthorized' }, { status: 404 })
    }

    const updated = await prisma.clinicFAQ.update({
      where: { id },
      data: {
        question: question.trim(),
        answer: answer.trim(),
        keywords: typeof keywords === 'string' ? keywords.trim() : null,
      },
    })

    invalidateClinicCache(ctx.userId)

    return NextResponse.json({ success: true, faq: updated })
  } catch (error: any) {
    console.error('[FAQ PUT] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const faq = await prisma.clinicFAQ.findUnique({
      where: { id },
      include: { clinic: true },
    })

    if (!faq || (faq.clinic.userId !== ctx.userId && faq.clinic.tenantId !== ctx.tenantId)) {
      return NextResponse.json({ error: 'FAQ not found or unauthorized' }, { status: 404 })
    }

    await prisma.clinicFAQ.delete({
      where: { id },
    })

    invalidateClinicCache(ctx.userId)

    return NextResponse.json({ success: true, message: 'FAQ deleted successfully' })
  } catch (error: any) {
    console.error('[FAQ DELETE] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
