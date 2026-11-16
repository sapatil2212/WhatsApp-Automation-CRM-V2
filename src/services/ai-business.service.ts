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

  // Build "online presence" links block (only include what's provided)
  const onlineLinks = [
    business.website ? `Website: ${business.website}` : '',
    business.googleMapLink ? `Google Business / Maps: ${business.googleMapLink}` : '',
    (business as any).instagramUrl ? `Instagram: ${(business as any).instagramUrl}` : '',
    (business as any).facebookUrl ? `Facebook: ${(business as any).facebookUrl}` : '',
  ].filter(Boolean).join('\n')

  const expertKnowledge = ((business as any).aiKnowledgeBase || '').toString().trim()

  const systemPrompt = `You are the official senior AI representative for "${business.businessName || 'our business'}", an expert in the ${segment} field. You know this business inside-out and speak with the confidence and warmth of an experienced team member — never like a generic chatbot.
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

### HOW TO RESPOND (answer like a knowledgeable expert):
- Act as a genuine expert in the ${segment} domain. Give confident, specific, helpful answers — not vague deflections. Draw on the About Us, Expert Knowledge, services, and FAQs above as your source of truth.
- Be accurate and grounded. Only state facts supported by the business details above. If a specific detail (exact price, availability, policy) is genuinely not provided, say you'll confirm with the team rather than inventing it. Never fabricate figures, guarantees, or medical/legal/financial advice.
- If the customer asks about services, explain pricing (in ₹ INR) and duration clearly, and recommend the most relevant option for their need like an expert advisor would.
- When a customer wants photos, reviews, directions, a portfolio, or fuller details, proactively share the relevant reference link from the ONLINE PRESENCE section above.
- Keep replies concise and WhatsApp-friendly (short paragraphs, no markdown headings). Match the customer's language.
- YOU OPERATE 24/7: Even outside working hours, do NOT say "we are closed" in a way that ends the conversation. Answer immediately. If they want to book, record the enquiry for a future date and say the team will confirm once open.
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
