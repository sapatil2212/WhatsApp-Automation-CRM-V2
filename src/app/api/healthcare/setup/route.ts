import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

// ─── Auth helper ────────────────────────────────────────────────────────────
async function getAuthContext() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('accessToken')?.value
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

// ─── GET — load all clinic data ──────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const clinic = await prisma.clinic.findUnique({
      where: { userId: ctx.userId },
      include: {
        timings: true,
        doctors: true,
        services: true,
        faqs: true,
        aiSettings: true,
      },
    })

    if (!clinic) return NextResponse.json({ clinic: null })

    return NextResponse.json({
      clinic: {
        id: clinic.id,
        clinic_name: clinic.clinicName,
        clinic_type: clinic.clinicType,
        clinic_description: clinic.clinicDescription,
        phone: clinic.phone,
        whatsapp_number: clinic.whatsappNumber,
        email: clinic.email,
        website: clinic.website,
        address: clinic.address,
        city: clinic.city,
        state: clinic.state,
        pincode: clinic.pincode,
        google_map_link: clinic.googleMapLink,
        date_exceptions: clinic.dateExceptions ?? [],
      },
      timings: clinic.timings.map(t => ({
        id: t.id,
        day_name: t.dayName,
        opening_time: t.openingTime,
        closing_time: t.closingTime,
        is_closed: t.isClosed,
        lunch_break_start: t.lunchBreakStart,
        lunch_break_end: t.lunchBreakEnd,
      })),
      doctors: clinic.doctors.map(d => ({
        id: d.id,
        doctor_name: d.doctorName,
        specialization: d.specialization,
        qualification: d.qualification,
        experience: d.experience,
        available_days: d.availableDays ?? [],
        available_start_time: d.availableStartTime,
        available_end_time: d.availableEndTime,
        consultation_fee: Number(d.consultationFee),
        languages_spoken: d.languagesSpoken,
        profile_photo: d.profilePhoto,
        weekly_slots: d.weeklySlots ?? {},
        date_exceptions: d.dateExceptions ?? [],
      })),
      services: clinic.services.map(s => ({
        id: s.id,
        service_name: s.serviceName,
        description: s.description,
        starting_price: Number(s.startingPrice),
        duration: s.duration,
        is_active: s.isActive,
      })),
      faqs: clinic.faqs.map(f => ({
        id: f.id,
        question: f.question,
        answer: f.answer,
        keywords: f.keywords,
      })),
      ai_settings: clinic.aiSettings ? {
        id: clinic.aiSettings.id,
        ai_enabled: clinic.aiSettings.aiEnabled,
        ai_tone: clinic.aiSettings.aiTone,
        supported_languages: clinic.aiSettings.supportedLanguages ?? ['English'],
        greeting_message: clinic.aiSettings.greetingMessage,
        after_hours_message: clinic.aiSettings.afterHoursMessage,
        escalation_keywords: (clinic.aiSettings.escalationKeywords as string[] | null)?.join(', ') ?? '',
        emergency_keywords: (clinic.aiSettings.emergencyKeywords as string[] | null)?.join(', ') ?? '',
        human_handover_enabled: clinic.aiSettings.humanHandoverEnabled,
      } : null,
    })
  } catch (error) {
    console.error('[healthcare/setup GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── POST — save a specific step ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { step, data } = body as { step: number; data: any }

    // ── Step 1: Clinic Info ──────────────────────────────────────────────────
    if (step === 1) {
      if (!data.clinic_name) {
        return NextResponse.json({ error: 'Clinic Name is required.' }, { status: 400 })
      }

      const clinic = await prisma.clinic.upsert({
        where: { userId: ctx.userId },
        create: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clinicName: data.clinic_name,
          clinicType: data.clinic_type ?? null,
          clinicDescription: data.clinic_description ?? null,
          phone: data.phone ?? null,
          whatsappNumber: data.whatsapp_number ?? null,
          email: data.email ?? null,
          website: data.website ?? null,
          address: data.address ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          pincode: data.pincode ?? null,
          googleMapLink: data.google_map_link ?? null,
        },
        update: {
          clinicName: data.clinic_name,
          clinicType: data.clinic_type ?? null,
          clinicDescription: data.clinic_description ?? null,
          phone: data.phone ?? null,
          whatsappNumber: data.whatsapp_number ?? null,
          email: data.email ?? null,
          website: data.website ?? null,
          address: data.address ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          pincode: data.pincode ?? null,
          googleMapLink: data.google_map_link ?? null,
        },
      })

      return NextResponse.json({ success: true, clinic_id: clinic.id })
    }

    // All subsequent steps need a clinic_id
    const clinicId = data.clinic_id as string
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 })

    // Verify clinic belongs to this user
    const clinic = await prisma.clinic.findFirst({ where: { id: clinicId, userId: ctx.userId } })
    if (!clinic) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })

    // ── Step 2: Timings ──────────────────────────────────────────────────────
    if (step === 2) {
      const { timings, date_exceptions } = data as {
        timings: any[]
        date_exceptions: any[]
      }

      // Upsert each timing row by clinicId+dayName
      for (const t of timings) {
        await prisma.clinicTiming.upsert({
          where: t.id
            ? { id: t.id }
            : // fallback — find by clinicId+dayName
            { id: (await prisma.clinicTiming.findFirst({ where: { clinicId, dayName: t.day_name } }))?.id ?? '' },
          create: {
            clinicId,
            dayName: t.day_name,
            openingTime: t.opening_time ?? null,
            closingTime: t.closing_time ?? null,
            isClosed: t.is_closed ?? false,
            lunchBreakStart: t.lunch_break_start ?? null,
            lunchBreakEnd: t.lunch_break_end ?? null,
          },
          update: {
            openingTime: t.opening_time ?? null,
            closingTime: t.closing_time ?? null,
            isClosed: t.is_closed ?? false,
            lunchBreakStart: t.lunch_break_start ?? null,
            lunchBreakEnd: t.lunch_break_end ?? null,
          },
        })
      }

      // Save date exceptions on the clinic row
      await prisma.clinic.update({
        where: { id: clinicId },
        data: { dateExceptions: date_exceptions ?? [] },
      })

      return NextResponse.json({ success: true })
    }

    // ── Step 3: Doctors ──────────────────────────────────────────────────────
    if (step === 3) {
      const { doctors } = data as { doctors: any[] }

      if (doctors.some((d: any) => !d.doctor_name)) {
        return NextResponse.json({ error: 'All registered doctors must have a name.' }, { status: 400 })
      }

      for (const d of doctors) {
        const doctorData = {
          clinicId,
          doctorName: d.doctor_name,
          specialization: d.specialization ?? null,
          qualification: d.qualification ?? null,
          experience: d.experience ?? null,
          availableDays: d.available_days ?? [],
          availableStartTime: d.available_start_time ?? null,
          availableEndTime: d.available_end_time ?? null,
          consultationFee: d.consultation_fee ?? 0,
          languagesSpoken: d.languages_spoken ?? null,
          profilePhoto: d.profile_photo ?? null,
          weeklySlots: d.weekly_slots ?? {},
          dateExceptions: d.date_exceptions ?? [],
        }

        if (d.id) {
          await prisma.doctor.update({ where: { id: d.id }, data: doctorData })
        } else {
          await prisma.doctor.create({ data: doctorData })
        }
      }

      return NextResponse.json({ success: true })
    }

    // ── Step 4: Services ─────────────────────────────────────────────────────
    if (step === 4) {
      const { services } = data as { services: any[] }

      if (services.some((s: any) => !s.service_name)) {
        return NextResponse.json({ error: 'All services must have a name.' }, { status: 400 })
      }

      for (const s of services) {
        const serviceData = {
          clinicId,
          serviceName: s.service_name,
          description: s.description ?? null,
          startingPrice: s.starting_price ?? 0,
          duration: s.duration ?? 30,
          isActive: s.is_active ?? true,
        }

        if (s.id) {
          await prisma.clinicService.update({ where: { id: s.id }, data: serviceData })
        } else {
          await prisma.clinicService.create({ data: serviceData })
        }
      }

      return NextResponse.json({ success: true })
    }

    // ── Step 5: FAQs ─────────────────────────────────────────────────────────
    if (step === 5) {
      const { faqs } = data as { faqs: any[] }

      if (faqs.some((f: any) => !f.question || !f.answer)) {
        return NextResponse.json({ error: 'FAQs must have both a question and answer.' }, { status: 400 })
      }

      for (const f of faqs) {
        const faqData = {
          clinicId,
          question: f.question,
          answer: f.answer,
          keywords: f.keywords ?? null,
        }

        if (f.id) {
          await prisma.clinicFAQ.update({ where: { id: f.id }, data: faqData })
        } else {
          await prisma.clinicFAQ.create({ data: faqData })
        }
      }

      return NextResponse.json({ success: true })
    }

    // ── Step 6: AI Settings ──────────────────────────────────────────────────
    if (step === 6) {
      const { ai_settings } = data as { ai_settings: any }

      const escalationKws = (ai_settings.escalation_keywords ?? '')
        .split(',').map((kw: string) => kw.trim()).filter(Boolean)
      const emergencyKws = (ai_settings.emergency_keywords ?? '')
        .split(',').map((kw: string) => kw.trim()).filter(Boolean)

      const aiData = {
        clinicId,
        aiEnabled: ai_settings.ai_enabled ?? true,
        aiTone: ai_settings.ai_tone ?? 'polite and professional',
        supportedLanguages: ai_settings.supported_languages ?? ['English'],
        greetingMessage: ai_settings.greeting_message ?? null,
        afterHoursMessage: ai_settings.after_hours_message ?? null,
        escalationKeywords: escalationKws,
        emergencyKeywords: emergencyKws,
        humanHandoverEnabled: ai_settings.human_handover_enabled ?? true,
      }

      await prisma.aISettings.upsert({
        where: { clinicId },
        create: aiData,
        update: aiData,
      })

      // Invalidate cache
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/healthcare/invalidate-cache`, {
        method: 'POST',
      }).catch(() => {})

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
  } catch (error) {
    console.error('[healthcare/setup POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
