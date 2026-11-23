/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from '@prisma/client'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import {
  getCachedClinicContext,
  setCachedClinicContext,
  getCachedAppointments,
  setCachedAppointments,
  invalidateAppointmentsCache,
} from '@/lib/healthcare/clinic-cache'
import { tryFastPath } from '@/lib/healthcare/fast-path-responder'
import { callLLM, parseJSONFromLLM } from '@/lib/ai/llm'
import { AiUnavailableError } from '@/lib/ai/outcome'
import { getLogger, systemDb, tenantDb } from '@/server/kernel'
import { AppointmentService } from '@/server/services/appointment.service'
import { appointmentConfirmationText, assignToken, bookingRef, notifyTenant, pretty, prettyTime, pushToGoogleSheet } from '@/server/services/booking-notify'
import { availabilityQuerySchema, bookAppointmentBodySchema, rescheduleAppointmentBodySchema } from '@/server/validators/clinic.validator'
import { newAppointmentRef } from '@/server/services/public-booking.service'
import { CLINIC_TIME_ZONE } from '@/server/services/appointment.service'
import { todayIn } from '@/server/services/availability'
import { appointmentsChanged } from '@/server/services/appointment-board.service'
import {
  advance as advanceBookingFlow,
  isActiveWizard,
  isBookingRequest,
  isCancelRequest,
  isRescheduleRequest,
  retryTime,
  startManage,
  startWizard,
  type FlowData,
  type FlowResult,
} from '@/server/services/whatsapp-booking-flow'


const log = getLogger('ai.healthcare')
/** DB-backed lookups for the step-by-step WhatsApp booking flow. */
export function bookingFlowData(tenantId: string, clinic: any, contactName: string | null, contactId?: string): FlowData {
  const db = tenantDb(tenantId)
  let doctorsP: Promise<any[]> | null = null
  const loadDoctors = () =>
    (doctorsP ??= db.doctor.findMany({
      where: { clinicId: clinic.id },
      orderBy: { doctorName: 'asc' },
      include: { departments: { select: { departmentId: true } } },
    }))
  return {
    clinicName: clinic.clinicName,
    contactName: contactName && /[a-z\u0900-\u097f]/i.test(contactName) ? contactName.trim() : null,
    today: todayIn(CLINIC_TIME_ZONE),
    async departments() {
      const rows = await db.clinicDepartment.findMany({
        where: { clinicId: clinic.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { doctors: true } } },
      })
      // Only configured departments: without them the patient picks a doctor directly.
      return rows.map((d) => ({ id: d.id, name: d.name, doctorCount: d._count.doctors }))
    },
    async doctors() {
      const docs = await loadDoctors()
      return docs.map((d) => ({
        id: d.id,
        name: d.doctorName,
        departmentIds: d.departments.map((x: { departmentId: string }) => x.departmentId),
        specialization: (d.specialization || 'General').trim() || 'General',
        qualification: d.qualification,
        experience: d.experience,
        fee: Number(d.consultationFee ?? 0),
      }))
    },
    async upcoming() {
      if (!contactId) return []
      const rows = await db.appointment.findMany({
        where: { clinicId: clinic.id, contactId, status: 'scheduled', appointmentDate: { gte: new Date(`${todayIn(CLINIC_TIME_ZONE)}T00:00:00Z`) } },
        include: { doctor: { select: { id: true, doctorName: true } }, detail: { select: { appointmentRef: true, departmentId: true } } },
        orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
        take: 5,
      })
      return rows.map((a) => ({
        id: a.id,
        ref: a.detail?.appointmentRef ?? bookingRef(a.id),
        doctorId: a.doctor?.id ?? null,
        doctorName: a.doctor?.doctorName ?? null,
        departmentId: a.detail?.departmentId ?? null,
        date: a.appointmentDate.toISOString().slice(0, 10),
        time: a.appointmentTime,
        patientName: a.patientName,
        patientAge: a.patientAge,
      }))
    },
    async extract(message, hint) {
      const prompt = `Extract appointment booking details from a patient's WhatsApp message (English, Hindi or Hinglish).
Today is ${hint.today} (YYYY-MM-DD). ${hint.awaiting ? `We just asked the patient for: ${hint.awaiting}.` : ''}
Departments: ${hint.departments.join(', ') || 'none'}
Doctors: ${hint.doctors.join(', ')}
Message: <<${message.slice(0, 500)}>>
Return JSON only: {"name":"patient name or empty","age":"number or empty","department":"one of the departments or empty","doctor":"one of the doctors or empty","date":"YYYY-MM-DD or empty","time":"HH:MM 24h or empty","is_question":true|false}
Use empty strings for anything not clearly stated. The message may be in any language or script, with typos. "name" is only the person's actual given/full name: never a label or filler word such as naam, name, mera, hai, aur, and, umar, age, saal. Example: "name swapnil aur uma 26" -> name "Swapnil", age "26". is_question is true when the message asks something unrelated to giving booking details.`
      const res = await callLLM(prompt, { jsonMode: true, maxTokens: 300, temperature: 0, taskCriticality: 'basic' })
      if (!res.success) return null
      const j = parseJSONFromLLM<Record<string, unknown>>(res.text)
      if (!j) return null
      const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '') || undefined
      return { name: str(j.name), age: str(j.age), department: str(j.department), doctor: str(j.doctor), date: str(j.date), time: str(j.time), isQuestion: j.is_question === true }
    },
    async availability(doctorId, from, days) {
      const service = AppointmentService.create(db)
      const res = await service.availability(availabilityQuerySchema.parse({ doctorId, from, days: Math.min(31, days) }))
      return res.days.map((d) => ({ date: d.date, slots: d.slots, closedReason: d.closedReason }))
    },
  }
}

function formatDocName(name: string): string {
  if (!name) return ''
  return name.toLowerCase().startsWith('dr') ? name : `Dr. ${name}`
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
  /** Campaign / Meta-ad / general context resolved by the webhook. */
  replyContext?: { layer: string; label: string; promptBlock: string }
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
  const profile = await systemDb.profile.findUnique({
    where: { userId }
  })
  
  if (!profile || !profile.tenantId) {
    log.info('declined: no tenant profile', { userId })
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
    log.debug('clinic context cache hit', { userId })
  } else {
    // Cache miss — fetch from DB and populate cache
    const clinicData = await tenantDb(tenantId).clinic.findUnique({
      where: { userId }
    })

    if (!clinicData) {
      log.info('declined: no clinic', { userId })
      return false
    }
    clinic = clinicData

    const settingsData = await tenantDb(tenantId).aISettings.findUnique({
      where: { clinicId: clinic.id }
    })

    if (!settingsData || !settingsData.aiEnabled) {
      log.info('declined: AI disabled', { clinicId: clinic.id })
      return false
    }
    aiSettings = settingsData

    // Fetch all static clinic context in parallel
    const [timingsData, doctorsData, servicesData, faqsData] = await Promise.all([
      tenantDb(tenantId).clinicTiming.findMany({ where: { clinicId: clinic.id } }),
      tenantDb(tenantId).doctor.findMany({ where: { clinicId: clinic.id } }),
      tenantDb(tenantId).clinicService.findMany({ where: { clinicId: clinic.id, isActive: true } }),
      tenantDb(tenantId).clinicFAQ.findMany({ where: { clinicId: clinic.id } }),
    ])
    timings = timingsData
    doctors = doctorsData
    services = servicesData
    faqs = faqsData

    // Populate cache for subsequent messages
    setCachedClinicContext(userId, { clinic, aiSettings, timings, doctors, services, faqs })
    log.debug('clinic context cache miss; loaded', { userId })
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
  const convData = await tenantDb(tenantId).conversation.findUnique({
    where: { id: conversationId },
    select: { status: true, bookingState: true, bookingStage: true }
  })

  // Load existing booking memory
  let currentBookingState = (convData?.bookingState as any) || {}

  if (convData?.status === 'open') {
    // Get the previous message in this conversation to calculate idle time
    const prevMsgs = await tenantDb(tenantId).message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 2
    })

    const prevMsg = prevMsgs && prevMsgs[1]
    const lastMsgTime = prevMsg ? new Date(prevMsg.createdAt).getTime() : 0
    const idleTimeMs = Date.now() - lastMsgTime
    const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

    if (idleTimeMs > SESSION_TIMEOUT_MS) {
      log.info('open conversation idle; returning it to the AI', { conversationId, idleMinutes: Math.round(idleTimeMs / 60000) })
      await tenantDb(tenantId).conversation.update({
        where: { id: conversationId },
        data: { status: 'closed', updatedAt: new Date() }
      })
    } else {
      const lastBotMsg = await tenantDb(tenantId).message.findFirst({
        where: { conversationId, senderType: 'bot' },
        orderBy: { createdAt: 'desc' }
      })

      const handoverText = 'Got it! I have forwarded your message to our team members. A representative will be with you shortly to assist you further. Thank you for your patience! 🏥🙏'

      const isLastBotMsgHandover = lastBotMsg && lastBotMsg.contentText && (
        lastBotMsg.contentText.includes('connecting you to a team member') ||
        lastBotMsg.contentText.includes('forwarded your message')
      )

      if (isLastBotMsgHandover) {
        log.info('conversation owned by a human; handover already sent', { conversationId })
        return true
      }

      log.info('conversation owned by a human; sending handover notice', { conversationId })
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
    log.info('escalation keyword matched', { conversationId, emergency: !!isEmergency })
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

  // ─── Step 2.5: Guided step-by-step booking (name → age → department →
  // doctor → date → free slot → confirm). Runs before the fast path / LLM so
  // patients who don't know doctors or departments get lists to choose from.
  {
    const wizardActive = isActiveWizard(currentBookingState)
    const wantsCancel = !wizardActive && isCancelRequest(messageText)
    const wantsReschedule = !wizardActive && !wantsCancel && isRescheduleRequest(messageText)
    if (wizardActive || wantsCancel || wantsReschedule || isBookingRequest(messageText)) {
      const contact = await tenantDb(tenantId).contact.findUnique({ where: { id: contactId }, select: { name: true } })
      const flow = bookingFlowData(tenantId, clinic, contact?.name ?? null, contactId)
      const result = wizardActive
        ? await advanceBookingFlow(currentBookingState, messageText, flow)
        : wantsCancel
          ? await startManage(flow, 'cancel', messageText)
          : wantsReschedule
            ? await startManage(flow, 'reschedule', messageText)
            : await startWizard(flow, messageText)
      const handled = await applyBookingFlowResult({ result, flow, tenantId, clinic, doctors, timings, contactId, conversationId, senderPhone, messageText, contextMessageId, accessToken, phoneNumberId })
      if (handled) return true
      // Side question: the regular AI answers, the booking resumes on the next reply.
      if (result.kind !== 'release' || !result.state) currentBookingState = {}
    }
  }

  // ─── Step 3: Fast-path responder (SKIP AI for simple queries ~40% of traffic)
  const fastResult = tryFastPath(messageText, { clinic, aiSettings, timings, doctors, services, faqs, cachedAt: 0 }, !!isFirstInboundMessage)
  if (fastResult) {
    log.info('fast-path reply', { intent: fastResult.intent, ms: Date.now() - startTime })
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
    pastMessages = await tenantDb(tenantId).message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 12
    })
  } else {
    const [msgs, appts] = await Promise.all([
      tenantDb(tenantId).message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 12
      }),
      tenantDb(tenantId).appointment.findMany({
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

  let freeSlotsContext = freeSlotsContextParts.join('\n')
  // Prefer the booking engine's own availability (honours leaves, closures,
  // weekly slots and existing bookings) over the local approximation above.
  try {
    const svc = AppointmentService.create(tenantDb(tenantId))
    const blocks: string[] = []
    for (const d of (doctors || []).slice(0, 25)) {
      const av = await svc.availability(availabilityQuerySchema.parse({ doctorId: d.id, days: 7 }))
      const lines = av.days
        .filter((day) => day.slots.length)
        .map((day) => `  * ${day.weekday} ${day.date}: ${day.slots.slice(0, 16).join(', ')}${day.slots.length > 16 ? ` (+${day.slots.length - 16} more)` : ''}`)
      blocks.push(`- ${formatDocName(d.doctorName)} [${d.specialization || 'General'}]:\n${lines.join('\n') || '  * No free slots in the next 7 days.'}`)
    }
    if (blocks.length) freeSlotsContext = blocks.join('\n')
  } catch (err) {
    log.warn('availability engine unavailable, using fallback slot list', { err })
  }

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

${options.replyContext && options.replyContext.layer !== 'general' ? `${options.replyContext.promptBlock}\n(Medical safety rules below always take priority over campaign or ad context.)\n` : ''}

### CLINIC INFORMATION:
Address: ${clinic.address || ''}, ${clinic.city || ''}, ${clinic.state || ''} - ${clinic.pincode || ''}
Phone: ${clinic.phone || ''}
WhatsApp: ${clinic.whatsappNumber || ''}
Email: ${clinic.email || ''}

### ONLINE PRESENCE & REFERENCE LINKS (share when the patient wants photos, reviews, directions, or more detail):
${[
  clinic.website ? `Website: ${clinic.website}` : '',
  clinic.googleMapLink ? `Google Business / Maps: ${clinic.googleMapLink}` : '',
  (clinic as any).instagramUrl ? `Instagram: ${(clinic as any).instagramUrl}` : '',
  (clinic as any).facebookUrl ? `Facebook: ${(clinic as any).facebookUrl}` : '',
].filter(Boolean).join('\n') || 'No public links provided.'}

${((clinic as any).aiKnowledgeBase || '').toString().trim() ? `### EXPERT KNOWLEDGE (authoritative — treat as ground truth about this clinic):\n${(clinic as any).aiKnowledgeBase.toString().trim()}\n` : ''}
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
- ANSWER LIKE A KNOWLEDGEABLE EXPERT: Respond with the confidence of an experienced clinic team member. Use the clinic details, Expert Knowledge, doctors, services, and FAQs above as your source of truth.
- ALWAYS ANSWER DIRECTLY, INSTANTLY, AND CONCISELY: Provide the direct answer or requested information immediately in the first sentence. Avoid any conversational filler.
- BE EXTREMELY BRIEF: Keep responses as short as possible. Use simple, direct language.
- STAY GROUNDED: Only state facts supported by the information above. If a specific detail is not provided, say you'll confirm with the team — never invent prices, availability, or claims.
- SHARE LINKS WHEN HELPFUL: If the patient wants photos, reviews, directions, or more detail, share the relevant link from the ONLINE PRESENCE section.
- YOU OPERATE 24/7: Even if the current time is outside clinic working hours, do NOT refuse assistance or tell the patient to contact us during working hours. Answer their questions about doctors, services, or clinic timings immediately. If they want to book an appointment, guide them through the step-by-step booking flow to collect their details (Name, Age, Reason) and let them select from the available free slots in the upcoming days.
- SMART ACKNOWLEDGMENT HANDLING: If the patient sends a short acknowledgment word (e.g. "ok", "okay", "got it") — continue the conversation naturally from where it left off, referencing the memory context.
- NEVER diagnoses diseases, prescribe medicines, or provide diagnostic medical advice.
- IF the patient is in danger or needs human agent, set "is_escalation" to true.
- NEVER use HTML tags. Use newlines and asterisks (*) for formatting.

### LANGUAGE — MATCH THE PATIENT EXACTLY
- Reply in the SAME language and script the patient uses: English → English, Hindi (देवनागरी) → Hindi, Hinglish (Hindi in Roman letters, e.g. "mujhe appointment book karni hai") → Hinglish in Roman letters, Marathi → Marathi, Gujarati → Gujarati, etc. Never switch to English unless they do.
- Be warm and respectful ("ji", "aap" in Hindi/Hinglish). Keep messages short and WhatsApp-friendly.

### APPOINTMENT BOOKING CONVERSATION (natural, one small step at a time)
1. Patient wants to book and you don't know their name → reply warmly and ask ONLY for their name.
   e.g. Hinglish: "Kyun nahi! 😊 Pehle mujhe aap apna naam bataiye."
2. You have the name → greet by name and ask for the remaining details in ONE short form (omit lines you already know):
   e.g. Hinglish: "Hello Rahul ji 🙏 Appointment book karne ke liye ye details bhejiye:\nAapki age:\nDepartment:\nDoctor:\nDate:\nTime:"
   (Translate the form labels into the patient's language.)
3. Use the DOCTORS and FREE SLOTS sections: if they name a department, suggest its doctors; if a chosen date/time is not in the free slots, say so politely and offer the nearest free times for that doctor (and other doctors in the same department).
4. As soon as name, age, doctor, date (YYYY-MM-DD) and time (HH:MM, 24h) are known, set detected_intent "appointment_booking" with all booking_details filled — the system checks the slot and books it, then sends the confirmation with the token number. Don't announce the booking as confirmed yourself.
5. Reason for visit is optional — capture it if mentioned.
6. If they want to cancel or reschedule an existing booking, set detected_intent "cancel_appointment" or "reschedule_appointment" and acknowledge.

### OUTPUT — return ONLY this JSON object
{"detected_intent":"greeting|appointment_booking|cancel_appointment|reschedule_appointment|doctor_info|timings|pricing|location|general_query|feedback|emergency|human_handoff","ai_response":"reply text","confidence_score":0.0-1.0,"is_escalation":false,"booking_details":{"patient_name":"","patient_age":"","reason_for_visit":"","department":"","doctor_name":"","date":"YYYY-MM-DD","time":"HH:MM"}}
Ensure you populate the "booking_details" object of your JSON output with all details captured in memory or newly provided.`

  let openAIResult: OpenAIResponse | null = null

  try {
    // Shared caller: current Gemini aliases with thinking headroom and JSON
    // mode, then the configured fallbacks. The previous direct call used
    // gemini-2.5-flash (404 for new keys) with a 5s timeout, so most
    // messages silently got no reply.
    const llm = await callLLM(
      `${systemPrompt}\n\nPATIENT'S LATEST MESSAGE:\n${messageText}\n\nReturn ONLY the JSON object.`,
      { jsonMode: true, maxTokens: 1500, temperature: 0.2, taskCriticality: 'standard', timeoutMs: 25_000 },
    )
    const parsed = llm.success ? parseJSONFromLLM<any>(llm.text) : null
    if (!parsed) {
      throw new AiUnavailableError('LLM unavailable or unparseable')
    }
    openAIResult = {
      detected_intent: parsed.detected_intent || 'fallback',
      ai_response: parsed.ai_response || 'How can I help you today? 😊',
      confidence_score: parsed.confidence_score !== undefined ? Number(parsed.confidence_score) : 1.0,
      is_escalation: !!parsed.is_escalation,
      booking_details: parsed.booking_details || {}
    }
  } catch (error) {
    // Nothing has been sent yet, so the router can safely retry and then fall back.
    throw error instanceof AiUnavailableError ? error : new AiUnavailableError('LLM call or parse failed', error)
  }

  if (!openAIResult) throw new AiUnavailableError('LLM returned no result')

  // Update structurally recorded memory context from AI response details
  const details = openAIResult.booking_details
  if (details) {
    if (details.patient_name) currentBookingState.patient_name = details.patient_name
    if (details.patient_age) currentBookingState.patient_age = details.patient_age
    if (details.reason_for_visit) currentBookingState.reason_for_visit = details.reason_for_visit
    if ((details as any).department) currentBookingState.department = (details as any).department
    if (details.doctor_name) currentBookingState.doctor_name = details.doctor_name
    if (details.date) currentBookingState.date = details.date
    if (details.time) currentBookingState.time = details.time

    // Save updated memory state to conversation
    await tenantDb(tenantId).conversation.update({
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
      !currentBookingState.doctor_name ||
      !currentBookingState.date ||
      !currentBookingState.time
    ) {
      // Booking intent the keyword check missed (e.g. other languages):
      // switch to the guided step-by-step flow instead of a free-form ask.
      const contact = await tenantDb(tenantId).contact.findUnique({ where: { id: contactId }, select: { name: true } })
      const flow = bookingFlowData(tenantId, clinic, contact?.name ?? null, contactId)
      const started = await applyBookingFlowResult({ result: await startWizard(flow, messageText), flow, tenantId, clinic, doctors, timings, contactId, conversationId, senderPhone, messageText, contextMessageId, accessToken, phoneNumberId })
      if (started) return true
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
      await tenantDb(tenantId).conversation.update({
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


function normaliseTime(raw: string): string | null {
  const t = String(raw || '').trim().toLowerCase().replace(/\s+/g, '')
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function matchDoctor(doctors: any[], name: string, department?: string): any | null {
  const clean = (v: string) => v.toLowerCase().replace(/^dr\.?\s*/, '').replace(/[^a-z\s]/g, '').trim()
  const target = clean(name || '')
  if (target) {
    const exact = doctors.find((d) => clean(d.doctorName) === target)
    if (exact) return exact
    const partial = doctors.find((d) => clean(d.doctorName).includes(target) || target.includes(clean(d.doctorName)))
    if (partial) return partial
  }
  if (department) {
    const inDept = doctors.filter((d) => (d.specialization || '').toLowerCase().includes(department.toLowerCase()))
    if (inDept.length === 1) return inDept[0]
  }
  return doctors.length === 1 ? doctors[0] : null
}

/**
 * Books through the appointment engine (same guard as the booking page and
 * dashboard): checks clinic hours, closures, doctor leave, weekly slots and
 * existing bookings. On a clash it answers with real alternatives.
 */
async function handleSlotBooking(options: {
  tenantId: string
  clinic: any
  doctors: any[]
  timings: any[]
  details: { patient_name?: string; patient_age?: string; reason_for_visit?: string; department?: string; department_id?: string; doctor_id?: string; doctor_name: string; date: string; time: string }
  contactId: string
  senderPhone?: string
}): Promise<{ success: boolean; message: string; reason?: string }> {
  const { tenantId, clinic, doctors, details, contactId, senderPhone } = options
  const doctor = (details.doctor_id && doctors.find((d) => d.id === details.doctor_id)) || matchDoctor(doctors, details.doctor_name, details.department)
  if (!doctor) {
    const list = doctors.map((d) => `• ${formatDocName(d.doctorName)} (${d.specialization || 'General'})`).join('\n')
    return { success: false, message: `Please choose a doctor:\n${list}` }
  }
  const time = normaliseTime(details.time)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(details.date) ? details.date : null
  if (!date || !time) {
    return { success: false, message: 'Please share the date (e.g. 25 Nov) and time (e.g. 5:30 PM) you prefer.' }
  }

  const service = AppointmentService.create(tenantDb(tenantId))
  try {
    const appt = await service.book(
      bookAppointmentBodySchema.parse({
        contactId,
        doctorId: doctor.id,
        appointmentDate: date,
        appointmentTime: time,
        patientName: details.patient_name || null,
        patientAge: details.patient_age || null,
        reasonForVisit: details.reason_for_visit || null,
      }),
    )
    invalidateAppointmentsCache(clinic.id)
    const token = await assignToken(appt.id)
    // Patient started this WhatsApp chat, so WhatsApp updates are expected.
    const ref = await newAppointmentRef(date)
    await tenantDb(tenantId).appointmentDetail.create({
      data: { appointmentId: appt.id, appointmentRef: ref, departmentId: details.department_id ?? null, patientPhone: senderPhone || null, whatsappConsent: true, consentAt: new Date(), source: 'whatsapp_ai' },
    }).catch((e: unknown) => log.warn('appointment detail not saved', { err: e }))
    const current = await tenantDb(tenantId).appointment.findUnique({ where: { id: appt.id }, select: { remindersSent: true } })
    await tenantDb(tenantId).appointment.update({
      where: { id: appt.id },
      data: { remindersSent: { ...((current?.remindersSent as Record<string, unknown>) ?? {}), token, confirmation: new Date().toISOString(), source: 'whatsapp_ai' } },
    })
    notifyTenant(tenantId, {
      type: 'booking',
      title: `WhatsApp booking · Token ${token}`,
      body: `${details.patient_name || 'Patient'} with ${formatDocName(doctor.doctorName)} — ${pretty(date)} ${prettyTime(time)}`,
      href: '/healthcare/appointments',
    })
    void pushToGoogleSheet(tenantId, {
      type: 'appointment', ref, token, name: details.patient_name || '', age: details.patient_age || '', phone: senderPhone || '',
      doctor: doctor.doctorName, department: doctor.specialization || '', date, time, reason: details.reason_for_visit || '', source: 'whatsapp_ai',
    })
    return {
      success: true,
      message: appointmentConfirmationText({
        clinicName: clinic.clinicName,
        patientName: details.patient_name || null,
        doctorName: doctor.doctorName,
        department: doctor.specialization || null,
        date,
        time,
        token,
        address: [clinic.address, clinic.city].filter(Boolean).join(', ') || null,
        bookingRef: ref,
      }),
    }
  } catch (err: any) {
    // Slot not offered / just taken → show real alternatives.
    try {
      const av = await service.availability(availabilityQuerySchema.parse({ doctorId: doctor.id, from: date, days: 4 }))
      const options = av.days.filter((d) => d.slots.length).slice(0, 3)
        .map((d) => `📅 ${pretty(d.date)}: ${d.slots.slice(0, 6).map(prettyTime).join(', ')}`)
      const reason = err?.message && !/internal/i.test(err.message) ? err.message : `${prettyTime(time)} on ${pretty(date)} is not available.`
      return {
        success: false,
        reason,
        message: options.length
          ? `${reason}\n\nAvailable times with ${formatDocName(doctor.doctorName)}:\n${options.join('\n')}\n\nPlease reply with the time you prefer.`
          : `${reason}\n\n${formatDocName(doctor.doctorName)} has no free slots in the next few days. Would you like another doctor?`,
      }
    } catch {
      return { success: false, message: 'Sorry, I could not complete the booking right now. Our team will contact you shortly.' }
    }
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

  log.info('escalating to human', { conversationId, reason })

  const transferMessage =
    customResponse ||
    'I am connecting you to a team member who will assist you shortly. Please hold on! 🙏'

  const noteText = `[AI Healthcare Escalation]\nPatient requested human assistance or emergency detected.\n- Detected Intent: ${intent}\n- Reason: ${reason}\n- Patient Query: "${userMessage}"`

  // Insert Note
  await tenantDb(tenantId).contactNote.create({
    data: {
      tenantId,
      contactId,
      userId: clinic.userId,
      noteText
    }
  })

  // Mark conversation status as open
  await tenantDb(tenantId).conversation.update({
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

/** Persists wizard state, books on confirmation, and sends the reply. Returns false when the AI should answer instead. */
async function applyBookingFlowResult(o: {
  result: FlowResult
  flow: FlowData
  tenantId: string
  clinic: any
  doctors: any[]
  timings: any[]
  contactId: string
  conversationId: string
  senderPhone: string
  messageText: string
  contextMessageId?: string
  accessToken: string
  phoneNumberId: string
}): Promise<boolean> {
  let result = o.result
  const save = (state: unknown, stage: string) =>
    tenantDb(o.tenantId).conversation.update({
      where: { id: o.conversationId },
      data: { bookingState: state === null ? Prisma.DbNull : (state as Prisma.InputJsonValue), bookingStage: stage, updatedAt: new Date() },
    })

  if (result.kind === 'release') {
    if (result.state) await save(result.state, 'wizard_paused')
    else await save(null, 'idle')
    return false
  }

  let text: string
  if (result.kind === 'cancel') {
    const st = result.state
    try {
      const service = AppointmentService.create(tenantDb(o.tenantId))
      await service.setStatus(st.targetId!, { status: 'cancelled' })
      invalidateAppointmentsCache(o.clinic.id)
      appointmentsChanged(o.tenantId, { id: st.targetId, kind: 'cancelled' })
      notifyTenant(o.tenantId, { type: 'booking', title: 'Appointment cancelled on WhatsApp', body: `${st.targetLabel?.replace(/\*/g, '') ?? ''}`, href: '/healthcare/appointments' })
      text = st.lang === 'hi'
        ? `Ho gaya ✅ ${st.targetLabel} wala appointment cancel kar diya hai. Naya appointment chahiye to *book appointment* likhiye. 🙏`
        : `Done ✅ Your appointment with ${st.targetLabel} has been cancelled. If you'd like to book another time, just say *book appointment*. 🙏`
    } catch (err: any) {
      text = err?.message && !/internal/i.test(err.message) ? `Sorry, ${err.message}` : 'Sorry, I could not cancel it right now. Our team will help you shortly. 🙏'
    }
    await save(null, 'idle')
  } else if (result.kind === 'book' && result.state.mode === 'reschedule' && result.state.targetId) {
    const st = result.state
    try {
      const service = AppointmentService.create(tenantDb(o.tenantId))
      const before = await tenantDb(o.tenantId).appointment.findUnique({ where: { id: st.targetId }, select: { appointmentDate: true, appointmentTime: true, remindersSent: true } })
      await service.reschedule(st.targetId!, rescheduleAppointmentBodySchema.parse({ appointmentDate: st.date, appointmentTime: st.time, doctorId: st.doctorId }))
      const log = (before?.remindersSent as Record<string, unknown>) ?? {}
      await tenantDb(o.tenantId).appointment.update({
        where: { id: st.targetId },
        data: { remindersSent: { token: log.token, source: log.source, confirmation: log.confirmation, rescheduledFrom: before ? `${before.appointmentDate.toISOString().slice(0, 10)} ${before.appointmentTime}` : undefined } as any },
      })
      invalidateAppointmentsCache(o.clinic.id)
      appointmentsChanged(o.tenantId, { id: st.targetId, kind: 'rescheduled' })
      notifyTenant(o.tenantId, { type: 'booking', title: 'Appointment rescheduled on WhatsApp', body: `${st.name ?? 'Patient'} → ${pretty(st.date!)} ${prettyTime(st.time!)}`, href: '/healthcare/appointments' })
      await save(null, 'confirmed')
      text = st.lang === 'hi'
        ? `Ho gaya ✅ Aapka appointment shift kar diya hai.\n\n🩺 ${formatDocName(st.doctorName ?? '')}\n📅 ${pretty(st.date!)} · ${prettyTime(st.time!)}\n\nKoi aur madad chahiye to bataiye. 🙏`
        : `All set ✅ Your appointment has been moved.\n\n🩺 ${formatDocName(st.doctorName ?? '')}\n📅 ${pretty(st.date!)} · ${prettyTime(st.time!)}\n\nAnything else I can help with? 🙏`
    } catch (err: any) {
      result = await retryTime(st, o.flow, err?.message && !/internal/i.test(err.message) ? err.message : 'That time is no longer available.')
      if (result.kind === 'reply') {
        await save(result.state, `wizard_${result.state.awaiting ?? 'open'}`)
        text = result.text
      } else {
        await save(null, 'idle')
        text = result.kind === 'exit' ? result.text : 'Sorry, I could not move the appointment right now.'
      }
    }
  } else if (result.kind === 'book') {
    const st = result.state
    const outcome = await handleSlotBooking({
      tenantId: o.tenantId,
      clinic: o.clinic,
      doctors: o.doctors,
      timings: o.timings,
      details: {
        patient_name: st.name,
        patient_age: st.age,
        doctor_id: st.doctorId,
        doctor_name: st.doctorName ?? '',
        department_id: st.departmentId || undefined,
        date: st.date!,
        time: st.time!,
      },
      contactId: o.contactId,
      senderPhone: o.senderPhone,
    })
    if (outcome.success) {
      await save(null, 'confirmed')
      appointmentsChanged(o.tenantId, { kind: 'created' })
      text = outcome.message
    } else {
      // Slot taken meanwhile: show fresh slots for the same date.
      result = await retryTime(st, o.flow, outcome.reason || 'That time is no longer available.')
      if (result.kind === 'reply') {
        await save(result.state, `wizard_${result.state.awaiting ?? 'open'}`)
        text = result.text
      } else {
        await save(null, 'idle')
        text = result.kind === 'exit' ? result.text : outcome.message
      }
    }
  } else if (result.kind === 'exit') {
    await save(null, 'idle')
    text = result.text
  } else {
    await save(result.state, `wizard_${result.state.awaiting ?? 'open'}`)
    text = result.text
  }

  await sendReplyAndSave({
    tenantId: o.tenantId,
    clinicId: o.clinic.id,
    contactId: o.contactId,
    conversationId: o.conversationId,
    responseText: text,
    intent: 'appointment_booking',
    confidence: 1,
    userMessage: o.messageText,
    senderPhone: o.senderPhone,
    contextMessageId: o.contextMessageId,
    accessToken: o.accessToken,
    phoneNumberId: o.phoneNumberId,
  })
  return true
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
    log.error('WhatsApp send failed', { conversationId, err: error })
  }

  // Parallel writes
  await Promise.all([
    // Insert Bot message to messages table
    tenantDb(tenantId).message.create({
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
    tenantDb(tenantId).conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageText: responseText,
        lastMessageAt: new Date(),
        updatedAt: new Date()
      }
    }),
    // Insert into AI chat logs
    tenantDb(tenantId).aiChatLog.create({
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
    log.error('reply bookkeeping write failed', { conversationId, err })
  })
}
