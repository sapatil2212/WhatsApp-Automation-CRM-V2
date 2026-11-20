import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { extractTextFromDocument, MAX_DOCUMENT_SIZE_BYTES, MAX_DOCUMENT_SIZE_MB } from '@/lib/healthcare/document-parser'
import { analyzeBusinessDocumentWithAI } from '@/lib/healthcare/knowledge-analyzer'

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
    // Ignore
  }

  return null
}

export async function POST(request: Request) {
  const guard = await getAuthContext()
  if (!guard) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file || !file.name) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'The uploaded file is empty' }, { status: 400 })
  if (file.size > MAX_DOCUMENT_SIZE_BYTES)
    return NextResponse.json(
      { error: `File exceeds the ${MAX_DOCUMENT_SIZE_MB}MB limit (uploaded: ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
      { status: 400 }
    )

  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const extracted = await extractTextFromDocument(buffer, file.name, file.type)
    const analyzed = await analyzeBusinessDocumentWithAI(extracted.text, file.name)

    return NextResponse.json({
      faqs: analyzed.faqs,
      fileName: file.name,
      businessDetails: analyzed.businessDetails,
      knowledgeBaseText: analyzed.knowledgeBaseText,
    })
  } catch (err: any) {
    console.error('[FAQ Upload] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
