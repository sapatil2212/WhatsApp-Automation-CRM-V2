/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getMediaUrl } from '@/lib/whatsapp/meta-api'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { processHealthcareAIMessage } from '@/services/ai-healthcare.service'
import { processBusinessAIMessage } from '@/services/ai-business.service'
import { getBusinessSegment } from '@/lib/business/terminology'
import type { AutomationTriggerType } from '@/types'

interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  context?: { id: string }
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
      }>
    }
    field: string
  }>
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // ── Fast-path: env variable fallback ─────────────────────────────────────
    // Allows webhook verification even before any config is saved via the UI.
    // Set WEBHOOK_VERIFY_TOKEN in .env.local to match whatever token you put
    // in Meta's Webhook settings (e.g. WEBHOOK_VERIFY_TOKEN=TestApp).
    const envToken = process.env.WEBHOOK_VERIFY_TOKEN
    if (envToken && envToken === verifyToken) {
      console.log('[webhook] Verified via WEBHOOK_VERIFY_TOKEN env variable.')
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    // ── DB lookup: check all saved encrypted verify tokens ────────────────────
    const configs = await prisma.whatsappConfig.findMany({
      select: { id: true, verifyToken: true }
    })

    let matchedConfig: any = null
    for (const config of configs) {
      if (!config.verifyToken) continue
      try {
        if (decrypt(config.verifyToken) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Skip malformed/wrong-key token row
      }
    }

    if (matchedConfig) {
      // Upgrade verify token to GCM if it was legacy CBC format
      if (isLegacyFormat(matchedConfig.verifyToken)) {
        await prisma.whatsappConfig.update({
          where: { id: matchedConfig.id },
          data: { verifyToken: encrypt(verifyToken) }
        }).catch((err) => {
          console.warn('[webhook] verifyToken GCM upgrade failed:', err.message || err)
        })
      }
      
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    console.warn(`[webhook] Verify token mismatch. Received: "${verifyToken}". ` +
      `Set WEBHOOK_VERIFY_TOKEN=${verifyToken} in .env.local to allow this token.`)
    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error: any) {
    console.error('Webhook GET verification error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}


// POST - Webhook event handler
export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const signatureHeader = request.headers.get('x-hub-signature-256') || ''

    let body: any
    try {
      body = JSON.parse(rawBody)
    } catch (err) {
      console.error('[webhook] Failed to parse raw body as JSON:', err)
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // 1. Resolve tenant-specific Meta App Secret if available
    let tenantSecret: string | undefined = undefined
    try {
      const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id
      if (phoneNumberId) {
        const configs = await prisma.whatsappConfig.findMany({
          where: { phoneNumberId },
          orderBy: { updatedAt: 'desc' },
          select: { metaAppSecret: true }
        })
        if (configs.length > 0 && configs[0].metaAppSecret) {
          tenantSecret = decrypt(configs[0].metaAppSecret)
        }
      }
    } catch (err: any) {
      console.warn('[webhook] Failed to resolve tenant-specific secret:', err.message || err)
    }

    // 2. Verify webhook signature using verifyMetaWebhookSignature
    const isValidSignature = verifyMetaWebhookSignature(
      rawBody,
      signatureHeader,
      tenantSecret
    )

    if (!isValidSignature) {
      console.warn('[webhook] Invalid Meta X-Hub-Signature-256 signature.')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // Process asynchronously so we can ack Meta within their timeout.
    processWebhook(body).catch((error) => {
      console.error('Error processing webhook:', error)
    })

    return NextResponse.json({ status: 'received' }, { status: 200 })
  } catch (error: any) {
    console.error('Webhook POST handler error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id

      // Find user's config by phone_number_id. Grab the most recently updated.
      const configs = await prisma.whatsappConfig.findMany({
        where: { phoneNumberId },
        orderBy: { updatedAt: 'desc' }
      })

      if (!configs || configs.length === 0) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      const config = configs[0]
      const decryptedAccessToken = decrypt(config.accessToken)

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          config.userId,
          decryptedAccessToken,
          phoneNumberId
        )
      }
    }
  }
}

const RECIPIENT_STATUS_LADDER = ['pending', 'sent', 'delivered', 'read', 'replied'] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
}) {
  // 1) Mirror onto messages
  await prisma.message.updateMany({
    where: { messageId: status.id },
    data: { status: status.status }
  }).catch((err) => {
    console.error('Error updating message status:', err)
  })

  // 2) Mirror onto broadcast_recipients
  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString()

  const recipient = await prisma.broadcastRecipient.findFirst({
    where: { id: status.id } // The custom primary key id is mapped to meta message id or is looked up
  }).catch(() => null)

  // Fallback lookup via metadata if id doesn't match directly
  const targetRecipient = recipient || await prisma.broadcastRecipient.findFirst({
    where: { errorMessage: { contains: status.id } } // Fallback tracking in err message if needed
  }).catch(() => null)

  if (!targetRecipient) return

  if (!isValidStatusTransition(targetRecipient.status, status.status)) return

  const update: Record<string, any> = { status: status.status }
  if (status.status === 'sent') update.sentAt = new Date(tsIso)
  if (status.status === 'delivered') update.deliveredAt = new Date(tsIso)
  if (status.status === 'read') update.readAt = new Date(tsIso)

  await prisma.broadcastRecipient.update({
    where: { id: targetRecipient.id },
    data: update
  }).catch((err) => {
    console.error('Error updating broadcast recipient status:', err)
  })
}

async function flagBroadcastReplyIfAny(userId: string, contactId: string) {
  try {
    // Resolve tenantId
    const profile = await prisma.profile.findUnique({
      where: { userId }
    })
    if (!profile || !profile.tenantId) return

    const tenantId = profile.tenantId

    // Find recipient row
    const row = await prisma.broadcastRecipient.findFirst({
      where: {
        contactId,
        status: { in: ['sent', 'delivered', 'read'] },
        broadcast: {
          tenantId,
          userId
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    if (!row) return

    await prisma.broadcastRecipient.update({
      where: { id: row.id },
      data: {
        status: 'replied',
        repliedAt: new Date()
      }
    })
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const data = await prisma.message.findFirst({
    where: {
      messageId: metaId,
      conversationId
    },
    select: { id: true }
  })
  return data?.id ?? null
}

async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn('[webhook] reaction target message not found; skipping', reaction.message_id)
    return
  }

  // Remove emoji
  if (!reaction.emoji) {
    await prisma.messageReaction.deleteMany({
      where: {
        messageId: targetInternalId,
        actorType: 'customer',
        actorId: contactId
      }
    }).catch((err) => {
      console.error('[webhook] reaction delete failed:', err.message)
    })
    return
  }

  // Upsert emoji
  const existingReaction = await prisma.messageReaction.findFirst({
    where: {
      messageId: targetInternalId,
      actorType: 'customer',
      actorId: contactId
    }
  })

  if (existingReaction) {
    await prisma.messageReaction.update({
      where: { id: existingReaction.id },
      data: { emoji: reaction.emoji }
    })
  } else {
    await prisma.messageReaction.create({
      data: {
        messageId: targetInternalId,
        conversationId,
        actorType: 'customer',
        actorId: contactId,
        emoji: reaction.emoji
      }
    })
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  userId: string,
  accessToken: string,
  phoneNumberId: string
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact?.profile?.name || senderPhone

  const contactOutcome = await findOrCreateContact(
    userId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const conversation = await findOrCreateConversation(
    userId,
    contactRecord.id
  )
  if (!conversation) return

  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, accessToken)

  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
  }

  void mediaType

  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  const priorCustomerMsgCount = await prisma.message.count({
    where: {
      conversationId: conversation.id,
      senderType: 'customer'
    }
  })
  const isFirstInboundMessage = priorCustomerMsgCount === 0

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderType: 'customer',
      contentType: contentType,
      contentText: contentText,
      mediaUrl: mediaUrl,
      messageId: message.id,
      status: 'delivered',
      createdAt: new Date(parseInt(message.timestamp) * 1000),
      replyToMessageId: replyToInternalId,
      interactiveReplyId: interactiveReplyId,
    }
  }).catch((err) => {
    console.error('Error inserting message:', err)
  })

  // Update conversation
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageText: contentText || `[${message.type}]`,
      lastMessageAt: new Date(),
      unreadCount: (conversation.unreadCount || 0) + 1,
      updatedAt: new Date(),
    }
  }).catch((err) => {
    console.error('Error updating conversation:', err)
  })

  await flagBroadcastReplyIfAny(userId, contactRecord.id)

  // Determine business segment to trigger correct AI booking handler
  const profileRecord = await prisma.profile.findUnique({
    where: { userId }
  })
  const businessSegment = getBusinessSegment(profileRecord?.businessType)

  let aiHandled = false
  if (businessSegment === 'healthcare') {
    aiHandled = await processHealthcareAIMessage({
      messageText: contentText ?? message.text?.body ?? '',
      senderPhone,
      contactId: contactRecord.id,
      userId,
      conversationId: conversation.id,
      contextMessageId: message.id,
      accessToken,
      phoneNumberId,
      isFirstInboundMessage,
    }).catch((err) => {
      console.error('[AI Healthcare] Error during processing:', err)
      return false
    })
  } else {
    aiHandled = await processBusinessAIMessage({
      messageText: contentText ?? message.text?.body ?? '',
      senderPhone,
      contactId: contactRecord.id,
      userId,
      conversationId: conversation.id,
      contextMessageId: message.id,
      accessToken,
      phoneNumberId,
      isFirstInboundMessage,
    }).catch((err) => {
      console.error('[AI Business] Error during processing:', err)
      return false
    })
  }

  if (aiHandled) {
    console.log(`[AI ${businessSegment}] Message handled by AI automation.`)
    return
  }

  // Flow runner dispatch
  const flowResult = await dispatchInboundToFlows({
    userId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: message.id,
          }
        : {
            kind: 'text',
            text: contentText ?? message.text?.body ?? '',
            meta_message_id: message.id,
          },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  if (!flowConsumed) {
    const inboundText = contentText ?? message.text?.body ?? ''
    const automationTriggers: AutomationTriggerType[] = ['new_message_received', 'keyword_match']
    if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
    if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

    for (const triggerType of automationTriggers) {
      runAutomationsForTrigger({
        userId,
        triggerType,
        contactId: contactRecord.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
        },
      }).catch((err) => console.error('[automations] dispatch failed:', err))
    }
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  interactiveReplyId: string | null
}> {
  const verifyAndBuildUrl = async (mediaId: string): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken })
      return `/api/whatsapp/media/${mediaId}`
    } catch (error) {
      console.error(`Failed to verify media ${mediaId} with Meta:`, error)
      return null
    }
  }

  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return empty

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText: message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      }
  }
}

interface ContactOutcome {
  contact: any
  wasCreated: boolean
}

async function findOrCreateContact(
  userId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  const profile = await prisma.profile.findUnique({
    where: { userId }
  })
  if (!profile || !profile.tenantId) {
    console.error('No tenant profile found for user:', userId)
    return null
  }
  const tenantId = profile.tenantId

  const contacts = await prisma.contact.findMany({
    where: { tenantId }
  })

  const existingContact = contacts.find((c: any) => phonesMatch(c.phone, phone))

  if (existingContact) {
    if (name && name !== existingContact.name) {
      const updated = await prisma.contact.update({
        where: { id: existingContact.id },
        data: { name, updatedAt: new Date() }
      })
      return { contact: updated, wasCreated: false }
    }
    return { contact: existingContact, wasCreated: false }
  }

  const newContact = await prisma.contact.create({
    data: {
      tenantId,
      userId,
      phone,
      name: name || phone
    }
  })

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(userId: string, contactId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId }
  })
  if (!profile || !profile.tenantId) {
    console.error('No tenant profile found for user:', userId)
    return null
  }
  const tenantId = profile.tenantId

  const existing = await prisma.conversation.findFirst({
    where: { userId, contactId }
  })

  if (existing) {
    return existing
  }

  return await prisma.conversation.create({
    data: {
      tenantId,
      userId,
      contactId
    }
  })
}
