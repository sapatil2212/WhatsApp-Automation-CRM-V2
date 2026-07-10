/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import {
  getCachedClinicContext,
  setCachedClinicContext,
  getCachedAppointments,
  setCachedAppointments,
  invalidateAppointmentsCache,
  type ClinicContext,
} from '@/lib/healthcare/clinic-cache'
import { tryFastPath } from '@/lib/healthcare/fast-path-responder'

function formatDocName(name: string): string {
  if (!name) return ''
  return name.toLowerCase().startsWith('dr') ? name : `Dr. ${name}`
}

function cleanDoctorName(name: string): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/^dr\.?\s+/, '') // strip leading "dr." or "dr "
    .replace(/^doctor\s+/, '') // strip leading "doctor "
    .replace(/[^a-z0-9]/g, '') // remove all non-alphanumeric chars
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ─── Server-side booking context extractor ────────────────────────────────
const MONTHS_FULL  = ['january','february','march','april','may','june','july','august','september','october','november','december']
const MONTHS_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']

function extractBookingContext(
  pastMessages: any[],
  doctors: any[]
): { doctor_name: string | null; date: string | null; time: string | null; patient_name: string | null; patient_age: string | null; reason_for_visit: string | null } {
  const ctx: { doctor_name: string | null; date: string | null; time: string | null; patient_name: string | null; patient_age: string | null; reason_for_visit: string | null } =
    { doctor_name: null, date: null, time: null, patient_name: null, patient_age: null, reason_for_visit: null }

  const patientMsgs = [...(pastMessages || [])]
    .reverse() // oldest first so later messages overwrite earlier
    .filter((m) => m.senderType === 'customer' && m.contentText)
    .map((m) => m.contentText as string)

  const nowYear = new Date().getFullYear()

  for (const msg of patientMsgs) {
    const lower = msg.toLowerCase()

    // ── Doctor name ──────────────────────────────────────────────────────
    for (const doc of doctors || []) {
      const bare = (doc.doctorName as string)
        .toLowerCase()
        .replace(/^dr\.?\s+/i, '')
        .trim()
      if (bare && (lower.includes(bare) || lower.includes(doc.doctorName.toLowerCase()))) {
        ctx.doctor_name = doc.doctorName
        break
      }
    }

    // ── Date: ISO  2026-05-30 ────────────────────────────────────────────
    const isoMatch = msg.match(/\b(\d{4}-\d{2}-\d{2})\b/)
    if (isoMatch) { ctx.date = isoMatch[1]; continue }

    // ── Date: "30 May", "May 30", "30th May", "May 30th" ────────────────
    for (let mi = 0; mi < MONTHS_FULL.length; mi++) {
      const mFull  = MONTHS_FULL[mi]
      const mShort = MONTHS_SHORT[mi]
      const dayRe  = '(\\d{1,2})(?:st|nd|rd|th)?'
      const patterns = [
        new RegExp(`\\b${dayRe}\\s+${mFull}\\b`),
        new RegExp(`\\b${mFull}\\s+${dayRe}\\b`),
        new RegExp(`\\b${dayRe}\\s+${mShort}\\b`),
        new RegExp(`\\b${mShort}\\s+${dayRe}\\b`),
      ]
      let found = false
      for (const re of patterns) {
        const m = lower.match(re)
        if (m) {
          const day = String(m[1]).padStart(2, '0')
          const mon = String(mi + 1).padStart(2, '0')
          ctx.date = `${nowYear}-${mon}-${day}`
          found = true
          break
        }
      }
      if (found) break
    }

    // ── Time: "11 AM", "11:00", "9:30 am" ───────────────────────────────
    const ampmMatch = msg.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
    if (ampmMatch) {
      let hr = parseInt(ampmMatch[1])
      const mn = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0
      if (ampmMatch[3].toLowerCase() === 'pm' && hr !== 12) hr += 12
      if (ampmMatch[3].toLowerCase() === 'am' && hr === 12) hr = 0
      ctx.time = `${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`
    } else {
      const hhmm = msg.match(/\b(\d{2}):(\d{2})\b/)
      if (hhmm) ctx.time = `${hhmm[1]}:${hhmm[2]}`
    }

    // ── Patient name ─────────────────────────────────────────────────────
    if (!ctx.patient_name) {
      const namePatterns = [
        /(?:my name is|i(?:'m| am) called|i am)\s+([A-Za-z][A-Za-z ]{1,29}?)(?:\s*[,.\n]|$)/i,
        /(?:(?:^|\n)name[:\s]+)([A-Za-z][A-Za-z ]{1,29}?)(?:\s*[,.\n]|$)/i,
      ]
      for (const pat of namePatterns) {
        const nm = msg.match(pat)
        if (nm && nm[1].trim().length > 1) {
          ctx.patient_name = nm[1].trim()
          break
        }
      }
    }

    // ── Patient age ──────────────────────────────────────────────────────
    if (!ctx.patient_age) {
      const ageMatch =
        msg.match(/\b(\d{1,3})\s*(?:years?\s*old|yr|yrs?)\b/i) ||
        msg.match(/\bage[:\s]+(\d{1,3})\b/i)
      if (ageMatch) ctx.patient_age = ageMatch[1]
    }
  }

  return ctx
}

// ─── Gemini circuit breaker ────────────────────────────────────────────────
const GEMINI_CIRCUIT_OPEN_MS = 60_000
let geminiCircuitOpenUntil = 0        

function getWeekdayName(dateStr: string): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const dateObj = new Date(y, m - 1, d)
  return WEEKDAYS[dateObj.getDay()]
}

function getLocalDateString(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getNext7Days(): Date[] {
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    dates.push(d)
  }
  return dates
}

interface OpenAIResponse {
  detected_intent: string
  ai_response: string
  confidence_score: number
  is_escalation: boolean
  booking_details?: {
    patient_name?: string
    patient_age?: string
    reason_for_visit?: string
    doctor_name?: string
    date?: string 
    time?: string 
  }
}

export async function processHealthcareAIMessage(options: {
  messageText: string
  senderPhone: string
  contactId: string
  userId: string
  conversationId: string
  contextMessageId?: string
  accessToken: string
  phoneNumberId: string
  isFirstInboundMessage?: boolean
}): Promise<boolean> {
  const {
    messageText,
    senderPhone,
    contactId,
    userId,
    conversationId,
    contextMessageId,
    accessToken,
    phoneNumberId,
    isFirstInboundMessage,
  } = options

  const startTime = Date.now()

  // Resolve tenantId from the user profile
  const profile = await prisma.profile.findUnique({
    where: { userId }
  })
  
  if (!profile || !profile.tenantId) {
    console.log('[AI Healthcare] No tenant profile registered for user ID:', userId)
    return false
  }
  const tenantId = profile.tenantId

  // ─── Step 1: Load clinic context (CACHED — eliminates 4 DB queries) ────────
  let clinic: any
  let aiSettings: any
  let timings: any[]
  let doctors: any[]
  let services: any[]
  let faqs: any[]

  const cached = getCachedClinicContext(userId)
  if (cached) {
    clinic = cached.clinic
    aiSettings = cached.aiSettings
    timings = cached.timings
    doctors = cached.doctors
    services = cached.services
    faqs = cached.faqs
    console.log(`[AI Healthcare] Cache HIT for user ${userId} (saved ~200ms)`)
  } else {
    // Cache miss — fetch from DB and populate cache
    const clinicData = await prisma.clinic.findUnique({
      where: { userId }
    })

    if (!clinicData) {
      console.log('[AI Healthcare] No clinic registered for this user ID:', userId)
      return false
    }
    clinic = clinicData

    const settingsData = await prisma.aISettings.findUnique({
      where: { clinicId: clinic.id }
    })

    if (!settingsData || !settingsData.aiEnabled) {
      console.log('[AI Healthcare] AI automation is disabled or not set up.')
      return false
    }
    aiSettings = settingsData

    // Fetch all static clinic context in parallel
    const [timingsData, doctorsData, servicesData, faqsData] = await Promise.all([
      prisma.clinicTiming.findMany({ where: { clinicId: clinic.id } }),
      prisma.doctor.findMany({ where: { clinicId: clinic.id } }),
      prisma.clinicService.findMany({ where: { clinicId: clinic.id, isActive: true } }),
      prisma.clinicFAQ.findMany({ where: { clinicId: clinic.id } }),
    ])
    timings = timingsData
    doctors = doctorsData
    services = servicesData
    faqs = faqsData

    // Populate cache for subsequent messages
    setCachedClinicContext(userId, { clinic, aiSettings, timings, doctors, services, faqs })
    console.log(`[AI Healthcare] Cache MISS — loaded & cached for user ${userId}`)
  }

  // Dynamically replace "our clinic" in greeting_message with the actual clinic name
  if (aiSettings && aiSettings.greetingMessage && clinic && clinic.clinicName) {
    if (aiSettings.greetingMessage.toLowerCase().includes('our clinic')) {
      aiSettings = {
        ...aiSettings,
        greetingMessage: aiSettings.greetingMessage.replace(/our clinic/gi, clinic.clinicName)
      }
    }
  }

  if (!aiSettings || !aiSettings.aiEnabled) {
    return false
  }

  // ─── Step 1.5: Human Handover Status Check ─────────────────────────────────
  const convData = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { status: true, bookingState: true, bookingStage: true }
  })

  // Load existing booking memory
  let currentBookingState = (convData?.bookingState as any) || {}
  const currentBookingStage = convData?.bookingStage || 'collecting_details'

  if (convData?.status === 'open') {
    // Get the previous message in this conversation to calculate idle time
    const prevMsgs = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 2
    })

    const prevMsg = prevMsgs && prevMsgs[1]
    const lastMsgTime = prevMsg ? new Date(prevMsg.createdAt).getTime() : 0
    const idleTimeMs = Date.now() - lastMsgTime
    const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

    if (idleTimeMs > SESSION_TIMEOUT_MS) {
      console.log(`[AI Healthcare] Conversation ${conversationId} was open but idle for ${Math.round(idleTimeMs / 1000 / 60)} minutes. Resetting status to 'closed' for a new session.`)
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'closed', updatedAt: new Date() }
      })
    } else {
      const lastBotMsg = await prisma.message.findFirst({
        where: { conversationId, senderType: 'bot' },
        orderBy: { createdAt: 'desc' }
      })

      const handoverText = 'Got it! I have forwarded your message to our team members. A representative will be with you shortly to assist you further. Thank you for your patience! 🏥🙏'

      const isLastBotMsgHandover = lastBotMsg && lastBotMsg.contentText && (
        lastBotMsg.contentText.includes('connecting you to a team member') ||
        lastBotMsg.contentText.includes('forwarded your message')
      )

      if (isLastBotMsgHandover) {
        console.log(`[AI Healthcare] Conversation ${conversationId} is open and last bot response was already a handover message. Silent bypass.`)
        return true
      }

      console.log(`[AI Healthcare] Conversation ${conversationId} is open. Sending human-handover queuing message.`)
      await sendReplyAndSave({
        tenantId,
        clinicId: clinic.id,
        contactId,
        conversationId,
        responseText: handoverText,
        intent: 'human_handover',
        confidence: 1.0,
        userMessage: messageText,
        senderPhone,
        contextMessageId,
        accessToken,
        phoneNumberId,
      })
      return true
    }
  }

  const userQuery = messageText.trim().toLowerCase()
  function matchesKeyword(text: string, kw: string): boolean {
    const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(text)
  }

  const isEmergency  = aiSettings.emergencyKeywords?.some((kw: string) => matchesKeyword(userQuery, kw))
  const isEscalation = aiSettings.escalationKeywords
    ?.filter((kw: string) => {
      const cleanKw = kw.toLowerCase().trim()
      return cleanKw !== 'doctor' && cleanKw !== 'doctors'
    })
    ?.some((kw: string) => matchesKeyword(userQuery, kw))

  if (isEmergency || isEscalation) {
    console.log('[AI Healthcare] Emergency or escalation keyword matched.')
    await handleHumanEscalation({
      tenantId,
      clinic,
      aiSettings,
      contactId,
      conversationId,
      userMessage: messageText,
      intent: isEmergency ? 'emergency' : 'human_handover',
      reason: isEmergency ? 'Matched emergency keyword.' : 'Matched escalation keyword.',
      accessToken,
      phoneNumberId,
      senderPhone,
      contextMessageId,
    })
    return true
  }

  // ─── Step 3: Fast-path responder (SKIP AI for simple queries ~40% of traffic)
  const fastResult = tryFastPath(messageText, { clinic, aiSettings, timings, doctors, services, faqs, cachedAt: 0 }, !!isFirstInboundMessage)
  if (fastResult) {
    console.log(`[AI Healthcare] Fast-path HIT: ${fastResult.intent} (${Date.now() - startTime}ms — no AI call)`)
    await sendReplyAndSave({
      tenantId,
      clinicId: clinic.id,
      contactId,
      conversationId,
      responseText: fastResult.response,
      intent: fastResult.intent,
      confidence: fastResult.confidence,
      userMessage: messageText,
      senderPhone,
      contextMessageId,
      accessToken,
      phoneNumberId,
    })
    return true
  }

  // ─── Step 4: Fetch dynamic data (appointments + chat history) ──────────────
  const now = new Date()
  const todayStr = getLocalDateString(now)

  let upcomingAppointments = getCachedAppointments(clinic.id)
  let pastMessages: any[] = []

  if (upcomingAppointments !== null) {
    pastMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 12
    })
  } else {
    const [msgs, appts] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 12
      }),
      prisma.appointment.findMany({
        where: {
          clinicId: clinic.id,
          status: { not: 'cancelled' },
          appointmentDate: { gte: new Date(todayStr) }
        }
      })
    ])
    pastMessages = msgs
    upcomingAppointments = appts
    setCachedAppointments(clinic.id, upcomingAppointments)
  }

  // ── Confirmed booking details context
  const confirmedCtx = extractBookingContext(pastMessages ?? [], doctors ?? [])
  
  // Merge context from chat history regex extraction
  if (confirmedCtx.patient_name) currentBookingState.patient_name = confirmedCtx.patient_name
  if (confirmedCtx.patient_age) currentBookingState.patient_age = confirmedCtx.patient_age
  if (confirmedCtx.reason_for_visit) currentBookingState.reason_for_visit = confirmedCtx.reason_for_visit
  if (confirmedCtx.doctor_name) currentBookingState.doctor_name = confirmedCtx.doctor_name
  if (confirmedCtx.date) currentBookingState.date = confirmedCtx.date
  if (confirmedCtx.time) currentBookingState.time = confirmedCtx.time

  const confirmedBookingSection = (currentBookingState.patient_name || currentBookingState.patient_age || currentBookingState.reason_for_visit || currentBookingState.doctor_name || currentBookingState.date || currentBookingState.time)
    ? `\n### STRUCTURALLY RECORDED CONVERSATION MEMORY (CONFIRMED):
These details are already confirmed and saved in the conversation state. Do NOT ask the patient for them again.
` +
      (currentBookingState.patient_name ? `- Patient Name: ${currentBookingState.patient_name}\n` : '') +
      (currentBookingState.patient_age ? `- Patient Age: ${currentBookingState.patient_age}\n` : '') +
      (currentBookingState.reason_for_visit ? `- Reason for Visit: ${currentBookingState.reason_for_visit}\n` : '') +
      (currentBookingState.doctor_name ? `- Doctor: ${currentBookingState.doctor_name}\n` : '') +
      (currentBookingState.date
        ? `- Date: ${currentBookingState.date} (${WEEKDAYS[new Date(currentBookingState.date + 'T00:00:00').getDay()]})\n`
        : '') +
      (currentBookingState.time ? `- Time: ${currentBookingState.time}\n` : '')
    : ''

  const timingsContext = (timings || [])
    .map(
      (t) =>
        `${t.dayName}: ${t.isClosed ? 'Closed' : `${t.openingTime} - ${t.closingTime} (Break: ${t.lunchBreakStart || 'None'} - ${t.lunchBreakEnd || 'None'})`}`
    )
    .join('\n')

  const clinicExceptionsContext = (clinic.dateExceptions || [])
    .map(
      (e: any) => {
        const weekday = getWeekdayName(e.date)
        return `- ${e.date} (${weekday}): ${e.is_closed ? 'Closed all day' : `Special timings: ${e.opening_time} - ${e.closing_time}`} (${e.reason || 'Holiday'})`
      }
    )
    .join('\n')

  const doctorsContext = (doctors || [])
    .map((d) => {
      const daysWithSlots = Object.entries(d.weeklySlots || {})
        .map(([day, slots]: [string, any]) => {
          const activeSlots = (slots || [])
            .filter((s: any) => s.is_active)
            .map((s: any) => `${s.start_time}-${s.end_time}`)
            .join(', ');
          return activeSlots ? `${day}: [${activeSlots}]` : `${day}: No slots`;
        })
        .filter((str) => !str.includes('No slots'))
        .join('; ');

      const docExceptions = (d.dateExceptions || [])
        .map((e: any) => {
          const weekday = getWeekdayName(e.date)
          return `${e.date} (${weekday}) (${!e.is_available ? 'Leave/Unavailable' : 'Available with custom slots'}): ${e.reason || 'No reason'}`
        })
        .join('; ');

      return `- ${formatDocName(d.doctorName)} (${d.specialization || 'General'}). Fee: ₹${d.consultationFee || 0}. Shifts: ${d.availableDays?.join(', ') || 'None'} from ${d.availableStartTime || 'N/A'} to ${d.availableEndTime || 'N/A'}. Weekly Slots: ${daysWithSlots || 'None'}. Exceptions: ${docExceptions || 'None'}.`;
    })
    .join('\n')

  const servicesContext = (services || [])
    .map((s) => `- ${s.serviceName}: ${s.description || ''} (Starts at ₹${s.startingPrice || 0}, duration ${s.duration || 30} mins)`)
    .join('\n')

  const faqsContext = (faqs || [])
    .map((f) => `Q: "${f.question}"\nA: "${f.answer}"`)
    .join('\n')

  const chatHistoryText = [...pastMessages]
    .reverse()
    .filter((m) => m.contentText)
    .map((m) => {
      const sender = m.senderType === 'customer' ? 'Patient' : m.senderType === 'bot' ? 'AI Assistant' : 'Agent'
      return `${sender}: ${m.contentText}`
    })
    .join('\n')

  const appointmentsContext = (upcomingAppointments || [])
    .map((a: any) => {
      const doc = (doctors || []).find((d) => d.id === a.doctorId)
      const docName = doc ? formatDocName(doc.doctorName) : 'Unknown Doctor'
      const formattedDate = a.appointmentDate instanceof Date ? getLocalDateString(a.appointmentDate) : String(a.appointmentDate)
      const weekday = getWeekdayName(formattedDate)
      return `- ${docName} is BOOKED on ${formattedDate} (${weekday}) at ${a.appointmentTime}`
    })
    .join('\n')

  const next3Days = getNext7Days()
  const freeSlotsContextParts: string[] = []

  for (const doc of doctors || []) {
    const docName = formatDocName(doc.doctorName)
    freeSlotsContextParts.push(`- ${docName}:`)
    let hasAnySlotsForDoctor = false

    for (const d of next3Days) {
      const dateStr = getLocalDateString(d)
      const weekday = WEEKDAYS[d.getDay()]
      const monthName = MONTHS[d.getMonth()]
      const dayNum = d.getDate()
      const dateLabel = `${weekday.toUpperCase()} ${monthName} ${dayNum} [${dateStr}]`

      const clinicEx = (clinic.dateExceptions || []).find((e: any) => e.date === dateStr)
      if (clinicEx && clinicEx.is_closed) continue

      const clinicTiming = (timings || []).find(
        (t) => t.dayName.toLowerCase() === weekday.toLowerCase()
      )
      if (!clinicEx && clinicTiming && clinicTiming.isClosed) continue

      const docEx = (doc.dateExceptions || []).find((e: any) => e.date === dateStr)
      if (docEx && !docEx.is_available) continue

      if (!docEx) {
        const isAvailableDay = doc.availableDays?.some(
          (day: string) => day.toLowerCase() === weekday.toLowerCase()
        )
        if (!isAvailableDay) continue
      }

      let slotsForDay: any[] = []
      if (docEx && docEx.slots && docEx.slots.length > 0) {
        slotsForDay = docEx.slots.filter((s: any) => s.is_active)
      } else if (doc.weeklySlots && doc.weeklySlots[weekday]) {
        slotsForDay = doc.weeklySlots[weekday].filter((s: any) => s.is_active)
      }

      let times: string[] = []
      if (slotsForDay.length > 0) {
        times = slotsForDay.map((s: any) => s.start_time)
      } else {
        const startTimeStr = doc.availableStartTime || '09:00'
        const endTimeStr = doc.availableEndTime || '17:00'
        const [startHour] = startTimeStr.split(':').map(Number)
        const [endHour] = endTimeStr.split(':').map(Number)
        for (let hour = startHour; hour < endHour; hour++) {
          times.push(`${String(hour).padStart(2, '0')}:00`)
        }
      }

      const activeClinicTiming = clinicTiming || (timings || []).find(
        (t) => t.dayName.toLowerCase() === weekday.toLowerCase()
      )
      const lunchStart = activeClinicTiming?.lunchBreakStart ? Number(activeClinicTiming.lunchBreakStart.replace(':', '')) : null
      const lunchEnd = activeClinicTiming?.lunchBreakEnd ? Number(activeClinicTiming.lunchBreakEnd.replace(':', '')) : null

      const freeTimes: string[] = []
      for (const timeStr of times) {
        const formattedTime = timeStr.substring(0, 5)

        if (dateStr === todayStr) {
          const [sHour, sMin] = formattedTime.split(':').map(Number)
          const slotVal = sHour * 100 + sMin
          const nowObj = new Date()
          const nowVal = nowObj.getHours() * 100 + nowObj.getMinutes()
          if (slotVal <= nowVal) continue
        }

        if (lunchStart !== null && lunchEnd !== null) {
          const timeVal = Number(formattedTime.replace(':', ''))
          if (timeVal >= lunchStart && timeVal < lunchEnd) continue
        }

        const isBooked = (upcomingAppointments || []).some((appt: any) => {
          const apptDateStr = appt.appointmentDate instanceof Date ? getLocalDateString(appt.appointmentDate) : String(appt.appointmentDate)
          return (
            appt.doctorId === doc.id &&
            apptDateStr === dateStr &&
            appt.appointmentTime === formattedTime
          )
        })

        if (!isBooked) {
          freeTimes.push(formattedTime)
        }
      }

      if (freeTimes.length > 0) {
        hasAnySlotsForDoctor = true
        freeSlotsContextParts.push(`  * ${dateLabel}: ${freeTimes.join(', ')}`)
      }
    }

    if (!hasAnySlotsForDoctor) {
      freeSlotsContextParts.push(`  * No slots available for the next 7 days.`)
    }
  }

  const freeSlotsContext = freeSlotsContextParts.join('\n')

  const dateReferenceCalendar = next3Days
    .map((d) => {
      const wday = WEEKDAYS[d.getDay()]
      const mon  = MONTHS[d.getMonth()]
      const day  = d.getDate()
      const iso  = getLocalDateString(d)
      return `${wday.toUpperCase()} ${mon} ${day} [${iso}]`
    })
    .join('\n')

  const todayLabel = `${WEEKDAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`

  const systemPrompt = `You are a professional, polite, and helpful AI assistant for "${clinic.clinicName}" (${clinic.clinicDescription || 'Healthcare clinic'}).
Your tone is "${aiSettings.aiTone || 'polite'}".

### CLINIC INFORMATION:
Address: ${clinic.address || ''}, ${clinic.city || ''}, ${clinic.state || ''} - ${clinic.pincode || ''}
Phone: ${clinic.phone || ''}
WhatsApp: ${clinic.whatsappNumber || ''}
Email: ${clinic.email || ''}
Website: ${clinic.website || ''}
Google Maps: ${clinic.googleMapLink || ''}

### TODAY'S DATE:
Today is ${todayLabel}.
You are a 24/7 AI assistant. You are ALWAYS available.

${isFirstInboundMessage && aiSettings.greetingMessage ? `
### FIRST MESSAGE — WELCOME TONE:
This is the patient's very first message. Warmly welcome them: "${aiSettings.greetingMessage.replace(/"/g, "'")}"
` : ''}

### 7-DAY DATE REFERENCE:
${dateReferenceCalendar}

### WORKING HOURS:
${timingsContext || 'No hours configured.'}

### CLINIC TIMING EXCEPTIONS / HOLIDAYS:
${clinicExceptionsContext || 'No holiday exceptions.'}

### DOCTORS:
${doctorsContext || 'No doctors registered.'}

### CURRENT BOOKINGS / RESERVED SLOTS:
${appointmentsContext || 'No active bookings registered.'}

### DYNAMICALLY CALCULATED FREE SLOTS FOR THE NEXT 7 DAYS:
${freeSlotsContext || 'No free slots available.'}

### SERVICES OFFERED:
${servicesContext || 'No services configured.'}

### FREQUENTLY ASKED QUESTIONS (FAQs):
${faqsContext || 'No FAQs registered.'}

### RECENT CONVERSATION HISTORY:
${chatHistoryText || 'No previous messages.'}

### STRUCTURALLY RECOVERED CONVERSATION MEMORY:
${confirmedBookingSection}

### SUPPORTED LANGUAGES:
${(aiSettings.supportedLanguages || ['English']).join(', ')}

### CRITICAL RULES:
- ALWAYS ANSWER DIRECTLY, INSTANTLY, AND CONCISELY: Provide the direct answer or requested information immediately in the first sentence. Avoid any conversational filler.
- BE EXTREMELY BRIEF: Keep responses as short as possible. Use simple, direct language.
- SMART ACKNOWLEDGMENT HANDLING: If the patient sends a short acknowledgment word (e.g. "ok", "okay", "got it") — continue the conversation naturally from where it left off, referencing the memory context.
- NEVER diagnoses diseases, prescribe medicines, or provide diagnostic medical advice.
- IF the patient is in danger or needs human agent, set "is_escalation" to true.
- NEVER use HTML tags. Use newlines and asterisks (*) for formatting.

### APPOINTMENT BOOKING FLOW — STRICT STEP-BY-STEP ORDER:
📋 *STEP 1 — PATIENT DETAILS* (collect FIRST, before anything else, but ONLY when the patient has explicitly expressed intent to book):
If you do NOT yet have the patient's Full Name, Age, and Reason for Visit from structurally recorded memory or history:
→ Ask all three in one friendly message using this exact format:
"To book your appointment, I need a few quick details 📋\\n\\n👤 *Full Name:*\\n🎂 *Age:*\\n🩺 *Reason for Visit:*\\n\\nPlease reply with your details to continue. 😊"
📋 *STEP 2 — SELECT DOCTOR* (only after Step 1 is complete):
→ Ask to choose a doctor if more than one exists and none chosen.
📋 *STEP 3 — AVAILABLE SLOTS* (only after Step 2 is complete):
→ Present free slots grouped by day.
📋 *STEP 4 — CONFIRM & BOOK* (only after all 6 fields are collected).

Ensure you populate the "booking_details" object of your JSON output with all details captured in memory or newly provided.`

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.log('[AI Healthcare] GEMINI_API_KEY is not configured.')
    return false
  }

  async function callGemini(modelName: string, signal?: AbortSignal) {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: messageText }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                detected_intent: { type: 'STRING' },
                ai_response: { type: 'STRING' },
                confidence_score: { type: 'NUMBER' },
                is_escalation: { type: 'BOOLEAN' },
                booking_details: {
                  type: 'OBJECT',
                  properties: {
                    patient_name: { type: 'STRING' },
                    patient_age: { type: 'STRING' },
                    reason_for_visit: { type: 'STRING' },
                    doctor_name: { type: 'STRING' },
                    date: { type: 'STRING' },
                    time: { type: 'STRING' },
                  },
                },
              },
              required: ['detected_intent', 'ai_response', 'confidence_score', 'is_escalation'],
            },
          },
        }),
      }
    )
  }

  async function callOpenAI(): Promise<string> {
    const openaiKey = process.env.OPENAI_API_KEY
    if (!openaiKey) throw new Error('OPENAI_API_KEY is not configured.')

    const isOpenRouter = openaiKey.startsWith('sk-or-v1')
    const url = isOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions'
    const modelName = isOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: messageText },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`OpenAI/OpenRouter failed: ${response.status} ${errText}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  }

  let openAIResult: OpenAIResponse | null = null

  try {
    let content: string | null = null
    const circuitOpen = Date.now() < geminiCircuitOpenUntil

    if (!circuitOpen) {
      const ctrl = new AbortController()
      const timeoutId = setTimeout(() => ctrl.abort(), 5000)
      try {
        let gemRes = await callGemini('gemini-2.5-flash', ctrl.signal)
        if (!gemRes.ok && gemRes.status === 503) {
          clearTimeout(timeoutId)
          const ctrl2 = new AbortController()
          const timeout2 = setTimeout(() => ctrl2.abort(), 5000)
          try {
            gemRes = await callGemini('gemini-2.0-flash', ctrl2.signal)
          } catch {} finally {
            clearTimeout(timeout2)
          }
        }
        if (gemRes.ok) {
          const resData = await gemRes.json()
          content = resData.candidates?.[0]?.content?.parts?.[0]?.text ?? null
        } else {
          const errBody = await gemRes.text().catch(() => '')
          const isPermanent = gemRes.status === 404 || errBody.includes('"limit": 0')
          if (isPermanent) {
            geminiCircuitOpenUntil = Date.now() + GEMINI_CIRCUIT_OPEN_MS
          }
        }
      } catch (err) {
        console.warn('[AI Healthcare] Gemini failed — falling back to OpenAI')
      } finally {
        clearTimeout(timeoutId)
      }
    }

    if (!content) {
      content = await callOpenAI()
    }

    let parsed = JSON.parse(content)
    openAIResult = {
      detected_intent: parsed.detected_intent || 'fallback',
      ai_response: parsed.ai_response || 'How can I assist you?',
      confidence_score: parsed.confidence_score !== undefined ? parsed.confidence_score : 1.0,
      is_escalation: !!parsed.is_escalation,
      booking_details: parsed.booking_details || {}
    }
  } catch (error) {
    console.error('[AI Healthcare] LLM call or parse failed:', error)
    return false
  }

  if (!openAIResult) return false

  // Update structurally recorded memory context from AI response details
  const details = openAIResult.booking_details
  if (details) {
    if (details.patient_name) currentBookingState.patient_name = details.patient_name
    if (details.patient_age) currentBookingState.patient_age = details.patient_age
    if (details.reason_for_visit) currentBookingState.reason_for_visit = details.reason_for_visit
    if (details.doctor_name) currentBookingState.doctor_name = details.doctor_name
    if (details.date) currentBookingState.date = details.date
    if (details.time) currentBookingState.time = details.time

    // Save updated memory state to conversation
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        bookingState: currentBookingState,
        bookingStage: openAIResult.detected_intent === 'appointment_booking' ? 'collecting_details' : 'idle',
        updatedAt: new Date()
      }
    })
  }

  // Handle Escalation / Low Confidence
  if (openAIResult.is_escalation || openAIResult.confidence_score < 0.7 || openAIResult.detected_intent === 'emergency') {
    await handleHumanEscalation({
      tenantId,
      clinic,
      aiSettings,
      contactId,
      conversationId,
      userMessage: messageText,
      intent: openAIResult.detected_intent || 'fallback',
      reason: openAIResult.confidence_score < 0.7 ? 'Low confidence score.' : 'LLM flagged for escalation.',
      accessToken,
      phoneNumberId,
      senderPhone,
      contextMessageId,
      customResponse: openAIResult.ai_response,
    })
    return true
  }

  // Handle Appointment Booking Flow
  if (openAIResult.detected_intent === 'appointment_booking') {
    if (
      !currentBookingState.patient_name ||
      !currentBookingState.patient_age ||
      !currentBookingState.reason_for_visit ||
      !currentBookingState.doctor_name ||
      !currentBookingState.date ||
      !currentBookingState.time
    ) {
      await sendReplyAndSave({
        tenantId,
        clinicId: clinic.id,
        contactId,
        conversationId,
        responseText: openAIResult.ai_response,
        intent: 'appointment_booking',
        confidence: openAIResult.confidence_score,
        userMessage: messageText,
        senderPhone,
        contextMessageId,
        accessToken,
        phoneNumberId,
      })
      return true
    }

    // All details present -> Book slot
    const bookingOutcome = await handleSlotBooking({
      tenantId,
      clinic,
      doctors: doctors || [],
      timings: timings || [],
      details: {
        patient_name: currentBookingState.patient_name,
        patient_age: currentBookingState.patient_age,
        reason_for_visit: currentBookingState.reason_for_visit,
        doctor_name: currentBookingState.doctor_name,
        date: currentBookingState.date,
        time: currentBookingState.time,
      },
      contactId,
      senderPhone,
    })

    if (bookingOutcome.success) {
      // Clear booking memory context on successful booking
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          bookingState: Prisma.DbNull,
          bookingStage: 'confirmed',
          updatedAt: new Date()
        }
      })
    }

    await sendReplyAndSave({
      tenantId,
      clinicId: clinic.id,
      contactId,
      conversationId,
      responseText: bookingOutcome.message,
      intent: 'appointment_booking',
      confidence: openAIResult.confidence_score,
      userMessage: messageText,
      senderPhone,
      contextMessageId,
      accessToken,
      phoneNumberId,
    })
    return true
  }

  // General Intent Response
  await sendReplyAndSave({
    tenantId,
    clinicId: clinic.id,
    contactId,
    conversationId,
    responseText: openAIResult.ai_response,
    intent: openAIResult.detected_intent,
    confidence: openAIResult.confidence_score,
    userMessage: messageText,
    senderPhone,
    contextMessageId,
    accessToken,
    phoneNumberId,
  })

  return true
}

async function saveToGoogleSheets(data: {
  appointmentId: string
  clinicName: string
  patientName: string
  patientAge: string
  patientPhone: string
  reasonForVisit: string
  doctorName: string
  specialization: string
  date: string
  time: string
  bookedAt: string
}): Promise<void> {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL
  if (!webhookUrl) return

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

async function handleSlotBooking(options: {
  tenantId: string
  clinic: any
  doctors: any[]
  timings: any[]
  details: { patient_name?: string; patient_age?: string; reason_for_visit?: string; doctor_name: string; date: string; time: string }
  contactId: string
  senderPhone?: string
}): Promise<{ success: boolean; message: string }> {
  const { tenantId, clinic, doctors, timings, details, contactId, senderPhone } = options
  const { patient_name, patient_age, reason_for_visit, doctor_name, date, time } = details

  const bookingDate = new Date(date + 'T00:00:00')
  if (isNaN(bookingDate.getTime())) {
    return {
      success: false,
      message: `The date format "${date}" is invalid. Please specify a valid date (e.g. YYYY-MM-DD).`,
    }
  }

  const todayStr = getLocalDateString(new Date())
  if (date < todayStr) {
    return {
      success: false,
      message: `The requested date "${date}" has already passed. Please choose a future date.`,
    }
  }

  if (date === todayStr) {
    const [reqHour, reqMin] = time.split(':').map(Number)
    const reqVal = reqHour * 100 + reqMin
    const nowObj = new Date()
    const nowVal = nowObj.getHours() * 100 + nowObj.getMinutes()
    if (reqVal <= nowVal) {
      return {
        success: false,
        message: `The requested time "${time}" has already passed for today. Please select a future slot.`,
      }
    }
  }

  const weekday = WEEKDAYS[bookingDate.getDay()]

  const cleanReqName = cleanDoctorName(doctor_name)
  const matchedDoc = doctors.find((d) => {
    const cleanDbName = cleanDoctorName(d.doctorName)
    return cleanDbName.includes(cleanReqName) || cleanReqName.includes(cleanDbName)
  })

  if (!matchedDoc) {
    const list = doctors
      .map((d, index) => `${index + 1}️⃣ ${formatDocName(d.doctorName)}${d.specialization ? ` (${d.specialization})` : ''}`)
      .join('\n')
    return {
      success: false,
      message: `We couldn't find a doctor matching "*${doctor_name}*".\n\n🦷 *Available Doctors* 👨‍⚕️👩‍⚕️\n\n${list || 'None'}\n\n✅ *Please select one of them to continue with your appointment booking.*`,
    }
  }

  const clinicEx = (clinic.dateExceptions || []).find((e: any) => e.date === date)
  if (clinicEx && clinicEx.is_closed) {
    return {
      success: false,
      message: `The clinic is closed on ${date}${clinicEx.reason ? ` due to ${clinicEx.reason}` : ''}. Please choose another date.`,
    }
  }

  const docEx = (matchedDoc.dateExceptions || []).find((e: any) => e.date === date)
  if (docEx && !docEx.is_available) {
    return {
      success: false,
      message: `${formatDocName(matchedDoc.doctorName)} is unavailable/on leave on ${date}${docEx.reason ? ` (${docEx.reason})` : ''}. Please choose a different date.`,
    }
  }

  if (!clinicEx) {
    const clinicTiming = timings.find(
      (t) => t.dayName.toLowerCase() === weekday.toLowerCase()
    )
    if (!clinicTiming || clinicTiming.isClosed) {
      return {
        success: false,
        message: `The clinic is closed on ${weekday}s. Please choose a different day.`,
      }
    }

    const reqTimeVal = time.replace(':', '')
    if (clinicTiming.lunchBreakStart && clinicTiming.lunchBreakEnd) {
      const lunchStart = clinicTiming.lunchBreakStart.replace(':', '')
      const lunchEnd = clinicTiming.lunchBreakEnd.replace(':', '')
      if (reqTimeVal >= lunchStart && reqTimeVal < lunchEnd) {
        return {
          success: false,
          message: `The requested time ${time} falls during the clinic's lunch break (${clinicTiming.lunchBreakStart} - ${clinicTiming.lunchBreakEnd}). Please choose another time.`,
        }
      }
    }
  }

  if (!docEx) {
    const isAvailableDay = matchedDoc.availableDays?.some(
      (d: string) => d.toLowerCase() === weekday.toLowerCase()
    )
    if (!isAvailableDay) {
      const daysList = matchedDoc.availableDays?.join(', ') || 'None'
      return {
        success: false,
        message: `${formatDocName(matchedDoc.doctorName)} is not available on ${weekday}s. Their working days are: ${daysList}.`,
      }
    }
  }

  let activeSlots: any[] = []
  if (docEx && docEx.slots && docEx.slots.length > 0) {
    activeSlots = docEx.slots.filter((s: any) => s.is_active)
  } else if (matchedDoc.weeklySlots && matchedDoc.weeklySlots[weekday]) {
    activeSlots = matchedDoc.weeklySlots[weekday].filter((s: any) => s.is_active)
  }

  if (activeSlots.length > 0) {
    const matchedSlot = activeSlots.find(
      (s: any) => s.start_time === time || s.start_time === time.substring(0, 5)
    )
    if (!matchedSlot) {
      const slotList = activeSlots.map((s: any) => s.start_time).join(', ')
      return {
        success: false,
        message: `${formatDocName(matchedDoc.doctorName)} is only available for these slots on ${date}: ${slotList}. Please select one of these times.`,
      }
    }
  } else {
    const reqTimeVal = time.replace(':', '')
    const docStartVal = (matchedDoc.availableStartTime || '09:00').replace(':', '')
    const docEndVal = (matchedDoc.availableEndTime || '17:00').replace(':', '')

    if (reqTimeVal < docStartVal || reqTimeVal > docEndVal) {
      return {
        success: false,
        message: `${formatDocName(matchedDoc.doctorName)} is only available between ${matchedDoc.availableStartTime} and ${matchedDoc.availableEndTime}. Please select another time slot.`,
      }
    }
  }

  // Check double booking
  const existingAppts = await prisma.appointment.findMany({
    where: {
      doctorId: matchedDoc.id,
      appointmentDate: new Date(date + 'T00:00:00'),
      appointmentTime: time,
      status: { not: 'cancelled' }
    }
  })

  if (existingAppts.length > 0) {
    return {
      success: false,
      message: `${formatDocName(matchedDoc.doctorName)} is already booked on ${date} at ${time}. Please try a different slot.`,
    }
  }

  // Book the appointment
  const insertedAppt = await prisma.appointment.create({
    data: {
      clinicId: clinic.id,
      contactId,
      doctorId: matchedDoc.id,
      appointmentDate: new Date(date + 'T00:00:00'),
      appointmentTime: time,
      patientName: patient_name || null,
      patientAge: patient_age || null,
      reasonForVisit: reason_for_visit || null,
      status: 'scheduled',
      remindersSent: []
    },
    select: { id: true }
  })

  invalidateAppointmentsCache(clinic.id)

  saveToGoogleSheets({
    appointmentId: insertedAppt.id,
    clinicName: clinic.clinicName,
    patientName: patient_name || '',
    patientAge: patient_age || '',
    patientPhone: senderPhone || '',
    reasonForVisit: reason_for_visit || '',
    doctorName: formatDocName(matchedDoc.doctorName),
    specialization: matchedDoc.specialization || '',
    date,
    time,
    bookedAt: new Date().toISOString(),
  }).catch((err) => console.error('[Google Sheets] Save failed:', err))

  return {
    success: true,
    message:
      `✅ *Appointment Confirmed!*\n\n` +
      `👤 *Patient:* ${patient_name || 'N/A'}\n` +
      `🎂 *Age:* ${patient_age || 'N/A'}\n` +
      `🩺 *Reason:* ${reason_for_visit || 'N/A'}\n` +
      `👨‍⚕️ *Doctor:* ${formatDocName(matchedDoc.doctorName)}\n` +
      `📅 *Date:* ${date}\n` +
      `⏰ *Time:* ${time}\n\n` +
      `We look forward to seeing you! Please arrive 10 minutes early. 🙏`,
  }
}

async function handleHumanEscalation(options: {
  tenantId: string
  clinic: any
  aiSettings: any
  contactId: string
  conversationId: string
  userMessage: string
  intent: string
  reason: string
  accessToken: string
  phoneNumberId: string
  senderPhone: string
  contextMessageId?: string
  customResponse?: string
}) {
  const {
    tenantId,
    clinic,
    contactId,
    conversationId,
    userMessage,
    intent,
    reason,
    accessToken,
    phoneNumberId,
    senderPhone,
    contextMessageId,
    customResponse,
  } = options

  console.log(`[AI Healthcare] Escalating conversation ${conversationId} to human. Reason: ${reason}`)

  const transferMessage =
    customResponse ||
    'I am connecting you to a team member who will assist you shortly. Please hold on! 🙏'

  const noteText = `[AI Healthcare Escalation]\nPatient requested human assistance or emergency detected.\n- Detected Intent: ${intent}\n- Reason: ${reason}\n- Patient Query: "${userMessage}"`

  // Insert Note
  await prisma.contactNote.create({
    data: {
      tenantId,
      contactId,
      userId: clinic.userId,
      noteText
    }
  })

  // Mark conversation status as open
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'open',
      unreadCount: 1,
      updatedAt: new Date()
    }
  })

  // Send WhatsApp message and log
  await sendReplyAndSave({
    tenantId,
    clinicId: clinic.id,
    contactId,
    conversationId,
    responseText: transferMessage,
    intent: intent,
    confidence: 1.0,
    userMessage,
    senderPhone,
    contextMessageId,
    accessToken,
    phoneNumberId,
  })
}

async function sendReplyAndSave(options: {
  tenantId: string
  clinicId: string
  contactId: string
  conversationId: string
  responseText: string
  intent: string
  confidence: number
  userMessage: string
  senderPhone: string
  contextMessageId?: string
  accessToken: string
  phoneNumberId: string
}) {
  const {
    tenantId,
    clinicId,
    contactId,
    conversationId,
    responseText,
    intent,
    confidence,
    userMessage,
    senderPhone,
    contextMessageId,
    accessToken,
    phoneNumberId,
  } = options

  let sentMessageId: string | undefined = undefined
  try {
    const result = await sendTextMessage({
      phoneNumberId,
      accessToken,
      to: senderPhone,
      text: responseText,
      contextMessageId,
    })
    sentMessageId = result.messageId
  } catch (error: any) {
    console.error('[AI Healthcare] Failed to send WhatsApp message via Meta Cloud API:', error.message || error)
  }

  // Parallel writes
  await Promise.all([
    // Insert Bot message to messages table
    prisma.message.create({
      data: {
        conversationId,
        senderType: 'bot',
        contentType: 'text',
        contentText: responseText,
        messageId: sentMessageId || `bot-fallback-${Date.now()}`,
        status: (sentMessageId || process.env.NODE_ENV === 'development') ? 'sent' : 'failed'
      }
    }),
    // Update Conversation last message stats
    prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageText: responseText,
        lastMessageAt: new Date(),
        updatedAt: new Date()
      }
    }),
    // Insert into AI chat logs
    prisma.aiChatLog.create({
      data: {
        clinicId,
        patientId: contactId,
        userMessage,
        aiResponse: responseText,
        detectedIntent: intent,
        confidenceScore: confidence
      }
    })
  ]).catch((err) => {
    console.error('[AI Healthcare] DB write failed:', err)
  })
}
