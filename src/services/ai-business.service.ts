/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '@/lib/prisma'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { getBusinessSegment, getTerminology } from '@/lib/business/terminology'

function normalizePhone(p: string): string {
  return p.replace(/\D/g, '')
}

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
  } = options

  // Resolve tenantId from profile
  const profile = await prisma.profile.findUnique({
    where: { userId }
  })
  if (!profile || !profile.tenantId) return false

  // Fetch Business Profile
  const business = await prisma.businessProfile.findUnique({
    where: { userId }
  })
  if (!business) {
    console.log('[AI Business] No business profile registered for user ID:', userId)
    return false
  }

  // Fetch AI settings
  const aiSettings = await prisma.businessAISettings.findUnique({
    where: { businessId: business.id }
  })
  if (!aiSettings || !aiSettings.aiEnabled) {
    console.log('[AI Business] AI automation is disabled or not set up.')
    return false
  }

  const segment = getBusinessSegment(profile.businessType);
  const term = getTerminology(segment);

  // Fetch contextual services, FAQs, staff in parallel
  const [services, faqs, staff] = await Promise.all([
    prisma.businessService.findMany({ where: { businessId: business.id, isActive: true } }),
    prisma.businessFAQ.findMany({ where: { businessId: business.id } }),
    prisma.businessStaff.findMany({ where: { businessId: business.id, isActive: true } }),
  ])

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
      console.error('Failed to parse working hours:', e)
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

  const systemPrompt = `You are a professional, polite, and helpful AI assistant for "${business.businessName || 'our business'}" (Category: ${segment}).
Your tone is "${aiSettings.aiTone || 'polite and professional'}".

### BUSINESS PROFILE & DETAILS:
About Us: ${business.description || 'No description provided.'}
Address: ${business.address || ''}, ${business.city || ''}, ${business.state || ''} - ${business.pincode || ''}
Phone: ${business.phone || ''}
WhatsApp: ${business.whatsappNumber || ''}
Email: ${business.email || ''}
Website: ${business.website || ''}
Location Map: ${business.googleMapLink || ''}

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

### INSTRUCTIONS:
- Answer the customer's questions accurately based on the business details, hours, services, and FAQs provided above.
- If they ask about services, explain the pricing (in ₹ INR) and duration.
- YOU OPERATE 24/7: Even if the current time is outside the business working hours, do NOT say "we are closed" in a way that terminates the conversation or refuses to help. Instead, answer all customer questions immediately. If the user wants to book an appointment, record the enquiry/booking request for a future date, and politely state that we will confirm it as soon as we reopen.
- Identify if the user wants to book, modify, cancel, or ask questions.
- If they want to book, extract preferred_date (YYYY-MM-DD), preferred_time (HH:MM), contact_name, and notes.
- Format your response strictly in the JSON schema requested.
- Always output a valid JSON object.
`

  // Fetch recent conversation history (last 8 messages)
  const recentMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })
  
  // Sort chronologically (oldest to newest)
  recentMessages.reverse()

  // Format history for Gemini
  const geminiContents: any[] = []
  for (const msg of recentMessages) {
    if (!msg.contentText) continue
    const role = msg.senderType === 'customer' || msg.senderType === 'contact' || msg.senderType === 'user' ? 'user' : 'model'
    geminiContents.push({
      role,
      parts: [{ text: msg.contentText }]
    })
  }
  // Ensure the current user prompt is attached
  const lastGeminiMsg = geminiContents[geminiContents.length - 1]
  if (!lastGeminiMsg || lastGeminiMsg.role !== 'user' || lastGeminiMsg.parts[0].text !== messageText) {
    geminiContents.push({
      role: 'user',
      parts: [{ text: messageText }]
    })
  }

  // Format history for OpenAI
  const openaiMessages = [
    { role: 'system', content: systemPrompt }
  ]
  for (const msg of recentMessages) {
    if (!msg.contentText) continue
    const role = msg.senderType === 'customer' || msg.senderType === 'contact' || msg.senderType === 'user' ? 'user' : 'assistant'
    openaiMessages.push({
      role,
      content: msg.contentText
    })
  }
  const lastOpenAIMsg = openaiMessages[openaiMessages.length - 1]
  if (!lastOpenAIMsg || lastOpenAIMsg.role !== 'user' || lastOpenAIMsg.content !== messageText) {
    openaiMessages.push({
      role: 'user',
      content: messageText
    })
  }

  // Calling LLM (Gemini with OpenAI fallback)
  async function callLLM(): Promise<string> {
    const openaiKey = process.env.OPENAI_API_KEY
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_SECONDARY

    if (geminiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: geminiContents,
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
                      contact_name: { type: 'STRING' },
                      preferred_date: { type: 'STRING' },
                      preferred_time: { type: 'STRING' },
                      notes: { type: 'STRING' },
                    },
                  },
                },
                required: ['detected_intent', 'ai_response', 'confidence_score', 'is_escalation'],
              },
            },
          }),
        })
        if (res.ok) {
          const data = await res.json()
          return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
        }
      } catch (err) {
        console.error('[AI Business] Gemini failed, falling back to OpenAI:', err)
      }
    }

    if (openaiKey) {
      const url = 'https://api.openai.com/v1/chat/completions'
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: openaiMessages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        return data.choices?.[0]?.message?.content || ''
      }
    }

    throw new Error('No LLM API keys configured.')
  }

  try {
    const rawResult = await callLLM()
    const result: OpenAIResponse = JSON.parse(rawResult)

    if (result.confidence_score < 0.6) {
      console.log('[AI Business] Confidence score too low. Skipping automated reply.')
      return false
    }

    // Handle Human Handover Escalation
    if (result.is_escalation && aiSettings.humanHandoverEnabled) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'open' } // Reopen for human agent review
      })
    }

    // Handle Auto booking
    if (result.detected_intent === 'book_appointment' && result.booking_details) {
      const details = result.booking_details
      const parsedDate = (() => {
        if (details.preferred_date) {
          const d = new Date(details.preferred_date)
          if (!isNaN(d.getTime())) return d
        }
        return new Date()
      })()

      await prisma.businessEnquiry.create({
        data: {
          businessId: business.id,
          contactId: contactId,
          contactName: details.contact_name || profile.fullName || 'WhatsApp Guest',
          contactPhone: senderPhone,
          preferredDate: parsedDate,
          preferredTime: details.preferred_time || '10:00',
          notes: details.notes || 'Automated WhatsApp booking request',
          status: 'pending',
          source: 'whatsapp',
        }
      })
    }

    // Send AI reply text to customer
    if (result.ai_response) {
      await sendTextMessage({
        accessToken,
        phoneNumberId,
        to: senderPhone,
        text: result.ai_response
      })

      // Create AI Response Message log in CRM conversation inbox
      await prisma.message.create({
        data: {
          conversationId,
          senderType: 'bot',
          contentType: 'text',
          contentText: result.ai_response,
          status: 'sent',
        }
      })

      // Create AI Log Activity record
      await prisma.businessAILog.create({
        data: {
          businessId: business.id,
          contactId,
          userMessage: messageText,
          aiResponse: result.ai_response,
          detectedIntent: result.detected_intent,
          confidenceScore: result.confidence_score,
        }
      })
    }

    return true
  } catch (error) {
    console.error('[AI Business] Error executing automation:', error)
    return false
  }
}
