import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { invalidateClinicCache } from '@/lib/healthcare/clinic-cache'

async function getAuthContext() {
  // 1. Try JWT cookies with Prisma
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
      email: payload.email,
    }
  }

  // 2. Fallback to Supabase
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const profile = await prisma.profile.findUnique({ where: { userId: user.id } })
      return {
        userId: user.id,
        tenantId: profile?.tenantId || user.id,
        email: user.email || '',
      }
    }
  } catch {
    // Ignore fallback errors
  }

  return null
}

async function getOrCreateClinic(userId: string, tenantId: string) {
  let clinic = await prisma.clinic.findUnique({
    where: { userId },
    include: {
      faqs: { orderBy: { createdAt: 'desc' } },
      doctors: true,
      services: true,
      timings: true,
    },
  })

  if (!clinic) {
    clinic = await prisma.clinic.findFirst({
      where: { tenantId },
      include: {
        faqs: { orderBy: { createdAt: 'desc' } },
        doctors: true,
        services: true,
        timings: true,
      },
    })
  }

  if (!clinic) {
    const profile = await prisma.profile.findUnique({ where: { userId } })
    clinic = await prisma.clinic.create({
      data: {
        userId,
        tenantId,
        clinicName: profile?.fullName ? `${profile.fullName}'s Clinic` : 'My Clinic',
        aiKnowledgeBase: '',
      },
      include: {
        faqs: { orderBy: { createdAt: 'desc' } },
        doctors: true,
        services: true,
        timings: true,
      },
    })
  }

  return clinic
}

/**
 * GET — Retrieve the authenticated clinic's knowledge base, FAQs, and metadata.
 */
export async function GET(_req: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clinic = await getOrCreateClinic(ctx.userId, ctx.tenantId)

    const knowledgeText = clinic.aiKnowledgeBase || ''
    const wordCount = knowledgeText.trim() ? knowledgeText.trim().split(/\s+/).length : 0

    return NextResponse.json({
      clinic: {
        id: clinic.id,
        tenantId: clinic.tenantId,
        clinicName: clinic.clinicName,
        clinicDescription: clinic.clinicDescription,
        phone: clinic.phone,
        email: clinic.email,
        website: clinic.website,
        address: clinic.address,
        aiKnowledgeBase: knowledgeText,
        updatedAt: clinic.updatedAt,
      },
      faqs: clinic.faqs,
      stats: {
        faqCount: clinic.faqs.length,
        kbCharacters: knowledgeText.length,
        kbWords: wordCount,
        doctorsCount: clinic.doctors.length,
        servicesCount: clinic.services.length,
      },
    })
  } catch (error: any) {
    console.error('[KnowledgeBase GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST — Direct update of the clinic's aiKnowledgeBase text.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { aiKnowledgeBase } = body

    if (typeof aiKnowledgeBase !== 'string') {
      return NextResponse.json({ error: 'aiKnowledgeBase must be a string' }, { status: 400 })
    }

    const clinic = await getOrCreateClinic(ctx.userId, ctx.tenantId)

    const updated = await prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        aiKnowledgeBase: aiKnowledgeBase.trim(),
      },
    })

    // Invalidate in-memory cache so WhatsApp auto-responder immediately uses new knowledge
    invalidateClinicCache(ctx.userId)

    return NextResponse.json({
      success: true,
      aiKnowledgeBase: updated.aiKnowledgeBase,
      updatedAt: updated.updatedAt,
    })
  } catch (error: any) {
    console.error('[KnowledgeBase POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
