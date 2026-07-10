import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { prisma } from '@/lib/prisma'

interface SendTextArgs {
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  // 1. Load contact phone
  const contact = await prisma.contact.findFirst({
    where: {
      id: input.contactId,
      userId: input.userId
    },
    select: { id: true, phone: true }
  })

  if (!contact || !contact.phone) {
    throw new Error('contact not found for this user')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  // 2. Load WhatsApp configuration
  const config = await prisma.whatsappConfig.findFirst({
    where: { userId: input.userId }
  })

  if (!config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.accessToken)

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const r = await sendTemplateMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        params: input.params,
      })
      return r.messageId
    }

    const r = await sendTextMessage({
      phoneNumberId: config.phoneNumberId,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }

  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { phone: workingPhone, updatedAt: new Date() }
    })
  }

  const content_type = input.kind === 'template' ? 'template' : 'text'
  const content_text = input.kind === 'text' ? input.text : null
  const template_name = input.kind === 'template' ? input.templateName : null

  // 3. Persist sent message
  try {
    await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderType: 'bot',
        contentType: content_type,
        contentText: content_text,
        templateName: template_name,
        messageId: waMessageId,
        status: 'sent',
      }
    })
  } catch (msgErr: any) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  // 4. Update Conversation status
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      lastMessageText: input.kind === 'template' ? `[template:${input.templateName}]` : input.text,
      lastMessageAt: new Date(),
      updatedAt: new Date()
    }
  })

  return { whatsapp_message_id: waMessageId }
}
