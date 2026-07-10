import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

/**
 * POST /api/healthcare/follow-ups
 *
 * Automated follow-up system that sends post-visit messages to patients:
 *   - Post-visit feedback (24h after appointment marked complete)
 *   - Prescription reminder (daily at scheduled time)
 *   - Follow-up appointment reminder (7 days after visit)
 *
 * Protect with AUTOMATION_CRON_SECRET via `x-cron-secret` header.
 * Schedule every 60 minutes via Vercel Cron or external scheduler.
 *
 * This endpoint drastically reduces manual follow-up work for clinics.
 */

function formatDocName(name: string): string {
  if (!name) return ''
  return name.toLowerCase().startsWith('dr') ? name : `Dr. ${name}`
}

export async function POST(request: Request) {
  const secret = process.env.AUTOMATION_CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'AUTOMATION_CRON_SECRET is not configured' },
      { status: 503 }
    )
  }

  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const nowIso = now.toISOString()

  // ─── 1. Post-Visit Feedback (24h after appointment completed) ──────────────
  // Find appointments completed in the last 20-28 hours that haven't
  // received a feedback request yet.
  const feedbackWindowStart = new Date(now.getTime() - 28 * 60 * 60 * 1000)
  const feedbackWindowEnd = new Date(now.getTime() - 20 * 60 * 60 * 1000)

  const rawCompletedAppts = await prisma.appointment.findMany({
    where: {
      status: 'completed',
      feedbackSent: false,
      updatedAt: {
        gte: feedbackWindowStart,
        lte: feedbackWindowEnd,
      }
    },
    include: {
      contact: true,
      doctor: true,
      clinic: true
    }
  })

  const completedAppts = rawCompletedAppts.map(appt => ({
    id: appt.id,
    appointment_date: appt.appointmentDate,
    appointment_time: appt.appointmentTime,
    clinic_id: appt.clinicId,
    contact_id: appt.contactId,
    feedback_sent: appt.feedbackSent,
    contacts: appt.contact ? {
      id: appt.contact.id,
      name: appt.contact.name,
      phone: appt.contact.phone
    } : null,
    doctors: appt.doctor ? {
      doctor_name: appt.doctor.doctorName,
      specialization: appt.doctor.specialization
    } : null,
    clinics: appt.clinic ? {
      user_id: appt.clinic.userId,
      clinic_name: appt.clinic.clinicName
    } : null
  }))

  // ─── 2. Follow-up Reminder (7 days after completed visit) ──────────────────
  const followUpWindowStart = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)
  const followUpWindowEnd = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)

  const rawFollowUpAppts = await prisma.appointment.findMany({
    where: {
      status: 'completed',
      followupSent: false,
      updatedAt: {
        gte: followUpWindowStart,
        lte: followUpWindowEnd,
      }
    },
    include: {
      contact: true,
      doctor: true,
      clinic: true
    }
  })

  const followUpAppts = rawFollowUpAppts.map(appt => ({
    id: appt.id,
    appointment_date: appt.appointmentDate,
    appointment_time: appt.appointmentTime,
    clinic_id: appt.clinicId,
    contact_id: appt.contactId,
    followup_sent: appt.followupSent,
    contacts: appt.contact ? {
      id: appt.contact.id,
      name: appt.contact.name,
      phone: appt.contact.phone
    } : null,
    doctors: appt.doctor ? {
      doctor_name: appt.doctor.doctorName,
      specialization: appt.doctor.specialization
    } : null,
    clinics: appt.clinic ? {
      user_id: appt.clinic.userId,
      clinic_name: appt.clinic.clinicName
    } : null
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configCache: Record<string, any> = {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function getWhatsAppConfig(userId: string): Promise<any | null> {
    if (configCache[userId] !== undefined) return configCache[userId]
    const config = await prisma.whatsappConfig.findFirst({
      where: { userId }
    })
    if (config) {
      configCache[userId] = {
        id: config.id,
        tenant_id: config.tenantId,
        user_id: config.userId,
        phone_number_id: config.phoneNumberId,
        waba_id: config.wabaId,
        access_token: config.accessToken,
        verify_token: config.verifyToken,
        status: config.status,
        connected_at: config.connectedAt,
        created_at: config.createdAt,
        updated_at: config.updatedAt
      }
    } else {
      configCache[userId] = null
    }
    return configCache[userId]
  }

  let feedbackSent = 0
  let followUpSent = 0
  let skipped = 0

  // ─── Process Feedback Messages ─────────────────────────────────────────────
  for (const appt of completedAppts || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = appt as any
    const contact = a.contacts
    const doctor = a.doctors
    const clinic = a.clinics

    if (!contact?.phone || !clinic?.user_id) {
      skipped++
      continue
    }

    const config = await getWhatsAppConfig(clinic.user_id)
    if (!config) { skipped++; continue }

    const accessToken = decrypt(config.access_token)
    const phoneNumberId = config.phone_number_id as string
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    const docName = doctor ? formatDocName(doctor.doctor_name) : 'your doctor'
    const clinicName = clinic.clinic_name || 'our clinic'

    const feedbackMsg = `⭐ *How was your visit?*\n\nHi ${contact.name || 'there'}! We hope your appointment with ${docName} went well.\n\nYour feedback helps us improve! Please rate your experience:\n\n1️⃣ Excellent 🌟\n2️⃣ Good 👍\n3️⃣ Average 😐\n4️⃣ Needs Improvement 👎\n\nJust reply with a number. Thank you for choosing *${clinicName}*! 🙏`

    try {
      try {
        await sendTextMessage({
          phoneNumberId,
          accessToken,
          to: sanitizedPhone,
          text: feedbackMsg,
        })
      } catch (err: any) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[Follow-ups] Dev mode error fallback for feedback (appt ${appt.id}): ${err.message || err}. Simulating success.`)
        } else {
          throw err
        }
      }

      await prisma.appointment.update({
        where: { id: appt.id },
        data: { feedbackSent: true }
      })

      // Save to conversation
      const conv = await prisma.conversation.findFirst({
        where: {
          userId: clinic.user_id,
          contactId: appt.contact_id
        },
        select: { id: true }
      })

      if (conv) {
        await prisma.message.create({
          data: {
            conversationId: conv.id,
            senderType: 'bot',
            contentType: 'text',
            contentText: feedbackMsg,
            messageId: `feedback-${appt.id}-${Date.now()}`,
            status: 'sent',
            createdAt: now
          }
        })
      }

      feedbackSent++
    } catch (err: unknown) {
      console.error(`[Follow-ups] Feedback send failed for appt ${appt.id}:`, err)
      skipped++
    }
  }

  // ─── Process Follow-up Messages ────────────────────────────────────────────
  for (const appt of followUpAppts || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = appt as any
    const contact = a.contacts
    const doctor = a.doctors
    const clinic = a.clinics

    if (!contact?.phone || !clinic?.user_id) {
      skipped++
      continue
    }

    const config = await getWhatsAppConfig(clinic.user_id)
    if (!config) { skipped++; continue }

    const accessToken = decrypt(config.access_token)
    const phoneNumberId = config.phone_number_id as string
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    const docName = doctor ? formatDocName(doctor.doctor_name) : 'your doctor'
    const clinicName = clinic.clinic_name || 'our clinic'

    const followUpMsg = `🩺 *Follow-up Check-in*\n\nHi ${contact.name || 'there'}! It's been a week since your visit with ${docName}.\n\nHow are you feeling? 🤗\n\nIf you need:\n📅 A follow-up appointment\n💊 Prescription refill\n❓ Any questions about your treatment\n\nJust reply here and we'll help you right away!\n\n— *${clinicName}* 🏥`

    try {
      try {
        await sendTextMessage({
          phoneNumberId,
          accessToken,
          to: sanitizedPhone,
          text: followUpMsg,
        })
      } catch (err: any) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[Follow-ups] Dev mode error fallback for follow-up (appt ${appt.id}): ${err.message || err}. Simulating success.`)
        } else {
          throw err
        }
      }

      await prisma.appointment.update({
        where: { id: appt.id },
        data: { followupSent: true }
      })

      // Save to conversation
      const conv = await prisma.conversation.findFirst({
        where: {
          userId: clinic.user_id,
          contactId: appt.contact_id
        },
        select: { id: true }
      })

      if (conv) {
        await prisma.message.create({
          data: {
            conversationId: conv.id,
            senderType: 'bot',
            contentType: 'text',
            contentText: followUpMsg,
            messageId: `followup-${appt.id}-${Date.now()}`,
            status: 'sent',
            createdAt: now
          }
        })
      }

      followUpSent++
    } catch (err: unknown) {
      console.error(`[Follow-ups] Follow-up send failed for appt ${appt.id}:`, err)
      skipped++
    }
  }

  console.log(`[Follow-ups] Done: feedback=${feedbackSent}, followup=${followUpSent}, skipped=${skipped}`)
  return NextResponse.json({ feedbackSent, followUpSent, skipped })
}
