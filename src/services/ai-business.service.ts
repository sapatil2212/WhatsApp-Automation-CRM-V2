/* eslint-disable @typescript-eslint/no-explicit-any */
import { getLogger, systemDb, tenantDb } from '@/server/kernel'
import { callLLM, inferTaskCriticality, parseJSONFromLLM } from '@/lib/ai/llm'
import { languageInstruction } from '@/lib/ai/language'
import { buildMemory, declinesHuman, ensureLanguage, HANDOFF_RULES, HUMAN_STYLE_RULES, humanIsActive, localizeText, localizedCanned, wantsHuman } from '@/lib/ai/conversation-kit'
import { notifyTenant } from '@/server/services/booking-notify'
import { AiUnavailableError } from '@/lib/ai/outcome'
import type { ReplyContext } from '@/lib/ai/reply-context'
import { publicBook, publicSlots } from '@/server/services/public-booking.service'
import { pretty, prettyTime } from '@/server/services/booking-notify'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { getBusinessSegment } from '@/lib/business/terminology'

/**
 * Intents the responder classifies every message into. `opt_out` and
 * `human_handoff` trigger side effects; the rest shape the reply.
 */
export const BUSINESS_INTENTS = [
  'greeting',
  'product_or_service_info',
  'pricing',
  'book_appointment',
  'availability_or_hours',
  'location_or_directions',
  'order_or_booking_status',
  'offer_or_campaign_response',
  'purchase_intent',
  'complaint',
  'feedback',
  'human_handoff',
  'decline_handoff',
  'opt_out',
  'other',
] as const

interface OpenAIResponse {
  detected_intent: string
  ai_response: string
  confidence_score: number
  is_escalation: boolean
  booking_details?: {
    contact_name?: string
    preferred_date?: string 
    preferred_time?: string 
    notes?: string
  }
}

const log = getLogger('ai.business')

export async function processBusinessAIMessage(options: {
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
  replyContext?: ReplyContext
}): Promise<boolean> {
  const {
    messageText,
    senderPhone,
    contactId,
    userId,
    conversationId,
    accessToken,
    phoneNumberId,
  } = options

  // Resolve tenantId from profile
  // Justified systemDb: resolves the tenant for this WhatsApp number's owner.
  const profile = await systemDb.profile.findUnique({
    where: { userId },
    select: { tenantId: true, businessType: true },
  })
  if (!profile || !profile.tenantId) return false
  const tenantId = profile.tenantId

  // Fetch Business Profile
  const business = await tenantDb(tenantId).businessProfile.findUnique({
    where: { userId }
  })
  if (!business) {
    log.info('declined: no business profile', { userId })
    return false
  }

  // Fetch AI settings
  const aiSettings = await tenantDb(tenantId).businessAISettings.findUnique({
    where: { businessId: business.id }
  })
  if (!aiSettings || !aiSettings.aiEnabled) {
    log.info('declined: AI disabled', { businessId: business.id })
    return false
  }

  const segment = getBusinessSegment(profile.businessType);
  const db = tenantDb(tenantId)
  // Business knowledge + conversation memory in parallel
  const [services, faqs, staff, recentMessages, conv, contact] = await Promise.all([
    db.businessService.findMany({ where: { businessId: business.id, isActive: true } }),
    db.businessFAQ.findMany({ where: { businessId: business.id } }),
    db.businessStaff.findMany({ where: { businessId: business.id, isActive: true } }),
    db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { senderType: true, contentType: true, contentText: true, createdAt: true },
    }),
    db.conversation.findUnique({ where: { id: conversationId }, select: { bookingStage: true } }),
    db.contact.findUnique({ where: { id: contactId }, select: { name: true, phone: true } }),
  ])
  const memory = buildMemory(recentMessages, messageText)
  const lang = memory.language
  let handoffPending = conv?.bookingStage === 'human_handoff'
  const handoverEnabled = aiSettings.humanHandoverEnabled !== false
  const customerLabel = contact?.name || `+${senderPhone}`

  const send = async (text: string, intent: string, confidence: number) => {
    await sendTextMessage({ accessToken, phoneNumberId, to: senderPhone, text })
    await Promise.all([
      db.message.create({ data: { conversationId, senderType: 'bot', contentType: 'text', contentText: text, status: 'sent' } }),
      db.conversation.update({ where: { id: conversationId }, data: { lastMessageText: text.slice(0, 500), lastMessageAt: new Date() } }),
      db.businessAILog.create({
        data: {
          businessId: business.id,
          contactId,
          userMessage: messageText,
          aiResponse: text,
          detectedIntent: options.replyContext && options.replyContext.layer !== 'general' ? `${intent} (${options.replyContext.label})`.slice(0, 190) : intent,
          confidenceScore: confidence,
        },
      }),
    ]).catch((error) => log.error('reply bookkeeping failed', { conversationId, err: error }))
  }

  const handOver = async (text: string, reason: string) => {
    await db.contactNote
      .create({ data: { tenantId, contactId, userId, noteText: `[AI Handover]\nThe customer asked to talk to a team member.\n- Reason: ${reason}\n- Message: "${messageText.slice(0, 500)}"` } })
      .catch((error) => log.warn('handover note failed', { err: error }))
    await db.conversation
      .update({ where: { id: conversationId }, data: { status: 'open', bookingStage: 'human_handoff' } })
      .catch((error) => log.warn('handover state failed', { err: error }))
    notifyTenant(tenantId, { type: 'message', title: `${customerLabel} wants to talk to the team`, body: messageText.slice(0, 140), href: `/inbox?c=${conversationId}` })
    await send(text, 'human_handoff', 1)
  }

  // A team member is chatting with this customer right now: stay out of it.
  if (humanIsActive(memory)) {
    log.info('team member active in this chat; AI stays quiet', { conversationId })
    return true
  }

  // Handover only when the customer asks for it.
  if (declinesHuman(messageText)) {
    if (handoffPending) {
      await db.conversation.update({ where: { id: conversationId }, data: { bookingStage: 'idle' } }).catch(() => undefined)
      handoffPending = false
    }
  } else if (handoverEnabled && wantsHuman(messageText)) {
    await handOver(await localizedCanned('handoff', lang), 'Customer asked to talk to a team member.')
    return true
  }

  // Build working hours context
  let workingHoursText = 'Not specified.'
  if (business.workingHours) {
    try {
      const hours = typeof business.workingHours === 'string' 
        ? JSON.parse(business.workingHours) 
        : business.workingHours
      if (Array.isArray(hours)) {
        workingHoursText = hours
          .map((h: any) => `- ${h.day_name || h.dayName || ''}: ${h.is_closed || h.isClosed ? 'Closed' : `${h.opening_time || h.openingTime || ''} - ${h.closing_time || h.closingTime || ''}`}`)
          .join('\n')
      }
    } catch (e) {
      log.warn('could not parse working hours', { err: e })
    }
  }

  // Get current date & time info in India (IST)
  const nowTime = new Date()
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const currentDay = daysOfWeek[nowTime.getDay()]
  const currentDateStr = nowTime.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full' })
  const currentTimeStr = nowTime.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' })
  
  // Format next 7 days calendar window for resolving relative days
  const calendarWindow = []
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const dayName = daysOfWeek[d.getDay()]
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    calendarWindow.push(`- ${dayName}: ${yyyy}-${mm}-${dd}${i === 0 ? ' (Today)' : i === 1 ? ' (Tomorrow)' : ''}`)
  }
  const calendarContext = calendarWindow.join('\n')

  // Build prompts contexts
  const servicesContext = services
    .map((s) => `- ${s.name}: ${s.description || ''} (Price: ₹${s.price || 0}, duration ${s.durationMinutes || 30} mins)`)
    .join('\n')

  const faqsContext = faqs
    .map((f) => `Q: "${f.question}"\nA: "${f.answer}"`)
    .join('\n')

  const staffContext = staff
    .map((st) => `- ${st.name} (${st.role || 'Staff'}) ${st.specialization ? `- Spec: ${st.specialization}` : ''}`)
    .join('\n')

  // Build "online presence" links block (only include what's provided)
  const onlineLinks = [
    business.website ? `Website: ${business.website}` : '',
    business.googleMapLink ? `Google Business / Maps: ${business.googleMapLink}` : '',
    (business as any).instagramUrl ? `Instagram: ${(business as any).instagramUrl}` : '',
    (business as any).facebookUrl ? `Facebook: ${(business as any).facebookUrl}` : '',
  ].filter(Boolean).join('\n')

  const expertKnowledge = ((business as any).aiKnowledgeBase || '').toString().trim()

  const escalationHints = (Array.isArray(aiSettings.escalationKeywords) ? aiSettings.escalationKeywords : []).map(String).filter((k) => k.trim())

  const systemPrompt = `You are the WhatsApp front-desk assistant of "${business.businessName || 'our business'}", an expert in the ${segment} field. You know this business inside-out and chat with the warmth of an experienced team member — never like a generic chatbot.
Your tone is "${aiSettings.aiTone || 'polite and professional'}".

### BUSINESS PROFILE & DETAILS:
About Us: ${business.description || 'No description provided.'}
Address: ${business.address || ''}, ${business.city || ''}, ${business.state || ''} - ${business.pincode || ''}
Phone: ${business.phone || ''}
WhatsApp: ${business.whatsappNumber || ''}
Email: ${business.email || ''}

### ONLINE PRESENCE & REFERENCE LINKS (share these when a customer wants photos, reviews, directions, portfolio, or more detail):
${onlineLinks || 'No public links provided.'}

${expertKnowledge ? `### EXPERT KNOWLEDGE (authoritative — treat this as ground truth about the business):\n${expertKnowledge}\n` : ''}

### BUSINESS HOURS:
${workingHoursText}

### CURRENT DATE, TIME & CALENDAR WINDOW (Use this to resolve relative dates like "tomorrow" or "next Monday" to YYYY-MM-DD):
Current Time: ${currentDay}, ${currentDateStr} at ${currentTimeStr}

7-Day Calendar Reference:
${calendarContext}

### SERVICES OFFERED:
${servicesContext || 'No specific services listed. General bookings.'}

### AVAILABLE STAFF / PROVIDERS:
${staffContext || 'General staff handles bookings.'}

### FREQUENTLY ASKED QUESTIONS (Use these answers directly):
${faqsContext || 'Answer customer queries politely according to business guidelines.'}

${languageInstruction(lang)}

${HUMAN_STYLE_RULES}

### WHERE THIS CHAT CAME FROM
${options.replyContext?.promptBlock ?? 'Normal WhatsApp message. Work out what they want from their message and the conversation.'}

### THIS CUSTOMER
${contact?.name && contact.name !== contact.phone && /\p{L}/u.test(contact.name) ? `WhatsApp name: ${contact.name}` : 'Name not known yet.'}
${options.isFirstInboundMessage ? `This is their first message ever. Welcome them warmly${aiSettings.greetingMessage ? ` in the spirit of: "${String(aiSettings.greetingMessage).replace(/"/g, "'").slice(0, 400)}"` : ''} and answer what they asked.` : ''}
${handoffPending ? 'Earlier in this chat the customer asked for a team member and the team has been informed. Keep helping meanwhile; do not repeat the transfer message.' : ''}

### BOOKING CONVERSATION (one small step at a time)
1. They want to book and you don't know their name → ask for their name warmly, in their language.
2. Then ask for what is still missing (service, date, time) — skip anything already known from the chat.
3. When name, service, preferred_date (YYYY-MM-DD) and preferred_time (HH:MM) are known, set detected_intent "book_appointment" with booking_details — the system checks availability, books it and sends the token number. Don't claim it is confirmed yourself.

### HOW TO ANSWER
- Act as a genuine expert in the ${segment} field. Give confident, specific, helpful answers grounded in the business details, knowledge, services and FAQs above.
- If a detail (exact price, availability, policy) is not provided, say you'll check with the team — never invent figures, guarantees, or medical/legal/financial advice.
- Explain pricing in ₹ and recommend the most relevant option for their need. Share a link from ONLINE PRESENCE when they want photos, reviews, directions or more detail.
- You reply 24/7. Outside working hours, still help fully; for bookings, take the details for an open day.

${HANDOFF_RULES}
${escalationHints.length ? `- Phrases this business treats as "wants a person": ${escalationHints.slice(0, 20).join(', ')} — but only when the customer actually asks for one (watch for "no need", "nako", "nahi").` : ''}

### INTENT DETECTION
Classify the customer's latest message into exactly one detected_intent:
${BUSINESS_INTENTS.join(', ')}.
- "opt_out": they ask to stop / unsubscribe / not be messaged. Reply with a short, polite confirmation only.
- "human_handoff": ONLY when they clearly ask for a person, or agree after you offered.
- "decline_handoff": they say they don't need a transfer — keep helping.
- "offer_or_campaign_response": they are responding to a campaign or ad offer described above.
- "book_appointment": fill booking_details when they want to book.

### OUTPUT — return ONLY this JSON object:
{"detected_intent":"one of the intents","ai_response":"your WhatsApp reply, in the customer's language","confidence_score":0.0-1.0,"booking_details":{"contact_name":"","preferred_date":"YYYY-MM-DD","preferred_time":"HH:MM","notes":""}}
Omit booking_details unless detected_intent is book_appointment.
`

  try {
    const llm = await callLLM(messageText, {
      systemPrompt,
      history: memory.history,
      taskCriticality: inferTaskCriticality(messageText),
      maxTokens: 900,
      temperature: 0.4,
      jsonMode: true,
      timeoutMs: 20_000,
      deadlineMs: 45_000,
    })
    const result = llm.success ? parseJSONFromLLM<OpenAIResponse>(llm.text) : null
    if (!result || typeof result.ai_response !== 'string') {
      log.warn('LLM unavailable or unparseable', { logs: llm.debugLogs.slice(-6) })
      throw new AiUnavailableError('LLM did not return a usable response.')
    }
    log.info('ai reply generated', { provider: llm.provider, model: llm.model, tokens: llm.tokensUsed, lang: lang.code })
    result.confidence_score = Number(result.confidence_score) || 0
    result.ai_response = await ensureLanguage(result.ai_response.trim(), lang)
    const intent = String(result.detected_intent || 'other')

    // Opt-out: tag the contact so campaigns can exclude them, confirm once.
    if (intent === 'opt_out') {
      try {
        const tag =
          (await db.tag.findFirst({ where: { name: 'Unsubscribed' } })) ??
          (await db.tag.create({ data: { tenantId: profile.tenantId, userId, name: 'Unsubscribed', color: '#ef4444' } }))
        await db.contactTag.upsert({
          where: { contactId_tagId: { contactId, tagId: tag.id } },
          create: { contactId, tagId: tag.id },
          update: {},
        })
      } catch (error) {
        log.error('opt-out tag failed', { contactId, err: error })
      }
    }

    // The customer explicitly asked for (or agreed to) a person.
    if (intent === 'human_handoff' && handoverEnabled) {
      await handOver(result.ai_response || (await localizedCanned('handoff', lang)), 'Customer asked for / agreed to a team member.')
      return true
    }
    if (intent === 'decline_handoff' && handoffPending) {
      await db.conversation.update({ where: { id: conversationId }, data: { bookingStage: 'idle' } }).catch(() => undefined)
    }

    // Booking: check the slot against working hours, closures and existing
    // bookings, book it with a token, or offer real alternatives.
    if (intent === 'book_appointment' && result.booking_details) {
      const details = result.booking_details
      const date = /^\d{4}-\d{2}-\d{2}$/.test(details.preferred_date || '') ? details.preferred_date! : null
      const time = /^\d{1,2}:\d{2}$/.test(details.preferred_time || '') ? details.preferred_time!.padStart(5, '0') : null
      if (date && time && (details.contact_name || '').trim()) {
        try {
          const booked = await publicBook(
            business.id,
            // The customer started this WhatsApp chat themselves, so replies on WhatsApp are expected.
            { name: details.contact_name!.trim(), phone: senderPhone, date, time, notes: details.notes || undefined, countryCode: '91', whatsappConsent: true },
            'whatsapp_ai',
          )
          // publicBook already sent the confirmation with the token.
          if (booked.whatsappSent) return true
          result.ai_response = await localizeText(`✅ Booking confirmed for ${pretty(date)} at ${prettyTime(time)}. Your token number is *${booked.token}* (Ref ${booked.ref}).`, lang)
        } catch (bookErr: any) {
          const slots = await publicSlots(business.id, { from: date, days: 3 }).catch(() => null)
          const options = (slots?.days ?? []).filter((d) => d.slots.length).slice(0, 3)
            .map((d) => `📅 ${pretty(d.date)}: ${d.slots.slice(0, 6).map(prettyTime).join(', ')}`)
          result.ai_response = await localizeText(
            `${bookErr?.message || 'That time is not available.'}${options.length ? `\n\nAvailable times:\n${options.join('\n')}\n\nWhich one works for you?` : ''}`,
            lang,
          )
        }
      }
    }

    if (!result.ai_response) {
      // Nothing to say is only valid for an opt-out already confirmed elsewhere.
      if (intent === 'opt_out') return true
      throw new AiUnavailableError('LLM returned an empty reply.')
    }
    await send(result.ai_response, intent, result.confidence_score)
    return true
  } catch (error) {
    // Let the router decide: retry if nothing was sent, otherwise treat as handled.
    log.error('reply failed', { conversationId, err: error })
    throw error
  }
}
