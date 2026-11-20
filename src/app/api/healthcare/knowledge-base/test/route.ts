import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import { cleanEnvValue } from '@/lib/utils'

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

  return null
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { message, knowledgeBaseText: customKb } = body

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Message is required for testing' }, { status: 400 })
    }

    let kbText = customKb
    let clinicName = 'Our Clinic'

    if (!kbText) {
      const clinic = await prisma.clinic.findFirst({
        where: {
          OR: [{ userId: ctx.userId }, { tenantId: ctx.tenantId }],
        },
        include: { faqs: true },
      })
      if (clinic) {
        clinicName = clinic.clinicName
        kbText = clinic.aiKnowledgeBase || ''
        if (clinic.faqs && clinic.faqs.length > 0) {
          kbText += `\n\n### APPROVED CLINIC FAQS:\n`
          clinic.faqs.forEach((f) => {
            kbText += `Q: ${f.question}\nA: ${f.answer}\n`
          })
        }
      }
    }

    if (!kbText || !kbText.trim()) {
      return NextResponse.json({
        reply:
          "The Knowledge Base is currently empty. Please upload a business document or enter knowledge base text above, then test again!",
      })
    }

    const systemPrompt = `You are the empathetic, professional, 24/7 AI WhatsApp receptionist for "${clinicName}".
You must answer patient inquiries strictly based on the provided AUTHORITATIVE KNOWLEDGE BASE below.
Rules:
1. Answer clearly, warmly, and concisely (suitable for a WhatsApp message, under 150 words).
2. If pricing, doctor timings, or instructions are in the knowledge base, state them exactly.
3. If an answer cannot be determined from the knowledge base, politely state that you will connect them with a human clinic coordinator to confirm.
4. Format with clean bullet points or short paragraphs for WhatsApp readability.

### AUTHORITATIVE CLINIC KNOWLEDGE BASE:
${kbText.trim()}`

    const openRouterKey =
      cleanEnvValue(process.env.OPENROUTER_API_KEY) ||
      (process.env.OPENAI_API_KEY?.startsWith('sk-or-v1-') ? cleanEnvValue(process.env.OPENAI_API_KEY) : '')
    const geminiKey = cleanEnvValue(process.env.GEMINI_API_KEY) || cleanEnvValue(process.env.GEMINI_API_KEY_SECONDARY)

    let replyText = ''

    if (openRouterKey) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://chatnexgen.online',
            'X-Title': 'ChatNexGen Playground',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message.trim() },
            ],
            temperature: 0.2,
            max_tokens: 500,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          replyText = data?.choices?.[0]?.message?.content || ''
        }
      } catch (err) {
        console.warn('[KB Test] OpenRouter error:', err)
      }
    }

    if (!replyText && geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${systemPrompt}\n\nPatient Query: ${message.trim()}` }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
            }),
          }
        )
        if (res.ok) {
          const data = await res.json()
          replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
        }
      } catch (err) {
        console.warn('[KB Test] Gemini error:', err)
      }
    }

    if (!replyText) {
      replyText = `Thank you for reaching out to ${clinicName}! Our team is reviewing your query: "${message}". Please confirm your API keys in the environment settings to enable live AI responses.`
    }

    return NextResponse.json({
      reply: replyText.trim(),
    })
  } catch (error: any) {
    console.error('[KB Test] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
