/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Fast-path responder for healthcare WhatsApp automation.
 *
 * Answers a few factual queries WITHOUT calling the AI model, using keyword
 * matching against the cached clinic data. Replies here are fixed English
 * text, so the caller only uses this for clear English messages; everything
 * else goes to the AI, which answers in the customer's own language.
 *
 *   - FAQ keyword match: instant answer
 *   - Clinic hours / address / contact queries: instant formatted answer
 *
 * Greetings, farewells and acknowledgements are deliberately left to the AI
 * so the chat continues naturally instead of receiving a fixed menu.
 *
 * Returns null when nothing matches — the caller proceeds to the AI.
 */

import type { ClinicContext } from './clinic-cache'

export interface FastPathResult {
  response: string
  intent: string
  confidence: number
}

const HOURS_PATTERNS = [
  /\b(timing|timings|hours|open|close|working\s*hours|when.*open|what\s*time.*(open|close))\b/i,
]

const LOCATION_PATTERNS = [
  /\b(where|location|address|directions?|map|how\s*to\s*reach)\b/i,
]

const CONTACT_PATTERNS = [
  /\b(phone number|contact number|call you|your number|email|whatsapp\s*number|contact details)\b/i,
]

export function tryFastPath(
  messageText: string,
  ctx: ClinicContext,
  _isFirstInbound: boolean,
): FastPathResult | null {
  const text = messageText.trim()
  const lower = text.toLowerCase()

  // Booking, cancelling and rescheduling belong to the booking flow / AI.
  if (['book', 'appoint', 'schedul', 'reserv', 'cancel', 'doctor'].some((kw) => lower.includes(kw))) return null

  // Clinical or duration questions need the AI (or a precise FAQ).
  const clinical = ['how long', 'how many hours', 'how much time', 'duration', 'pain', 'hurt', 'fee', 'price', 'cost', 'charge']
  if (clinical.some((kw) => lower.includes(kw))) return null

  // Long or multi-part messages are complex queries.
  if (text.length > 100 || (text.match(/\?/g) || []).length > 1) return null

  const c: any = ctx.clinic || {}

  // ── Clinic hours ────────────────────────────────────────────────────────
  if (HOURS_PATTERNS.some((p) => p.test(lower))) {
    const timings = ctx.timings || []
    if (timings.length > 0) {
      const formatted = timings
        .map((t: any) => {
          if (t.isClosed) return `❌ *${t.dayName}:* Closed`
          const lunch = t.lunchBreakStart && t.lunchBreakEnd ? ` (break ${t.lunchBreakStart}–${t.lunchBreakEnd})` : ''
          return `✅ *${t.dayName}:* ${t.openingTime || '—'} – ${t.closingTime || '—'}${lunch}`
        })
        .join('\n')
      return {
        response: `Our timings${c.clinicName ? ` at *${c.clinicName}*` : ''} ⏰\n\n${formatted}`,
        intent: 'clinic_timings',
        confidence: 0.92,
      }
    }
  }

  // ── Location / address ─────────────────────────────────────────────────
  if (LOCATION_PATTERNS.some((p) => p.test(lower))) {
    const addr = [c.address, c.city, c.state, c.pincode].filter(Boolean).join(', ')
    if (addr) {
      const mapLink = c.googleMapLink ? `\n\nGoogle Maps: ${c.googleMapLink}` : ''
      return {
        response: `📍 ${c.clinicName ? `*${c.clinicName}*\n` : ''}${addr}${mapLink}`,
        intent: 'clinic_location',
        confidence: 0.92,
      }
    }
  }

  // ── Contact info ───────────────────────────────────────────────────────
  if (CONTACT_PATTERNS.some((p) => p.test(lower))) {
    const lines: string[] = []
    if (c.phone) lines.push(`📞 ${c.phone}`)
    if (c.whatsappNumber) lines.push(`💬 WhatsApp: ${c.whatsappNumber}`)
    if (c.email) lines.push(`✉️ ${c.email}`)
    if (c.website) lines.push(`🌐 ${c.website}`)
    if (lines.length > 0) {
      return {
        response: `You can reach us here:\n${lines.join('\n')}`,
        intent: 'contact_info',
        confidence: 0.92,
      }
    }
  }

  // ── FAQ keyword matching ───────────────────────────────────────────────
  const faqMatch = matchFAQ(lower, ctx.faqs || [])
  if (faqMatch) {
    return { response: faqMatch.answer, intent: 'faq_match', confidence: 0.88 }
  }

  return null
}

/**
 * Match patient message against FAQ keywords.
 * Requires an exact question substring match, or ≥2 keyword hits / ≥60% of
 * a FAQ's keywords.
 */
function matchFAQ(lowerMessage: string, faqs: any[]): { question: string; answer: string } | null {
  if (!faqs || faqs.length === 0) return null

  let bestMatch: { question: string; answer: string; score: number } | null = null

  for (const faq of faqs) {
    if (!faq?.answer) continue
    if (faq.question && faq.question.length > 8 && lowerMessage.includes(faq.question.toLowerCase())) {
      return { question: faq.question, answer: faq.answer }
    }

    if (!faq.keywords) continue
    const keywords = String(faq.keywords)
      .split(',')
      .map((k: string) => k.trim().toLowerCase())
      .filter((k: string) => k.length > 2)
    if (keywords.length === 0) continue

    let hits = 0
    for (const kw of keywords) if (lowerMessage.includes(kw)) hits++

    const hitRatio = hits / keywords.length
    if (hits >= 2 || (hits >= 1 && hitRatio >= 0.6)) {
      const score = hits + hitRatio
      if (!bestMatch || score > bestMatch.score) bestMatch = { question: faq.question, answer: faq.answer, score }
    }
  }

  return bestMatch ? { question: bestMatch.question, answer: bestMatch.answer } : null
}
