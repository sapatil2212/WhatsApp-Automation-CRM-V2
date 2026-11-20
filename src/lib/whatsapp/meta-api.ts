/**
 * Meta WhatsApp Cloud API helpers.
 *
 * Every function takes a single options object (named parameters) instead
 * of positional arguments. This was a deliberate choice after the same
 * swapped-args bug was found four times in a row with the positional form
 * (e.g. `(accessToken, phoneNumberId)` vs `(phoneNumberId, accessToken)`).
 * With named params, a typo surfaces immediately as a TypeScript error
 * instead of a runtime rejection from Meta.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaSendResult {
  messageId: string
}

export interface MetaPhoneInfo {
  id: string
  display_phone_number: string
  verified_name?: string
  quality_rating?: string
}

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

/**
 * Error thrown for a non-2xx Graph API response. Keeps Meta's numeric code
 * and subcode so callers can branch (e.g. duplicate template name), and
 * prefers Meta's human-readable `error_user_title/msg` when present — for
 * template submissions those explain *why* the payload was refused.
 */
export class MetaApiError extends Error {
  readonly httpStatus: number
  readonly code?: number
  readonly subcode?: number
  constructor(message: string, httpStatus: number, code?: number, subcode?: number) {
    super(message)
    this.name = 'MetaApiError'
    this.httpStatus = httpStatus
    this.code = code
    this.subcode = subcode
  }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code: number | undefined
  let subcode: number | undefined
  try {
    const data = await response.json()
    console.error('Raw Meta API Error payload:', JSON.stringify(data, null, 2))
    const err = data?.error
    if (err) {
      code = typeof err.code === 'number' ? err.code : undefined
      subcode = typeof err.error_subcode === 'number' ? err.error_subcode : undefined
      if (err.error_user_msg) {
        message = err.error_user_title ? `${err.error_user_title}: ${err.error_user_msg}` : err.error_user_msg
      } else if (err.message) {
        message = err.message
        if (err.error_data) {
          const details = typeof err.error_data === 'string' ? err.error_data : err.error_data.details ?? JSON.stringify(err.error_data)
          message += ` (${details})`
        }
      }
    }
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new MetaApiError(message, response.status, code, subcode)
}

// ============================================================
// Phone number / account
// ============================================================

export interface VerifyPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
}

/**
 * Verify a Meta phone number ID by fetching its public metadata
 * (display_phone_number, verified_name, quality_rating).
 */
export async function verifyPhoneNumber(
  args: VerifyPhoneNumberArgs
): Promise<MetaPhoneInfo> {
  const { phoneNumberId, accessToken } = args
  const url = `${META_API_BASE}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

// ============================================================
// Sending
// ============================================================

export interface SendTextMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
  /** Meta's message_id of the message being replied to. Adds a `context` field
   *  so WhatsApp renders the new message as a reply with a quote preview. */
  contextMessageId?: string
}

/**
 * Send a free-form WhatsApp text message.
 * Only works inside the 24-hour customer service window.
 */
export async function sendTextMessage(
  args: SendTextMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, text, contextMessageId } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface SendMediaMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  contentType: 'image' | 'document' | 'audio' | 'video'
  mediaUrl: string
  caption?: string
  filename?: string
  /** Meta's message_id of the message being replied to. */
  contextMessageId?: string
}

/**
 * Send an outbound media message (image, document, audio, video)
 * with optional caption, filename, and context quoting.
 */
export async function sendMediaMessage(
  args: SendMediaMessageArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    contentType,
    mediaUrl,
    caption,
    filename,
    contextMessageId,
  } = args

  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const mediaPayload: Record<string, unknown> = {
    link: mediaUrl,
  }

  if (caption && (contentType === 'image' || contentType === 'video' || contentType === 'document')) {
    mediaPayload.caption = caption
  }

  if (filename && contentType === 'document') {
    mediaPayload.filename = filename
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: contentType,
    [contentType]: mediaPayload,
  }

  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }

  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface SendTemplateMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  templateName: string
  language?: string
  params?: string[]
  components?: any[]
  /** Meta's message_id of the message being replied to. */
  contextMessageId?: string
}

/**
 * Send a pre-approved WhatsApp message template. Required outside
 * the 24-hour window and for any first-touch messaging.
 */
export async function sendTemplateMessage(
  args: SendTemplateMessageArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    templateName,
    language = 'en_US',
    params,
    components,
    contextMessageId,
  } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: language },
  }

  if (components && components.length > 0) {
    template.components = components
  } else if (params && params.length > 0) {
    template.components = [
      {
        type: 'body',
        parameters: params.map((p) => ({ type: 'text', text: String(p) })),
      },
    ]
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Message Templates — creation & approval workflow
// ============================================================
//
// The Cloud API lets you submit a template for Meta's review directly
// (POST /{waba-id}/message_templates). Meta then moves it through
// PENDING → APPROVED / REJECTED. This is the "proper approval process"
// — we submit, store the returned id + status, and the sync route
// (or webhook) later reconciles the final verdict.
//
// Docs (read before editing):
//   https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates

/** Meta template categories (upper-snake as the Graph API expects). */
export type MetaTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'

/**
 * A single component of a template payload. Loosely typed on purpose —
 * Meta accepts a wide, evolving shape (header/body/footer/buttons/carousel)
 * and callers assemble it. We validate the important bits in the route.
 */
export interface MetaTemplateComponentInput {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'
  text?: string
  example?: Record<string, unknown>
  buttons?: MetaTemplateButtonInput[]
  /** AUTHENTICATION BODY: append "For your security, do not share this code." */
  add_security_recommendation?: boolean
  /** AUTHENTICATION FOOTER: "This code expires in N minutes." (1–90) */
  code_expiration_minutes?: number
}

/**
 * Button shapes Meta supports on templates. QUICK_REPLY drives webhook
 * button_reply payloads; URL / PHONE_NUMBER are the call-to-action
 * (CTA) buttons that open a link or dial a number. COPY_CODE is used by
 * coupon/authentication templates.
 */
export interface MetaTemplateButtonInput {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE' | 'OTP'
  text: string
  /** OTP buttons on authentication templates. */
  otp_type?: 'COPY_CODE'
  /** Required for URL buttons. May contain a single {{1}} dynamic suffix. */
  url?: string
  /** Required for URL buttons that use a {{1}} variable — a sample value. */
  example?: string[]
  /** Required for PHONE_NUMBER buttons, in E.164 (e.g. +14155551234). */
  phone_number?: string
}

/**
 * Meta's hard limits for templates. Enforced before the network call so
 * a bad template fails at submit time with a clear message rather than
 * as an opaque 400 from Meta.
 */
export const TEMPLATE_LIMITS = {
  nameMaxLength: 512,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
  buttonTextMaxLength: 25,
  maxButtons: 10,
  maxQuickReply: 10,
  maxUrlButtons: 2,
  maxPhoneButtons: 1,
} as const

export interface CreateMessageTemplateArgs {
  wabaId: string
  accessToken: string
  name: string
  language: string
  category: MetaTemplateCategory
  components: MetaTemplateComponentInput[]
  /** Allow Meta to auto-assign a category if the chosen one mismatches. */
  allowCategoryChange?: boolean
}

export interface CreateMessageTemplateResult {
  id: string
  status: string
  category?: string
}

/**
 * Submit a template to Meta for approval. Returns Meta's template id
 * and initial status (usually PENDING, sometimes APPROVED for simple
 * utility templates).
 */
export async function createMessageTemplate(
  args: CreateMessageTemplateArgs,
): Promise<CreateMessageTemplateResult> {
  const {
    wabaId,
    accessToken,
    name,
    language,
    category,
    components,
    allowCategoryChange = true,
  } = args

  const url = `${META_API_BASE}/${wabaId}/message_templates`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      name,
      language,
      category,
      allow_category_change: allowCategoryChange,
      components,
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { id: data.id, status: data.status ?? 'PENDING', category: data.category }
}

export interface DeleteMessageTemplateArgs {
  wabaId: string
  accessToken: string
  name: string
  /** When set, deletes only the given language; otherwise all languages. */
  templateId?: string
}

/**
 * Delete a template from Meta by name (all languages) or by id+name for
 * a specific language variant. Meta soft-deletes then purges.
 */
export async function deleteMessageTemplate(
  args: DeleteMessageTemplateArgs,
): Promise<void> {
  const { wabaId, accessToken, name, templateId } = args
  const params = new URLSearchParams({ name })
  if (templateId) params.set('hsm_id', templateId)
  const url = `${META_API_BASE}/${wabaId}/message_templates?${params.toString()}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

export interface EditMessageTemplateArgs {
  templateId: string
  accessToken: string
  category?: MetaTemplateCategory
  components: MetaTemplateComponentInput[]
}

/**
 * Edit an existing template (only REJECTED / PAUSED / APPROVED templates can
 * be edited, and APPROVED ones at most once per day). Editing re-queues it
 * for review, so the status returns to PENDING.
 */
export async function editMessageTemplate(args: EditMessageTemplateArgs): Promise<void> {
  const { templateId, accessToken, category, components } = args
  const response = await fetch(`${META_API_BASE}/${templateId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ ...(category ? { category } : {}), components }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

/**
 * Upload a sample header image/video/document with Meta's Resumable Upload
 * API and return the `header_handle` a media-header template requires.
 * (A plain URL is NOT accepted as `header_handle`.)
 *
 * The app id is read from META_APP_ID or, failing that, resolved from the
 * access token itself.
 */
export async function uploadTemplateMedia(args: {
  accessToken: string
  bytes: ArrayBuffer
  mimeType: string
  fileName?: string
}): Promise<string> {
  const { accessToken, bytes, mimeType, fileName } = args

  let appId = (process.env.META_APP_ID ?? '').trim()
  if (!appId) {
    const appRes = await fetch(`${META_API_BASE}/app?fields=id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!appRes.ok) await throwMetaError(appRes, 'Could not resolve the Meta app id for media upload. Set META_APP_ID.')
    appId = String((await appRes.json()).id ?? '')
  }
  if (!appId) throw new MetaApiError('Could not resolve the Meta app id for media upload. Set META_APP_ID.', 400)

  const params = new URLSearchParams({
    file_length: String(bytes.byteLength),
    file_type: mimeType,
    ...(fileName ? { file_name: fileName } : {}),
  })
  const sessionRes = await fetch(`${META_API_BASE}/${appId}/uploads?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!sessionRes.ok) await throwMetaError(sessionRes, `Meta upload session failed: ${sessionRes.status}`)
  const sessionId = String((await sessionRes.json()).id ?? '')

  const uploadRes = await fetch(`${META_API_BASE}/${sessionId}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${accessToken}`, file_offset: '0' },
    body: bytes,
  })
  if (!uploadRes.ok) await throwMetaError(uploadRes, `Meta media upload failed: ${uploadRes.status}`)
  const handle = String((await uploadRes.json()).h ?? '')
  if (!handle) throw new MetaApiError('Meta did not return a media handle.', 502)
  return handle
}

/**
 * Uploads a file to the sender phone number's media store and returns the
 * Meta `media_id` (used by template document headers and media messages).
 */
export async function uploadMessageMedia(args: {
  phoneNumberId: string
  accessToken: string
  bytes: Uint8Array
  mimeType: string
  fileName: string
}): Promise<string> {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', args.mimeType)
  form.append('file', new Blob([args.bytes as BlobPart], { type: args.mimeType }), args.fileName)
  const response = await fetch(`${META_API_BASE}/${args.phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.accessToken}` },
    body: form,
  })
  if (!response.ok) await throwMetaError(response, `Meta media upload failed: ${response.status}`)
  const data = await response.json()
  const id = String(data.id ?? '')
  if (!id) throw new MetaApiError('Meta did not return a media id.', 502)
  return id
}

/** Sends a previously uploaded document by media id (inside the 24h window). */
export async function sendDocumentById(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  mediaId: string
  fileName: string
  caption?: string
}): Promise<MetaSendResult> {
  const response = await fetch(`${META_API_BASE}/${args.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.accessToken}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: args.to,
      type: 'document',
      document: { id: args.mediaId, filename: args.fileName, ...(args.caption ? { caption: args.caption } : {}) },
    }),
  })
  if (!response.ok) await throwMetaError(response, `Meta API error: ${response.status}`)
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface ListMessageTemplatesArgs {
  wabaId: string
  accessToken: string
  /** Opaque cursor from a previous page's `nextCursor`. */
  after?: string
  /** Meta caps this at 100. */
  limit?: number
  /** Exact-name filter. */
  name?: string
}

export interface MetaTemplateListEntry {
  id: string
  name: string
  language: string
  status: string
  category: string
  components?: unknown[]
  rejected_reason?: string
  quality_score?: { score?: string; date?: number }
}

export interface ListMessageTemplatesResult {
  templates: MetaTemplateListEntry[]
  /** Cursor for the next page, or null when the listing is complete. */
  nextCursor: string | null
}

/**
 * One page of a WABA's message templates.
 *
 * Meta is authoritative for template status, so this is what a local catalog
 * sync reads. Previously this call was a raw `fetch` inline in
 * `api/whatsapp/templates/sync/route.ts` with its own pagination loop and
 * its own error handling; it belongs beside the other Meta helpers so
 * everything shares `throwMetaError` and the pinned API version.
 *
 * Pagination is exposed as a cursor rather than followed internally: the
 * caller owns the page cap, which keeps a misbehaving upstream from looping
 * forever inside a library function.
 */
export async function listMessageTemplates(
  args: ListMessageTemplatesArgs,
): Promise<ListMessageTemplatesResult> {
  const { wabaId, accessToken, after, limit = 100, name } = args
  const params = new URLSearchParams({
    limit: String(Math.min(limit, 100)),
    fields: 'id,name,language,status,category,components,rejected_reason,quality_score',
  })
  if (after) params.set('after', after)
  if (name) params.set('name', name)

  const response = await fetch(
    `${META_API_BASE}/${wabaId}/message_templates?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }

  const body = (await response.json()) as {
    data?: MetaTemplateListEntry[]
    paging?: { cursors?: { after?: string }; next?: string }
  }

  // `paging.next` present means more pages exist; the cursor itself lives in
  // `paging.cursors.after`. Both are required — a cursor with no `next` is
  // the last page.
  const nextCursor = body.paging?.next ? (body.paging.cursors?.after ?? null) : null

  return { templates: body.data ?? [], nextCursor }
}

// ============================================================
// Reactions
// ============================================================

export interface SendReactionMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** Meta's message_id of the message being reacted to. */
  targetMessageId: string
  /** Single emoji, or empty string to remove an existing reaction. */
  emoji: string
}

/**
 * Send a reaction (or removal) to a previously-exchanged message.
 * Empty `emoji` removes the reaction per Meta's spec.
 */
export async function sendReactionMessage(
  args: SendReactionMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, targetMessageId, emoji } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetMessageId, emoji },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Interactive (button replies + list messages)
// ============================================================
//
// Meta's two flavours of interactive message — used by the Flows
// engine to drive scripted chatbot menus. Caller passes plain
// JS values; helpers shape the Meta payload and enforce Meta's
// limits BEFORE the network call so the failure mode is a
// developer-facing error rather than a customer-facing one.

/**
 * Meta limits for interactive messages, hard-coded so violations
 * fail at build/save time rather than as a 400 from the Meta API
 * mid-conversation. See:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
 */
export const INTERACTIVE_LIMITS = {
  maxButtons: 3,
  buttonTitleMaxLength: 20,
  maxListSections: 10,
  maxListRowsTotal: 10,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
} as const

export interface InteractiveButton {
  /** Stable id sent back in the webhook when tapped (≤ 256 chars). */
  id: string
  /** Visible label (≤ 20 chars per Meta). */
  title: string
}

export interface SendInteractiveButtonsArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** The body text — what the customer reads above the buttons. */
  bodyText: string
  /** Optional plain-text header (≤ 60 chars). */
  headerText?: string
  /** Optional grey footer line under the buttons (≤ 60 chars). */
  footerText?: string
  /** 1–3 buttons. Validated against Meta's limits before sending. */
  buttons: InteractiveButton[]
  /** Meta's message_id of the message being replied to (quote preview). */
  contextMessageId?: string
}

/**
 * Send an interactive message with up to 3 inline reply buttons. The
 * customer taps one and Meta delivers a webhook with
 * `messages[0].interactive.button_reply.id` set to the matching button.id.
 *
 * Validation throws BEFORE the network call so misconfigured flows
 * fail at save time, not during a live conversation.
 */
export async function sendInteractiveButtons(
  args: SendInteractiveButtonsArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, headerText, footerText, buttons, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (buttons.length < 1 || buttons.length > INTERACTIVE_LIMITS.maxButtons) {
    throw new Error(
      `Interactive button message requires 1-${INTERACTIVE_LIMITS.maxButtons} buttons (got ${buttons.length}).`
    )
  }
  for (const btn of buttons) {
    if (!btn.id) throw new Error('Interactive button missing id.')
    if (!btn.title) throw new Error(`Interactive button "${btn.id}" missing title.`)
    if (btn.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      throw new Error(
        `Interactive button title "${btn.title}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
      )
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title },
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface InteractiveListRow {
  /** Stable id sent back in the webhook when tapped (≤ 200 chars). */
  id: string
  /** Visible row title (≤ 24 chars per Meta). */
  title: string
  /** Optional secondary line shown under the title (≤ 72 chars). */
  description?: string
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string
  rows: InteractiveListRow[]
}

export interface SendInteractiveListArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  /** Label of the tap-to-expand button on the message bubble. */
  buttonLabel: string
  headerText?: string
  footerText?: string
  /**
   * 1–10 rows TOTAL across all sections. Meta caps the *total*, not
   * per-section. Validation enforces this before send.
   */
  sections: InteractiveListSection[]
  contextMessageId?: string
}

/**
 * Send an interactive message with a tap-to-expand list of selectable
 * rows. Use when there are more options than the 3-button limit allows.
 * Webhook arrives with `messages[0].interactive.list_reply.id` set to
 * the matching row.id.
 */
export async function sendInteractiveList(
  args: SendInteractiveListArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, buttonLabel, headerText, footerText, sections, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (!buttonLabel) throw new Error('Interactive list requires a buttonLabel.')
  if (buttonLabel.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `Interactive list buttonLabel "${buttonLabel}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
    )
  }
  if (sections.length < 1 || sections.length > INTERACTIVE_LIMITS.maxListSections) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListSections} sections (got ${sections.length}).`
    )
  }
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0)
  if (totalRows < 1 || totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across all sections (got ${totalRows}).`
    )
  }
  const seenIds = new Set<string>()
  for (const section of sections) {
    for (const row of section.rows) {
      if (!row.id) throw new Error('Interactive list row missing id.')
      if (seenIds.has(row.id)) {
        throw new Error(`Interactive list has duplicate row id "${row.id}".`)
      }
      seenIds.add(row.id)
      if (!row.title) throw new Error(`Interactive list row "${row.id}" missing title.`)
      if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
        throw new Error(
          `Interactive list row title "${row.title}" exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`
        )
      }
      if (
        row.description &&
        row.description.length > INTERACTIVE_LIMITS.listRowDescriptionMaxLength
      ) {
        throw new Error(
          `Interactive list row description for "${row.id}" exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`
        )
      }
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: buttonLabel,
      sections: sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
        })),
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

function validateInteractiveBody(bodyText: string): void {
  if (!bodyText) throw new Error('Interactive message requires bodyText.')
  if (bodyText.length > INTERACTIVE_LIMITS.bodyMaxLength) {
    throw new Error(
      `Interactive bodyText exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars.`
    )
  }
}

function validateInteractiveHeaderFooter(
  headerText: string | undefined,
  footerText: string | undefined,
): void {
  if (headerText && headerText.length > INTERACTIVE_LIMITS.headerTextMaxLength) {
    throw new Error(
      `Interactive headerText exceeds ${INTERACTIVE_LIMITS.headerTextMaxLength} chars.`
    )
  }
  if (footerText && footerText.length > INTERACTIVE_LIMITS.footerMaxLength) {
    throw new Error(
      `Interactive footerText exceeds ${INTERACTIVE_LIMITS.footerMaxLength} chars.`
    )
  }
}

// ============================================================
// Media
// ============================================================

export interface GetMediaUrlArgs {
  mediaId: string
  accessToken: string
}

/**
 * Resolve a media ID to Meta's (short-lived, authenticated) CDN URL
 * plus the MIME type. Step one of the media-proxy flow.
 */
export async function getMediaUrl(
  args: GetMediaUrlArgs
): Promise<{ url: string; mimeType: string }> {
  const { mediaId, accessToken } = args
  const response = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Media fetch failed: ${response.status}`)
  }
  const data = await response.json()
  if (!data.url) throw new Error('Media URL not found in Meta response')
  return { url: data.url, mimeType: data.mime_type || 'application/octet-stream' }
}

export interface DownloadMediaArgs {
  downloadUrl: string
  accessToken: string
}

/**
 * Fetch the binary bytes for a media URL obtained from getMediaUrl.
 * Step two of the media-proxy flow.
 */
export async function downloadMedia(
  args: DownloadMediaArgs
): Promise<{ buffer: Buffer; contentType: string }> {
  const { downloadUrl, accessToken } = args
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status}`)
  }
  const contentType =
    response.headers.get('content-type') || 'application/octet-stream'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}
