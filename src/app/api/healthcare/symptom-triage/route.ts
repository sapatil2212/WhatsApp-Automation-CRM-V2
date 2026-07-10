import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

interface TriageRequest {
  symptoms: string
  clinicId: string
  userId: string
}

interface TriageResult {
  urgency: 'emergency' | 'urgent' | 'routine' | 'self_care'
  recommended_specialist: string | null
  recommended_doctor_id: string | null
  suggested_action: string
  care_advice: string
  should_escalate: boolean
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as TriageRequest | null
  if (!body || !body.symptoms?.trim() || !body.clinicId) {
    return NextResponse.json({ error: 'symptoms and clinicId are required' }, { status: 400 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 })
  }

  // Fetch doctors for specialist matching
  const doctors = await prisma.doctor.findMany({
    where: { clinicId: body.clinicId },
    select: { id: true, doctorName: true, specialization: true }
  })

  const doctorsContext = (doctors || [])
    .map((d: any) => `- ${d.doctorName} (${d.specialization || 'General'}) [ID: ${d.id}]`)
    .join('\n')

  const systemPrompt = `You are a medical triage assistant. You do NOT diagnose conditions or prescribe treatments. Your role is to assess reported symptoms and determine urgency level and appropriate specialist routing.

### AVAILABLE DOCTORS AT THIS CLINIC:
${doctorsContext || 'No doctors registered.'}

### RULES:
- NEVER diagnose diseases or medical conditions
- NEVER prescribe or recommend specific medications
- Assess symptom severity and urgency objectively
- Route to appropriate specialist based on symptoms
- Flag emergencies immediately (chest pain, breathing difficulty, severe bleeding, loss of consciousness, stroke symptoms)
- Provide general comfort/first-aid advice only (not treatment)

### OUTPUT FORMAT (valid JSON):
{
  "urgency": "emergency" | "urgent" | "routine" | "self_care",
  "recommended_specialist": "Specialization name or null",
  "recommended_doctor_id": "Doctor UUID from the list above, or null if no match",
  "suggested_action": "Brief action recommendation for the patient",
  "care_advice": "Brief general comfort advice (non-diagnostic, non-prescriptive)",
  "should_escalate": true/false (true for emergency/urgent cases needing human attention)
}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: `Patient reports: ${body.symptoms}` }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                urgency: { type: 'STRING', description: 'emergency, urgent, routine, or self_care' },
                recommended_specialist: { type: 'STRING' },
                recommended_doctor_id: { type: 'STRING' },
                suggested_action: { type: 'STRING' },
                care_advice: { type: 'STRING' },
                should_escalate: { type: 'BOOLEAN' },
              },
              required: ['urgency', 'suggested_action', 'care_advice', 'should_escalate'],
            },
          },
        }),
      }
    )

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Gemini API failed: ${response.status} ${errText}`)
    }

    const resData = await response.json()
    const content = resData.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) throw new Error('No content from Gemini')

    const result: TriageResult = JSON.parse(content)

    // Log triage for analytics
    await prisma.aiChatLog.create({
      data: {
        clinicId: body.clinicId,
        patientId: body.userId,
        userMessage: `[SYMPTOM TRIAGE] ${body.symptoms}`,
        aiResponse: JSON.stringify(result),
        detectedIntent: 'symptom_triage',
        confidenceScore: 0.9,
      }
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    clearTimeout(timeoutId)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Symptom Triage] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
