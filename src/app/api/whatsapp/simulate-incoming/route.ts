import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'
import { decrypt } from '@/lib/whatsapp/encryption'
import { processHealthcareAIMessage } from '@/services/ai-healthcare.service'

export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const cookieStore = await cookies()
    const accessToken = cookieStore.get('accessToken')?.value
    const refreshToken = cookieStore.get('refreshToken')?.value

    let payload = accessToken ? verifyAccessToken(accessToken) : null
    if (!payload && refreshToken) {
      const rotation = await rotateRefreshToken(refreshToken)
      if (rotation) payload = rotation.user
    }

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { conversationId, messageText } = body

    if (!conversationId || !messageText) {
      return NextResponse.json(
        { error: 'conversationId and messageText are required' },
        { status: 400 }
      )
    }

    // ── Fetch conversation and contact via Prisma ─────────────────────────────
    const profile = await prisma.profile.findUnique({ where: { userId: payload.userId } })
    if (!profile?.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId: profile.tenantId },
      include: { contact: true },
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const contact = conversation.contact
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 400 })
    }

    // ── 1. Insert patient's simulated message ─────────────────────────────────
    const simulatedMsgId = `sim-user-${Date.now()}`
    const messageRecord = await prisma.message.create({
      data: {
        conversationId,
        senderType: 'customer',
        contentType: 'text',
        contentText: messageText,
        messageId: simulatedMsgId,
        status: 'delivered',
        createdAt: new Date(),
      },
    })

    // ── 2. Update conversation last message stats ─────────────────────────────
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageText: messageText,
        lastMessageAt: new Date(),
        unreadCount: (conversation.unreadCount || 0) + 1,
        updatedAt: new Date(),
      },
    })

    // ── 3. Fetch WhatsApp config ──────────────────────────────────────────────
    const config = await prisma.whatsappConfig.findUnique({
      where: { tenantId: profile.tenantId },
    })

    const whatsappAccessToken = config ? decrypt(config.accessToken) : 'dummy-token'
    const phoneNumberId = config ? config.phoneNumberId : 'dummy-phone-id'

    // ── 4. Run AI healthcare auto-responder ───────────────────────────────────
    const aiHandled = await processHealthcareAIMessage({
      messageText,
      senderPhone: contact.phone ?? '',
      contactId: contact.id,
      userId: payload.userId,
      conversationId,
      contextMessageId: simulatedMsgId,
      accessToken: whatsappAccessToken,
      phoneNumberId,
    }).catch((err) => {
      console.error('[Simulate Incoming] processHealthcareAIMessage threw error:', err)
      return false
    })

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      aiHandled,
    })
  } catch (error: any) {
    console.error('Error in Simulate Incoming POST:', error)
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
