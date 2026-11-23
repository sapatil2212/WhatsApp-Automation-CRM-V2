import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { invalidateClinicCacheForTenant } from '@/lib/healthcare/clinic-cache'

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
      email: payload.email,
    }
  }

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
    // Ignore
  }

  return null
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { knowledgeBaseText, faqs, replaceFaqs = false, appendKnowledge = false, businessDetails } = body

    // knowledgeBaseText omitted → leave the stored knowledge base untouched
    // (e.g. adding a single FAQ must not overwrite unsaved editor text).
    if (knowledgeBaseText !== undefined && typeof knowledgeBaseText !== 'string') {
      return NextResponse.json({ error: 'knowledgeBaseText must be a string' }, { status: 400 })
    }
    const incomingKb = typeof knowledgeBaseText === 'string' ? knowledgeBaseText.trim() : undefined

    // Find or create clinic
    let clinic = await prisma.clinic.findUnique({ where: { userId: ctx.userId } })
    if (!clinic) {
      clinic = await prisma.clinic.findFirst({ where: { tenantId: ctx.tenantId } })
    }
    if (!clinic) {
      const profile = await prisma.profile.findUnique({ where: { userId: ctx.userId } })
      clinic = await prisma.clinic.create({
        data: {
          userId: ctx.userId,
          tenantId: ctx.tenantId,
          clinicName: businessDetails?.clinicName || (profile?.fullName ? `${profile.fullName}'s Clinic` : 'My Clinic'),
          aiKnowledgeBase: incomingKb ?? '',
        },
      })
    }

    const clinicId = clinic.id

    // Update clinic ground-truth text and optional business details
    const existingKb = (clinic.aiKnowledgeBase || '').trim()
    const nextKb =
      incomingKb === undefined
        ? existingKb
        : appendKnowledge && existingKb && incomingKb
          ? `${existingKb}\n\n${incomingKb}`
          : incomingKb
    const clinicUpdateData: any = {
      aiKnowledgeBase: nextKb,
    }

    if (businessDetails?.clinicName && (!clinic.clinicName || clinic.clinicName === 'My Clinic')) {
      clinicUpdateData.clinicName = businessDetails.clinicName
    }
    if (businessDetails?.phone && !clinic.phone) {
      clinicUpdateData.phone = businessDetails.phone
    }
    if (businessDetails?.email && !clinic.email) {
      clinicUpdateData.email = businessDetails.email
    }
    if (businessDetails?.address && !clinic.address) {
      clinicUpdateData.address = businessDetails.address
    }

    // Execute updates in transaction
    await prisma.$transaction(async (tx) => {
      await tx.clinic.update({
        where: { id: clinicId },
        data: clinicUpdateData,
      })

      if (Array.isArray(faqs) && faqs.length > 0) {
        if (replaceFaqs) {
          // Delete existing FAQs
          await tx.clinicFAQ.deleteMany({
            where: { clinicId },
          })
        }

        // Filter and sanitize new FAQs
        const validFaqs = faqs
          .filter((f) => f && f.question && f.answer)
          .map((f) => ({
            clinicId,
            question: String(f.question).trim(),
            answer: String(f.answer).trim(),
            keywords: f.keywords ? String(f.keywords).trim() : null,
          }))

        if (validFaqs.length > 0) {
          await tx.clinicFAQ.createMany({
            data: validFaqs,
          })
        }
      }
    })

    // Invalidate clinic cache so WhatsApp AI assistant immediately learns the new knowledge
    invalidateClinicCacheForTenant(ctx.tenantId)

    const updatedFaqs = await prisma.clinicFAQ.findMany({
      where: { clinicId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      message: 'Knowledge base and FAQs successfully updated for your clinic.',
      clinicId,
      faqCount: updatedFaqs.length,
      faqs: updatedFaqs,
      aiKnowledgeBase: nextKb,
    })
  } catch (error: any) {
    console.error('[KnowledgeBase Save Error]:', error)
    return NextResponse.json({ error: error.message || 'Internal server error while saving' }, { status: 500 })
  }
}
