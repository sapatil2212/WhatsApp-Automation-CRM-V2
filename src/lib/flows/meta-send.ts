import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { prisma } from '@/lib/prisma'

interface SendTextEngineArgs {
  userId: string
  conversationId: string
  contactId: string
  text: string
}

export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const contact = await prisma.contact.findFirst({
    where: {
      id: args.contactId,
      userId: args.userId
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

  const config = await prisma.whatsappConfig.findFirst({
    where: { userId: args.userId }
  })

  if (!config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.accessToken)

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendTextMessage({
      phoneNumberId: config.phoneNumberId,
      accessToken,
      to: phone,
      text: args.text,
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

  try {
    await prisma.message.create({
      data: {
        conversationId: args.conversationId,
        senderType: 'bot',
        contentType: 'text',
        contentText: args.text,
        messageId: waMessageId,
        status: 'sent',
      }
    })
  } catch (msgErr: any) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: {
      lastMessageText: args.text,
      lastMessageAt: new Date(),
      updatedAt: new Date()
    }
  })

  return { whatsapp_message_id: waMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
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

  const config = await prisma.whatsappConfig.findFirst({
    where: { userId: input.userId }
  })

  if (!config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.accessToken)

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: phone,
        bodyText: input.bodyText,
        buttons: input.buttons,
        headerText: input.headerText,
        footerText: input.footerText,
      })
      return r.messageId
    }
    const r = await sendInteractiveList({
      phoneNumberId: config.phoneNumberId,
      accessToken,
      to: phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      sections: input.sections,
      headerText: input.headerText,
      footerText: input.footerText,
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

  try {
    await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderType: 'bot',
        contentType: 'interactive',
        contentText: input.bodyText,
        messageId: waMessageId,
        status: 'sent',
      }
    })
  } catch (msgErr: any) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      lastMessageText: input.bodyText,
      lastMessageAt: new Date(),
      updatedAt: new Date()
    }
  })

  return { whatsapp_message_id: waMessageId }
}
