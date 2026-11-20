/* eslint-disable @typescript-eslint/no-explicit-any */
import { cleanEnvValue } from '@/lib/utils'

export interface AnalyzedBusinessDetails {
  clinicName: string
  tagline?: string
  phone?: string
  email?: string
  address?: string
  workingHours?: string
  specialties?: string[]
}

export interface ExtractedDoctorProfile {
  name: string
  specialization?: string
  qualification?: string
  timing?: string
  consultationFee?: string
}

export interface ExtractedServiceItem {
  name: string
  price?: string
  description?: string
}

export interface ExtractedFAQItem {
  question: string
  answer: string
  keywords: string
}

export interface AnalyzedKnowledgeResult {
  businessDetails: AnalyzedBusinessDetails
  doctors: ExtractedDoctorProfile[]
  services: ExtractedServiceItem[]
  knowledgeBaseText: string
  faqs: ExtractedFAQItem[]
  modelUsed: string
  rawTokensEstimate: number
}

const SYSTEM_PROMPT = `You are a Senior Healthcare SaaS Product Architect, Clinical Operations Expert, and WhatsApp AI Knowledge Base Specialist.
Your task is to scan and analyze an authoritative business/clinic document (such as a clinic brochure, services and fee catalog, doctor schedule, patient admission guide, FAQ sheet, or standard operating procedure) and convert it into an exhaustive, highly structured, ground-truth knowledge base.

You must extract EXACT details from the document with zero hallucinations:
1. "businessDetails": Name, tagline, phone numbers, email, physical address/location, working hours, and medical specialties or core offerings.
2. "doctors": List of all doctors, specialists, consultants, or key team members with their qualifications, departments, consultation timings, and fees (if mentioned).
3. "services": List of all treatments, diagnostic procedures, packages, consultation types, and their exact pricing/fees.
4. "knowledgeBaseText": A comprehensive, beautifully formatted Markdown ground-truth document covering:
   - Clinic/Business Overview & Philosophy
   - Full Services, Treatments & Pricing Ground Truth
   - Doctors, Specialists & Availability Ground Truth
   - Clinic Timings, Appointment Booking Rules & Walk-in Guidelines
   - Pre-consultation / Pre-procedure Instructions (e.g. fasting, prior reports)
   - Payment Policies (Cash, UPI, Cards, TPA/Health Insurance)
   - Cancellation, Rescheduling & Refund Rules
   - Emergency & Triage Protocols
5. "faqs": 15 to 40 high-value Frequently Asked Questions with clear, accurate answers and comma-separated trigger keywords.

OUTPUT FORMAT:
You MUST respond with a single valid JSON object strictly matching this schema with no markdown code blocks outside of the JSON:
{
  "businessDetails": {
    "clinicName": "Exact Name or Detected Name",
    "tagline": "Brief clinical tagline",
    "phone": "Contact number(s)",
    "email": "Official email",
    "address": "Full clinic address with landmark",
    "workingHours": "Detailed opening and closing hours",
    "specialties": ["Cardiology", "Dentistry", ...]
  },
  "doctors": [
    {
      "name": "Dr. Full Name",
      "specialization": "Specialization",
      "qualification": "MBBS, MD",
      "timing": "Mon-Fri 10 AM - 2 PM",
      "consultationFee": "₹500"
    }
  ],
  "services": [
    {
      "name": "Service or Treatment Name",
      "price": "₹1,200",
      "description": "Short explanation of the service"
    }
  ],
  "knowledgeBaseText": "## CLINIC OVERVIEW\\n...\\n## SERVICES & PRICING\\n...\\n## DOCTORS & AVAILABILITY\\n...\\n## PATIENT INSTRUCTIONS & POLICIES\\n...",
  "faqs": [
    {
      "question": "What are your consultation timings?",
      "answer": "Our clinic is open Monday through Saturday from 9:00 AM to 8:00 PM.",
      "keywords": "timings, hours, schedule, open, closing"
    }
  ]
}`

/**
 * Truncate text intelligently to roughly 75,000 characters (~18,000 tokens)
 * to prevent context overflow while keeping all essential sections.
 */
function prepareDocumentText(rawText: string): string {
  const MAX_CHARS = 75000
  if (rawText.length <= MAX_CHARS) {
    return rawText
  }
  // Take first 55,000 chars and last 20,000 chars (usually summaries/policies/contacts are at the end)
  const head = rawText.slice(0, 55000)
  const tail = rawText.slice(-20000)
  return `${head}\n\n[... Document truncated due to length ...]\n\n${tail}`
}

function parseJSONSafely(text: string): any {
  // Strip Markdown code fences if present
  let clean = text.trim()
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  try {
    return JSON.parse(clean)
  } catch {
    // Try to locate first '{' and last '}'
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start !== -1 && end > start) {
      const sub = clean.slice(start, end + 1)
      return JSON.parse(sub)
    }
    throw new Error('Failed to parse AI JSON response.')
  }
}

/**
 * Calls AI to auto-analyze a business/clinic document.
 * Tries OpenRouter first (with gemini-2.5-flash / gpt-4o-mini), then fallback options.
 */
export async function analyzeBusinessDocumentWithAI(
  documentText: string,
  fileName: string,
  existingClinicName?: string
): Promise<AnalyzedKnowledgeResult> {
  const preparedText = prepareDocumentText(documentText)
  const openRouterKey =
    cleanEnvValue(process.env.OPENROUTER_API_KEY) ||
    (process.env.OPENAI_API_KEY?.startsWith('sk-or-v1-') ? cleanEnvValue(process.env.OPENAI_API_KEY) : '')
  const geminiKey = cleanEnvValue(process.env.GEMINI_API_KEY) || cleanEnvValue(process.env.GEMINI_API_KEY_SECONDARY)
  const openAIKey =
    process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('sk-or-v1-')
      ? cleanEnvValue(process.env.OPENAI_API_KEY)
      : ''

  const userPrompt = `Document Filename: ${fileName}
${existingClinicName ? `Associated Business Name: ${existingClinicName}\n` : ''}

=== DOCUMENT TEXT BEGIN ===
${preparedText}
=== DOCUMENT TEXT END ===

Extract the complete operational knowledge base, doctors, services, policies, and FAQs in the requested JSON format.`

  let rawResponseText = ''
  let modelUsed = ''

  // 1. Try OpenRouter (Verified fast & reliable)
  if (openRouterKey) {
    const modelsToTry = [
      { model: 'openai/gpt-4o-mini', maxTokens: 2800 },
      { model: 'google/gemini-2.5-flash', maxTokens: 1400 },
      { model: 'google/gemini-2.0-flash-exp:free', maxTokens: 3000 },
      { model: 'meta-llama/llama-3.1-8b-instruct:free', maxTokens: 3000 },
      { model: 'qwen/qwen-2.5-72b-instruct:free', maxTokens: 3000 },
    ]

    for (const { model, maxTokens } of modelsToTry) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://chatnexgen.online',
            'X-Title': 'ChatNexGen Healthcare AI',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: maxTokens,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          rawResponseText = data?.choices?.[0]?.message?.content || ''
          if (rawResponseText) {
            modelUsed = `OpenRouter (${model})`
            break
          }
        } else {
          const errText = await res.text()
          console.warn(`[KnowledgeAnalyzer] OpenRouter ${model} returned ${res.status}:`, errText)
        }
      } catch (err) {
        console.warn(`[KnowledgeAnalyzer] OpenRouter model ${model} failed:`, err)
      }
    }
  }

  // 2. Direct Gemini fallback
  if (!rawResponseText && geminiKey) {
    const geminiModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
    for (const model of geminiModels) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }],
                },
              ],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                responseMimeType: 'application/json',
              },
            }),
          }
        )

        if (res.ok) {
          const data = await res.json()
          rawResponseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
          if (rawResponseText) {
            modelUsed = `Gemini (${model})`
            break
          }
        }
      } catch (err) {
        console.warn(`[KnowledgeAnalyzer] Gemini model ${model} failed:`, err)
      }
    }
  }

  // 3. Direct OpenAI fallback
  if (!rawResponseText && openAIKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openAIKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 8192,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        rawResponseText = data?.choices?.[0]?.message?.content || ''
        if (rawResponseText) {
          modelUsed = 'OpenAI (gpt-4o-mini)'
        }
      }
    } catch (err) {
      console.warn('[KnowledgeAnalyzer] OpenAI failed:', err)
    }
  }

  if (!rawResponseText) {
    throw new Error(
      'Unable to contact AI analysis service. Please verify your OpenRouter or Gemini API keys in the environment settings.'
    )
  }

  const parsed = parseJSONSafely(rawResponseText)

  const businessDetails: AnalyzedBusinessDetails = {
    clinicName: parsed?.businessDetails?.clinicName || existingClinicName || 'Our Clinic',
    tagline: parsed?.businessDetails?.tagline || '',
    phone: parsed?.businessDetails?.phone || '',
    email: parsed?.businessDetails?.email || '',
    address: parsed?.businessDetails?.address || '',
    workingHours: parsed?.businessDetails?.workingHours || '',
    specialties: Array.isArray(parsed?.businessDetails?.specialties) ? parsed.businessDetails.specialties : [],
  }

  const doctors: ExtractedDoctorProfile[] = Array.isArray(parsed?.doctors)
    ? parsed.doctors
        .filter((d: any) => d && d.name)
        .map((d: any) => ({
          name: String(d.name).trim(),
          specialization: d.specialization ? String(d.specialization).trim() : '',
          qualification: d.qualification ? String(d.qualification).trim() : '',
          timing: d.timing ? String(d.timing).trim() : '',
          consultationFee: d.consultationFee ? String(d.consultationFee).trim() : '',
        }))
    : []

  const services: ExtractedServiceItem[] = Array.isArray(parsed?.services)
    ? parsed.services
        .filter((s: any) => s && s.name)
        .map((s: any) => ({
          name: String(s.name).trim(),
          price: s.price ? String(s.price).trim() : '',
          description: s.description ? String(s.description).trim() : '',
        }))
    : []

  const faqs: ExtractedFAQItem[] = Array.isArray(parsed?.faqs)
    ? parsed.faqs
        .filter((f: any) => f && f.question && f.answer)
        .map((f: any) => ({
          question: String(f.question).trim(),
          answer: String(f.answer).trim(),
          keywords: f.keywords ? String(f.keywords).trim() : '',
        }))
    : []

  let knowledgeBaseText =
    typeof parsed?.knowledgeBaseText === 'string' && parsed.knowledgeBaseText.trim()
      ? parsed.knowledgeBaseText.trim()
      : ''

  // Fallback: If knowledgeBaseText wasn't formatted as markdown in JSON, build an authoritative markdown summary
  if (!knowledgeBaseText) {
    const lines: string[] = []
    lines.push(`# ${businessDetails.clinicName} — Operational Ground Truth`)
    if (businessDetails.tagline) lines.push(`> ${businessDetails.tagline}\n`)
    if (businessDetails.workingHours) lines.push(`**Working Hours:** ${businessDetails.workingHours}`)
    if (businessDetails.phone) lines.push(`**Phone / Contact:** ${businessDetails.phone}`)
    if (businessDetails.address) lines.push(`**Address:** ${businessDetails.address}\n`)

    if (doctors.length > 0) {
      lines.push(`\n## DOCTORS & SPECIALISTS`)
      doctors.forEach((d) => {
        lines.push(`- **${d.name}** (${d.specialization || 'Consultant'})`)
        if (d.qualification) lines.push(`  Qualification: ${d.qualification}`)
        if (d.timing) lines.push(`  Timings: ${d.timing}`)
        if (d.consultationFee) lines.push(`  Consultation Fee: ${d.consultationFee}`)
      })
    }

    if (services.length > 0) {
      lines.push(`\n## SERVICES & TREATMENTS`)
      services.forEach((s) => {
        lines.push(`- **${s.name}**: ${s.price ? `Price ${s.price}` : ''} ${s.description ? `— ${s.description}` : ''}`)
      })
    }

    knowledgeBaseText = lines.join('\n')
  }

  return {
    businessDetails,
    doctors,
    services,
    knowledgeBaseText,
    faqs,
    modelUsed,
    rawTokensEstimate: Math.ceil((preparedText.length + rawResponseText.length) / 4),
  }
}
