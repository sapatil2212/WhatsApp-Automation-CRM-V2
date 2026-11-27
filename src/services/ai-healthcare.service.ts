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
import { callLLM, inferTaskCriticality, parseJSONFromLLM } from '@/lib/ai/llm'
import { normalizeDigits, languageInstruction, type DetectedLanguage } from '@/lib/ai/language'
import {
  buildMemory,
  declinesHuman,
  ensureLanguage,
  HANDOFF_RULES,
  HUMAN_STYLE_RULES,
  humanIsActive,
  localizeText,
  localizedCanned,
  wantsHuman,
} from '@/lib/ai/conversation-kit'
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
      const prompt = `Extract appointment booking details from a patient's WhatsApp message. It can be in any language or script (English, Hindi, Hinglish, Marathi in Devanagari or Roman letters, Gujarati, Tamil…) and may give several details at once.
Time words: morning = subah/sakali/सकाळी/सुबह, afternoon = dopahar/dupari/दुपारी, evening = shaam/sandhyakali/संध्याकाळी, night = raat/ratri/रात्री; o'clock = baje/vajta/वाजता/बजे. Example: "1 december sakali 11 vajta" -> date 1 Dec, time "11:00"; "दुपारी 3 वाजता" -> "15:00".
Today is ${hint.today} (YYYY-MM-DD). ${hint.awaiting ? `We just asked the patient for: ${hint.awaiting}.` : ''}
Departments: ${hint.departments.join(', ') || 'none'}
Doctors: ${hint.doctors.join(', ')}
Message: <<${message.slice(0, 500)}>>
Return JSON only: {"name":"patient name or empty","age":"number or empty","department":"one of the departments or empty","doctor":"one of the doctors or empty","date":"YYYY-MM-DD or empty","time":"HH:MM 24h or empty","is_question":true|false}
Use empty strings for anything not clearly stated. The message may be in any language or script, with typos. "name" is only the person's actual given/full name: never a label or filler word such as naam, name, mera, hai, aur, and, umar, age, saal. Example: "name swapnil aur uma 26" -> name "Swapnil", age "26". is_question is true when the message asks something unrelated to giving booking details.`
      const res = await callLLM(prompt, { jsonMode: true, maxTokens: 300, temperature: 0, taskCriticality: 'basic', timeoutMs: 10_000, deadlineMs: 20_000 })
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

  // ─── Step 1.5: Memory, reply language, and who owns the chat ──────────────
  const db = tenantDb(tenantId)
  const [convData, recentMessages, contact] = await Promise.all([
    db.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true, bookingState: true, bookingStage: true },
    }),
    db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { senderType: true, contentType: true, contentText: true, createdAt: true },
    }),
    db.contact.findUnique({ where: { id: contactId }, select: { name: true, phone: true } }),
  ])
  const memory = buildMemory(recentMessages, messageText)
  const lang = memory.language
  let currentBookingState = (convData?.bookingState as any) || {}
  let handoffPending = convData?.bookingStage === 'human_handoff'
  const handoverEnabled = aiSettings.humanHandoverEnabled !== false

  const reply = (text: string, intent: string, confidence = 1) =>
    sendReplyAndSave({
      tenantId,
      clinicId: clinic.id,
      contactId,
      conversationId,
      responseText: text,
      intent,
      confidence,
      userMessage: messageText,
      senderPhone,
      accessToken,
      phoneNumberId,
    })

  // A team member is chatting with this customer right now: stay out of it.
  if (humanIsActive(memory)) {
    log.info('team member active in this chat; AI stays quiet', { conversationId })
    return true
  }

  // ─── Step 2: Human handover — only when the customer asks for it ──────────
  if (declinesHuman(messageText)) {
    if (handoffPending) {
      await db.conversation.update({ where: { id: conversationId }, data: { bookingStage: 'idle' } }).catch(() => undefined)
      handoffPending = false
    }
    // The AI answers normally below.
  } else if (handoverEnabled && wantsHuman(messageText)) {
    await handleHumanEscalation({
      tenantId,
      clinic,
      contactId,
      conversationId,
      userMessage: messageText,
      intent: 'human_handover',
      reason: 'Customer asked to talk to a team member.',
      responseText: await localizedCanned('handoff', lang),
      accessToken,
      phoneNumberId,
      senderPhone,
      customerLabel: contact?.name || `+${senderPhone}`,
    })
    return true
  }

  const userQuery = messageText.trim().toLowerCase()
  function matchesKeyword(text: string, kw: string): boolean {
    const k = String(kw || '').toLowerCase().trim()
    if (!k) return false
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text)
  }
  const keywordList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter((s) => s.trim()) : [])

  // Emergencies get safety instructions immediately and alert the team.
  // This is not a transfer: the AI keeps helping in the same chat.
  const isEmergency = keywordList(aiSettings.emergencyKeywords).some((kw) => matchesKeyword(userQuery, kw))
  if (isEmergency) {
    log.info('emergency keyword matched', { conversationId })
    await alertTeam({ tenantId, clinic, contactId, conversationId, userMessage: messageText, kind: 'emergency', customerLabel: contact?.name || `+${senderPhone}` })
    const phone = clinic.phone ? `\n📞 ${clinic.clinicName}: ${clinic.phone}` : ''
    await reply(`${await localizedCanned('emergency', lang)}${phone}`, 'emergency')
    return true
  }

  // ─── Step 2.5: Guided step-by-step booking (name → age → department →
  // doctor → date → free slot → confirm). Runs before the fast path / LLM so
  // patients who don't know doctors or departments get lists to choose from.
  const flowText = normalizeDigits(messageText)
  {
    const wizardActive = isActiveWizard(currentBookingState)
    const wantsCancel = !wizardActive && isCancelRequest(flowText)
    const wantsReschedule = !wizardActive && !wantsCancel && isRescheduleRequest(flowText)
    if (wizardActive || wantsCancel || wantsReschedule || isBookingRequest(flowText)) {
      const flow = bookingFlowData(tenantId, clinic, contact?.name ?? null, contactId)
      const result = wizardActive
        ? await advanceBookingFlow(currentBookingState, flowText, flow)
        : wantsCancel
          ? await startManage(flow, 'cancel', flowText)
          : wantsReschedule
            ? await startManage(flow, 'reschedule', flowText)
            : await startWizard(flow, flowText)
      const handled = await applyBookingFlowResult({ result, flow, tenantId, clinic, doctors, timings, contactId, conversationId, senderPhone, messageText, accessToken, phoneNumberId, lang })
      if (handled) return true
      // Side question: the regular AI answers, the booking resumes on the next reply.
      if (result.kind !== 'release' || !result.state) currentBookingState = {}
    }
  }

  // ─── Step 3: Fast path — instant factual answers for clear English queries
  if (lang.code === 'en' && lang.confidence === 'strong') {
    const fastResult = tryFastPath(messageText, { clinic, aiSettings, timings, doctors, services, faqs, cachedAt: 0 }, !!isFirstInboundMessage)
    if (fastResult) {
      log.info('fast-path reply', { intent: fastResult.intent, ms: Date.now() - startTime })
      await reply(fastResult.response, fastResult.intent, fastResult.confidence)
      return true
    }
  }

  // ─── Step 4: Dynamic data (free slots, departments, this patient's visits) ─
  const now = new Date()
  const todayStr = getLocalDateString(now)

  let upcomingAppointments = getCachedAppointments(clinic.id)
  const [apptsLoaded, departments, patientAppointments] = await Promise.all([
    upcomingAppointments !== null
      ? Promise.resolve(null)
      : db.appointment.findMany({
          where: { clinicId: clinic.id, status: { not: 'cancelled' }, appointmentDate: { gte: new Date(todayStr) } },
        }),
    db.clinicDepartment
      .findMany({
        where: { clinicId: clinic.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { name: true, description: true, doctors: { select: { doctor: { select: { doctorName: true } } } } },
      })
      .catch(() => [] as any[]),
    db.appointment
      .findMany({
        where: { clinicId: clinic.id, contactId, status: 'scheduled', appointmentDate: { gte: new Date(`${todayStr}T00:00:00Z`) } },
        include: { doctor: { select: { doctorName: true } } },
        orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
        take: 5,
      })
      .catch(() => [] as any[]),
  ])
  if (apptsLoaded) {
    upcomingAppointments = apptsLoaded
    setCachedAppointments(clinic.id, apptsLoaded)
  }

  // ── Booking details already given earlier in the chat
  const confirmedCtx = extractBookingContext(recentMessages ?? [], doctors ?? [])
  if (confirmedCtx.patient_name) currentBookingState.patient_name = confirmedCtx.patient_name
  if (confirmedCtx.patient_age) currentBookingState.patient_age = confirmedCtx.patient_age
  if (confirmedCtx.reason_for_visit) currentBookingState.reason_for_visit = confirmedCtx.reason_for_visit
  if (confirmedCtx.doctor_name) currentBookingState.doctor_name = confirmedCtx.doctor_name
  if (confirmedCtx.date) currentBookingState.date = confirmedCtx.date
  if (confirmedCtx.time) currentBookingState.time = confirmedCtx.time

  const memoryLines = [
    currentBookingState.patient_name ? `- Patient name: ${currentBookingState.patient_name}` : '',
    currentBookingState.patient_age ? `- Patient age: ${currentBookingState.patient_age}` : '',
    currentBookingState.reason_for_visit ? `- Reason for visit: ${currentBookingState.reason_for_visit}` : '',
    currentBookingState.doctor_name ? `- Doctor: ${currentBookingState.doctor_name}` : '',
    currentBookingState.date ? `- Date: ${currentBookingState.date} (${WEEKDAYS[new Date(currentBookingState.date + 'T00:00:00').getDay()]})` : '',
    currentBookingState.time ? `- Time: ${currentBookingState.time}` : '',
  ].filter(Boolean)

  const timingsContext = (timings || [])
    .map((t) => `${t.dayName}: ${t.isClosed ? 'Closed' : `${t.openingTime} - ${t.closingTime}${t.lunchBreakStart ? ` (break ${t.lunchBreakStart} - ${t.lunchBreakEnd})` : ''}`}`)
    .join('\n')

  const clinicExceptionsContext = (Array.isArray(clinic.dateExceptions) ? clinic.dateExceptions : [])
    .filter((e: any) => e?.date && e.date >= todayStr)
    .map((e: any) => `- ${e.date} (${getWeekdayName(e.date)}): ${e.is_closed ? 'Closed all day' : `Special timings: ${e.opening_time} - ${e.closing_time}`} (${e.reason || 'Holiday'})`)
    .join('\n')

  const doctorsContext = (doctors || [])
    .map((d) => {
      const leave = (Array.isArray(d.dateExceptions) ? d.dateExceptions : [])
        .filter((e: any) => e?.date && e.date >= todayStr && !e.is_available)
        .map((e: any) => `${e.date}${e.reason ? ` (${e.reason})` : ''}`)
        .join(', ')
      return `- ${formatDocName(d.doctorName)} — ${d.specialization || 'General'}${d.qualification ? `, ${d.qualification}` : ''}${d.experience ? `, ${d.experience} yrs exp` : ''}. Fee ₹${d.consultationFee || 0}. Days: ${d.availableDays?.join(', ') || 'not set'} ${d.availableStartTime || ''}-${d.availableEndTime || ''}.${leave ? ` On leave: ${leave}.` : ''}`
    })
    .join('\n')

  const departmentsContext = (departments || [])
    .map((dep: any) => {
      const docs = (dep.doctors || []).map((x: any) => formatDocName(x.doctor?.doctorName || '')).filter(Boolean)
      return `- ${dep.name}${dep.description ? `: ${String(dep.description).slice(0, 160)}` : ''}${docs.length ? ` — ${docs.join(', ')}` : ''}`
    })
    .join('\n')

  const servicesContext = (services || [])
    .map((s) => `- ${s.serviceName}: ${s.description || ''} (from ₹${s.startingPrice || 0}, ${s.duration || 30} mins)`)
    .join('\n')

  const faqsContext = (faqs || [])
    .map((f) => `Q: ${f.question}\nA: ${f.answer}`)
    .join('\n')

  const patientApptsContext = (patientAppointments || [])
    .map((a: any) => {
      const d = a.appointmentDate instanceof Date ? a.appointmentDate.toISOString().slice(0, 10) : String(a.appointmentDate)
      return `- ${d} (${getWeekdayName(d)}) at ${a.appointmentTime} with ${formatDocName(a.doctor?.doctorName || 'doctor')}${a.patientName ? ` for ${a.patientName}` : ''}`
    })
    .join('\n')

  // Free slots from the booking engine (honours leaves, closures, weekly
  // slots and existing bookings); a local approximation if it is unavailable.
  const next7Days = getNext7Days()
  let freeSlotsContext = ''
  try {
    const svc = AppointmentService.create(db)
    const blocks = await Promise.all(
      (doctors || []).slice(0, 25).map(async (d) => {
        const av = await svc.availability(availabilityQuerySchema.parse({ doctorId: d.id, days: 7 }))
        const lines = av.days
          .filter((day) => day.slots.length)
          .map((day) => `  * ${day.weekday} ${day.date}: ${day.slots.slice(0, 12).join(', ')}${day.slots.length > 12 ? ` (+${day.slots.length - 12} more)` : ''}`)
        return `- ${formatDocName(d.doctorName)}:\n${lines.join('\n') || '  * No free slots in the next 7 days.'}`
      }),
    )
    freeSlotsContext = blocks.join('\n')
  } catch (err) {
    log.warn('availability engine unavailable, using fallback slot list', { err })
    freeSlotsContext = localFreeSlots({ doctors, timings, clinic, upcomingAppointments: upcomingAppointments || [], days: next7Days, todayStr })
  }

  const dateReferenceCalendar = next7Days
    .map((d, i) => `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} = ${getLocalDateString(d)}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`)
    .join('\n')
  const todayLabel = `${WEEKDAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`
  const currentTime = now.toLocaleTimeString('en-IN', { timeZone: CLINIC_TIME_ZONE, hour: '2-digit', minute: '2-digit' })

  const escalationHints = keywordList(aiSettings.escalationKeywords).filter((k) => !/^doctors?$/i.test(k.trim()))
  const knowledge = String((clinic as any).aiKnowledgeBase || '').trim()
  const contactName = contact?.name && contact.name !== contact.phone && /\p{L}/u.test(contact.name) ? contact.name : ''

  const systemPrompt = `You are the WhatsApp front-desk assistant of "${clinic.clinicName}" (${clinic.clinicDescription || clinic.clinicType || 'healthcare clinic'}). You chat with patients and their families like a caring, experienced receptionist. Tone: ${aiSettings.aiTone || 'polite, warm'}.

${languageInstruction(lang)}

${HUMAN_STYLE_RULES}

### WHERE THIS CHAT CAME FROM
${options.replyContext?.promptBlock ?? 'Normal WhatsApp message. Work out what they want from their message and the conversation.'}
(Medical safety rules always take priority over campaign or ad context.)

### CLINIC
Name: ${clinic.clinicName}
Address: ${[clinic.address, clinic.city, clinic.state, clinic.pincode].filter(Boolean).join(', ') || 'not provided'}
Phone: ${clinic.phone || 'not provided'} | WhatsApp: ${clinic.whatsappNumber || 'this number'} | Email: ${clinic.email || 'not provided'}
${[
  clinic.website ? `Website: ${clinic.website}` : '',
  clinic.googleMapLink ? `Google Maps: ${clinic.googleMapLink}` : '',
  (clinic as any).instagramUrl ? `Instagram: ${(clinic as any).instagramUrl}` : '',
  (clinic as any).facebookUrl ? `Facebook: ${(clinic as any).facebookUrl}` : '',
].filter(Boolean).join('\n')}
${knowledge ? `\n### CLINIC KNOWLEDGE (authoritative)\n${knowledge.slice(0, 6000)}\n` : ''}
### WORKING HOURS
${timingsContext || 'Not configured.'}
${clinicExceptionsContext ? `Upcoming closures / special days:\n${clinicExceptionsContext}` : ''}

### DEPARTMENTS
${departmentsContext || 'No separate departments.'}

### DOCTORS
${doctorsContext || 'No doctors registered.'}

### FREE APPOINTMENT SLOTS — NEXT 7 DAYS (only these can be booked)
${freeSlotsContext || 'No free slots available.'}

### SERVICES
${servicesContext || 'Not listed.'}

### FAQs (use these answers)
${faqsContext || 'None.'}

### DATE & TIME
Now: ${todayLabel}, ${currentTime} (India time). You reply 24/7 — even outside clinic hours, help fully.
${dateReferenceCalendar}

### THIS PATIENT
${contactName ? `WhatsApp name: ${contactName}` : 'Name not known yet.'}
${patientApptsContext ? `Their upcoming appointments:\n${patientApptsContext}` : 'No upcoming appointments.'}
${memoryLines.length ? `Already given in this chat (do not ask again):\n${memoryLines.join('\n')}` : ''}
${isFirstInboundMessage ? `\nThis is their first message ever. Welcome them warmly${aiSettings.greetingMessage ? ` in the spirit of: "${String(aiSettings.greetingMessage).replace(/"/g, "'").slice(0, 400)}"` : ''} and answer what they asked.` : ''}
${handoffPending ? '\nEarlier in this chat the patient asked for a team member and the team has been informed. Keep helping meanwhile; do not repeat the transfer message.' : ''}

${HANDOFF_RULES}
${escalationHints.length ? `- Phrases this clinic treats as "wants a person": ${escalationHints.slice(0, 20).join(', ')} — but only when the patient actually asks for one (watch for "no need", "nako", "nahi").` : ''}

### MEDICAL SAFETY
- Never diagnose, prescribe, or suggest medicines or doses. For symptoms, show empathy and suggest seeing the right doctor (offer to book).
- Danger signs (chest pain, breathlessness, heavy bleeding, unconsciousness, stroke signs, poisoning, suicidal thoughts): tell them to call 108/112 or go to the nearest emergency room now, give the clinic phone, and use intent "emergency".

### BOOKINGS
- If they want to book, the system runs a guided booking. Set detected_intent "appointment_booking" and fill booking_details with whatever is known.
- Once name, age, doctor, date (YYYY-MM-DD) and time (HH:MM 24h, from FREE SLOTS) are all known, the system books it and sends the confirmation — don't claim it is confirmed yourself.
- Cancel or move an existing visit → intent "cancel_appointment" / "reschedule_appointment".

### OUTPUT
Return ONLY this JSON object:
{"detected_intent":"greeting|appointment_booking|cancel_appointment|reschedule_appointment|doctor_info|timings|pricing|location|general_query|feedback|small_talk|emergency|human_handoff|decline_handoff","ai_response":"your WhatsApp reply, in the patient's language","confidence_score":0.0-1.0,"booking_details":{"patient_name":"","patient_age":"","reason_for_visit":"","department":"","doctor_name":"","date":"","time":""}}`

  let openAIResult: OpenAIResponse | null = null
  try {
    const llm = await callLLM(messageText, {
      systemPrompt,
      history: memory.history,
      jsonMode: true,
      maxTokens: 900,
      temperature: 0.4,
      taskCriticality: inferTaskCriticality(messageText),
      timeoutMs: 20_000,
      deadlineMs: 45_000,
    })
    const parsed = llm.success ? parseJSONFromLLM<any>(llm.text) : null
    if (!parsed || typeof parsed.ai_response !== 'string') {
      log.warn('LLM unavailable or unparseable', { logs: llm.debugLogs.slice(-6) })
      throw new AiUnavailableError('LLM unavailable or unparseable')
    }
    log.info('ai reply generated', { provider: llm.provider, model: llm.model, tokens: llm.tokensUsed, lang: lang.code, ms: Date.now() - startTime })
    openAIResult = {
      detected_intent: String(parsed.detected_intent || 'general_query'),
      ai_response: parsed.ai_response.trim(),
      confidence_score: parsed.confidence_score !== undefined ? Number(parsed.confidence_score) || 0 : 1,
      is_escalation: false,
      booking_details: parsed.booking_details || {},
    }
  } catch (error) {
    // Nothing has been sent yet, so the router can safely retry and then fall back.
    throw error instanceof AiUnavailableError ? error : new AiUnavailableError('LLM call or parse failed', error)
  }

  const intent = openAIResult.detected_intent
  if (!openAIResult.ai_response && intent !== 'appointment_booking') {
    throw new AiUnavailableError('LLM returned an empty reply')
  }
  const aiText = await ensureLanguage(openAIResult.ai_response, lang)

  // Update structured memory from the AI's booking details
  const details = openAIResult.booking_details
  if (details && Object.values(details).some((v) => v)) {
    if (details.patient_name) currentBookingState.patient_name = details.patient_name
    if (details.patient_age) currentBookingState.patient_age = normalizeDigits(String(details.patient_age))
    if (details.reason_for_visit) currentBookingState.reason_for_visit = details.reason_for_visit
    if ((details as any).department) currentBookingState.department = (details as any).department
    if (details.doctor_name) currentBookingState.doctor_name = details.doctor_name
    if (details.date) currentBookingState.date = details.date
    if (details.time) currentBookingState.time = details.time
    await db.conversation
      .update({
        where: { id: conversationId },
        data: {
          bookingState: currentBookingState,
          bookingStage: intent === 'appointment_booking' ? 'collecting_details' : handoffPending ? 'human_handoff' : 'idle',
          updatedAt: new Date(),
        },
      })
      .catch((err: unknown) => log.warn('booking memory not saved', { err }))
  }

  // The customer explicitly asked for (or agreed to) a person.
  if (intent === 'human_handoff' && handoverEnabled) {
    await handleHumanEscalation({
      tenantId,
      clinic,
      contactId,
      conversationId,
      userMessage: messageText,
      intent: 'human_handover',
      reason: 'Customer asked for / agreed to a team member.',
      responseText: aiText || (await localizedCanned('handoff', lang)),
      accessToken,
      phoneNumberId,
      senderPhone,
      customerLabel: contact?.name || `+${senderPhone}`,
    })
    return true
  }

  if (intent === 'decline_handoff' && handoffPending) {
    await db.conversation.update({ where: { id: conversationId }, data: { bookingStage: 'idle' } }).catch(() => undefined)
  }

  if (intent === 'emergency') {
    await alertTeam({ tenantId, clinic, contactId, conversationId, userMessage: messageText, kind: 'emergency', customerLabel: contact?.name || `+${senderPhone}` })
  }

  // Booking intent → the guided step-by-step flow (or book directly when complete)
  if (intent === 'appointment_booking') {
    const complete =
      currentBookingState.patient_name && currentBookingState.patient_age && currentBookingState.doctor_name && currentBookingState.date && currentBookingState.time
    if (!complete) {
      const flow = bookingFlowData(tenantId, clinic, contact?.name ?? null, contactId)
      const started = await applyBookingFlowResult({ result: await startWizard(flow, flowText), flow, tenantId, clinic, doctors, timings, contactId, conversationId, senderPhone, messageText, accessToken, phoneNumberId, lang })
      if (started) return true
      if (aiText) await reply(aiText, 'appointment_booking', openAIResult.confidence_score)
      return true
    }

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
      await db.conversation.update({
        where: { id: conversationId },
        data: { bookingState: Prisma.DbNull, bookingStage: 'confirmed', updatedAt: new Date() },
      })
    }
    await reply(await localizeText(bookingOutcome.message, lang), 'appointment_booking', openAIResult.confidence_score)
    return true
  }

  await reply(aiText, intent, openAIResult.confidence_score)
  return true
}

/** Slot list computed locally when the booking engine cannot be reached. */
function localFreeSlots(o: { doctors: any[]; timings: any[]; clinic: any; upcomingAppointments: any[]; days: Date[]; todayStr: string }): string {
  const parts: string[] = []
  for (const doc of o.doctors || []) {
    parts.push(`- ${formatDocName(doc.doctorName)}:`)
    let any = false
    for (const d of o.days) {
      const dateStr = getLocalDateString(d)
      const weekday = WEEKDAYS[d.getDay()]
      const clinicEx = (Array.isArray(o.clinic.dateExceptions) ? o.clinic.dateExceptions : []).find((e: any) => e.date === dateStr)
      if (clinicEx?.is_closed) continue
      const timing = (o.timings || []).find((t) => t.dayName.toLowerCase() === weekday.toLowerCase())
      if (!clinicEx && timing?.isClosed) continue
      const docEx = (Array.isArray(doc.dateExceptions) ? doc.dateExceptions : []).find((e: any) => e.date === dateStr)
      if (docEx && !docEx.is_available) continue
      if (!docEx && !doc.availableDays?.some((day: string) => day.toLowerCase() === weekday.toLowerCase())) continue

      let slots: any[] = []
      if (docEx?.slots?.length) slots = docEx.slots.filter((s: any) => s.is_active)
      else if (doc.weeklySlots?.[weekday]) slots = doc.weeklySlots[weekday].filter((s: any) => s.is_active)
      let times: string[] = slots.map((s: any) => String(s.start_time).slice(0, 5))
      if (!times.length) {
        const [startHour] = String(doc.availableStartTime || '09:00').split(':').map(Number)
        const [endHour] = String(doc.availableEndTime || '17:00').split(':').map(Number)
        for (let h = startHour; h < endHour; h++) times.push(`${String(h).padStart(2, '0')}:00`)
      }
      const lunchStart = timing?.lunchBreakStart ? Number(timing.lunchBreakStart.replace(':', '')) : null
      const lunchEnd = timing?.lunchBreakEnd ? Number(timing.lunchBreakEnd.replace(':', '')) : null
      const nowVal = new Date().getHours() * 100 + new Date().getMinutes()
      times = times.filter((t) => {
        const v = Number(t.replace(':', ''))
        if (dateStr === o.todayStr && v <= nowVal) return false
        if (lunchStart !== null && lunchEnd !== null && v >= lunchStart && v < lunchEnd) return false
        return !o.upcomingAppointments.some((a: any) => {
          const ad = a.appointmentDate instanceof Date ? getLocalDateString(a.appointmentDate) : String(a.appointmentDate)
          return a.doctorId === doc.id && ad === dateStr && a.appointmentTime === t
        })
      })
      if (times.length) {
        any = true
        parts.push(`  * ${weekday} ${dateStr}: ${times.join(', ')}`)
      }
    }
    if (!any) parts.push('  * No slots available for the next 7 days.')
  }
  return parts.join('\n')
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

/**
 * Hands the chat to the team — only ever called after the customer asked
 * for a person (or agreed to one). Leaves a note, marks the chat as waiting
 * for staff, alerts the team, and confirms to the customer. The AI keeps
 * helping until a team member actually replies.
 */
async function handleHumanEscalation(options: {
  tenantId: string
  clinic: any
  contactId: string
  conversationId: string
  userMessage: string
  intent: string
  reason: string
  responseText: string
  accessToken: string
  phoneNumberId: string
  senderPhone: string
  customerLabel: string
}) {
  const { tenantId, clinic, contactId, conversationId, userMessage, intent, reason, responseText, accessToken, phoneNumberId, senderPhone } = options
  log.info('handing chat to the team at the customer\'s request', { conversationId, reason })
  const db = tenantDb(tenantId)

  await db.contactNote
    .create({
      data: {
        tenantId,
        contactId,
        userId: clinic.userId,
        noteText: `[AI Handover]\nThe patient asked to talk to a team member.\n- Reason: ${reason}\n- Patient message: "${userMessage.slice(0, 500)}"`,
      },
    })
    .catch((err: unknown) => log.warn('handover note not saved', { err }))

  await db.conversation
    .update({ where: { id: conversationId }, data: { status: 'open', bookingStage: 'human_handoff', bookingState: Prisma.DbNull, updatedAt: new Date() } })
    .catch((err: unknown) => log.warn('handover state not saved', { err }))

  notifyTenant(tenantId, {
    type: 'message',
    title: `${options.customerLabel} wants to talk to the team`,
    body: userMessage.slice(0, 140),
    href: `/inbox?c=${conversationId}`,
  })

  await sendReplyAndSave({
    tenantId,
    clinicId: clinic.id,
    contactId,
    conversationId,
    responseText,
    intent,
    confidence: 1.0,
    userMessage,
    senderPhone,
    accessToken,
    phoneNumberId,
  })
}

/** Alerts the team (note + live notification) without taking the chat from the AI. */
async function alertTeam(o: { tenantId: string; clinic: any; contactId: string; conversationId: string; userMessage: string; kind: 'emergency'; customerLabel: string }) {
  const db = tenantDb(o.tenantId)
  await db.contactNote
    .create({
      data: { tenantId: o.tenantId, contactId: o.contactId, userId: o.clinic.userId, noteText: `[AI Alert: emergency]\nPossible emergency reported on WhatsApp.\n- Patient message: "${o.userMessage.slice(0, 500)}"` },
    })
    .catch((err: unknown) => log.warn('alert note not saved', { err }))
  // Visible in the inbox's open list; the AI is not silenced by this.
  await db.conversation.update({ where: { id: o.conversationId }, data: { status: 'open' } }).catch(() => undefined)
  notifyTenant(o.tenantId, {
    type: 'message',
    title: `🚨 Possible emergency: ${o.customerLabel}`,
    body: o.userMessage.slice(0, 140),
    href: `/inbox?c=${o.conversationId}`,
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
  accessToken: string
  phoneNumberId: string
  /** Customer's language; fixed English/Hinglish texts are translated into it. */
  lang: DetectedLanguage
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
    responseText: await localizeText(text, o.lang),
    intent: 'appointment_booking',
    confidence: 1,
    userMessage: o.messageText,
    senderPhone: o.senderPhone,
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
    accessToken,
    phoneNumberId,
  } = options

  // Replies are sent as normal messages (no quote bubble), the way a person
  // answers in an ongoing chat.
  let sentMessageId: string | undefined = undefined
  try {
    const result = await sendTextMessage({
      phoneNumberId,
      accessToken,
      to: senderPhone,
      text: responseText,
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
