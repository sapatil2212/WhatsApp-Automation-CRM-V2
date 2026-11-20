import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { extractTextFromDocument, MAX_DOCUMENT_SIZE_BYTES, MAX_DOCUMENT_SIZE_MB } from '@/lib/healthcare/document-parser'
import { analyzeBusinessDocumentWithAI } from '@/lib/healthcare/knowledge-analyzer'

// Increase body size / execution duration limit for Next.js app router if deployed on Vercel or Node
export const maxDuration = 60 // 60 seconds max duration

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

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const profile = await prisma.profile.findUnique({ where: { userId: user.id } })
      return {
        userId: user.id,
        tenantId: profile?.tenantId || user.id,
        email: user.email || '',
      }
    }
  } catch {
    // Ignore fallback errors
  }

  return null
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized. Please log in to upload documents.' }, { status: 401 })
    }

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ error: 'Invalid multipart form data upload.' }, { status: 400 })
    }

    const file = formData.get('file') as File | null
    if (!file || !file.name) {
      return NextResponse.json({ error: 'No document file was provided.' }, { status: 400 })
    }

    if (file.size === 0) {
      return NextResponse.json({ error: 'The uploaded file is empty (0 bytes).' }, { status: 400 })
    }

    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `The uploaded document exceeds the ${MAX_DOCUMENT_SIZE_MB}MB size limit (File size: ${(
            file.size /
            1024 /
            1024
          ).toFixed(1)}MB). Please upload a document up to ${MAX_DOCUMENT_SIZE_MB}MB.`,
        },
        { status: 400 }
      )
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Step 1: Extract text across multi-format documents (PDF, DOCX, XLSX, TXT, etc.)
    let extracted
    try {
      extracted = await extractTextFromDocument(buffer, file.name, file.type)
    } catch (parseErr: any) {
      return NextResponse.json(
        { error: parseErr.message || 'Failed to extract text from the uploaded document.' },
        { status: 400 }
      )
    }

    // Step 2: Fetch existing clinic name for context if available
    const clinic = await prisma.clinic.findFirst({
      where: {
        OR: [{ userId: ctx.userId }, { tenantId: ctx.tenantId }],
      },
      select: { clinicName: true },
    })

    // Step 3: Run AI analysis to extract business details, knowledge base text & FAQs
    const analyzed = await analyzeBusinessDocumentWithAI(extracted.text, file.name, clinic?.clinicName)

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileSizeBytes: file.size,
      fileSizeFormatted: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      charCount: extracted.charCount,
      businessDetails: analyzed.businessDetails,
      doctors: analyzed.doctors,
      services: analyzed.services,
      knowledgeBaseText: analyzed.knowledgeBaseText,
      faqs: analyzed.faqs,
      modelUsed: analyzed.modelUsed,
      rawTokensEstimate: analyzed.rawTokensEstimate,
    })
  } catch (error: any) {
    console.error('[KnowledgeBase Upload Error]:', error)
    return NextResponse.json(
      {
        error: error.message || 'An unexpected error occurred during document scanning and AI analysis.',
      },
      { status: 500 }
    )
  }
}
