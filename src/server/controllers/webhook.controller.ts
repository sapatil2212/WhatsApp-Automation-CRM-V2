/**
 * Meta WhatsApp webhook.
 *
 * Uses `createRawHandler`, because Meta's verification handshake requires the
 * challenge string as `text/plain` — the standard envelope would fail it.
 * Everything else (request context, structured logging, the global error
 * handler) still applies.
 *
 * `auth: 'public'` is correct and not a gap: the request carries no session,
 * and authenticity is established by `X-Hub-Signature-256` over the raw body,
 * verified before anything is parsed.
 *
 * ## Order of operations, and why
 *
 * 1. Read the raw body **once** and verify the signature over exactly those
 *    bytes. Re-serialising parsed JSON would change whitespace and break HMAC.
 * 2. Acknowledge Meta immediately, then process. Meta's timeout is a few
 *    seconds and a single inbound can trigger AI, a flow and several
 *    automations; exceeding it makes Meta redeliver the message.
 * 3. Per message: resolve the tenant from `phone_number_id`, drop duplicates,
 *    store, then route.
 *
 * The tenant is *derived*, not authenticated, which is the one legitimate
 * reason to touch `systemDb` outside authentication.
 */

import { NextResponse } from 'next/server';

import { createRawHandler, getLogger, systemDb, tenantDb, type TenantDb } from '../kernel';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { getMediaUrl } from '@/lib/whatsapp/meta-api';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';
import { getBusinessSegment } from '@/lib/business/terminology';
import { getInboundRoutingMode } from '@/lib/inbound/routing';
import { processHealthcareAIMessage } from '@/services/ai-healthcare.service';
import { processBusinessAIMessage } from '@/services/ai-business.service';
import { adNoteText, META_AD_NOTE_PREFIX, resolveReplyContext, type AdReferral } from '@/lib/ai/reply-context';
import { notifyTenant, pushToGoogleSheet } from '../services/booking-notify';
import { AutomationEngineService, type AutomationScope, type KeywordFilter } from '../services/automation-engine.service';
import { BroadcastService } from '../services/broadcast.service';
import { FlowEngineService } from '../services/flow-engine.service';
import { routeInbound, type FlowPass } from '../services/inbound-router';
import { sendAiFallback } from '../services/ai-fallback';
import { AiUnavailableError, type AiOutcome } from '@/lib/ai/outcome';
import { InboundService, type InboundMessage } from '../services/inbound.service';
import { TemplateService } from '../services/template.service';
import { WhatsappTransport } from '../services/whatsapp-transport';
import type { AutomationTriggerType } from '../validators/automation.validator';

const log = getLogger('webhook');

// ── Meta's envelope ─────────────────────────────────────────────────

interface MetaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type: string };
  sticker?: { id: string; mime_type: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  reaction?: { message_id: string; emoji: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  context?: { id: string };
  /** Template quick-reply tap (campaign buttons arrive as type "button"). */
  button?: { text?: string; payload?: string };
  /** Click-to-WhatsApp ad / post that started this conversation. */
  referral?: AdReferral;
}

interface MetaChangeValue {
  // Absent on WABA-level events such as template status updates.
  metadata?: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile: { name: string }; wa_id: string }>;
  messages?: MetaMessage[];
  statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }>;
}

/** WABA-level template events (fields: message_template_status_update, template_category_update, message_template_quality_update). */
interface MetaTemplateEventValue {
  event?: string;
  message_template_id?: number | string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string | null;
  new_category?: string;
  previous_category?: string;
  new_quality_score?: string;
}

const TEMPLATE_FIELDS = new Set([
  'message_template_status_update',
  'template_category_update',
  'message_template_quality_update',
]);

interface MetaWebhookBody {
  entry?: Array<{ id: string; changes: Array<{ value: MetaChangeValue; field: string }> }>;
}

/** Content types the `Message.contentType` column accepts. */
const ALLOWED_CONTENT_TYPES = new Set([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
]);

// ── tenant resolution ───────────────────────────────────────────────

interface Account {
  tenantId: string;
  userId: string;
  db: TenantDb;
  accessToken: string;
  phoneNumberId: string;
}

/**
 * Maps a `phone_number_id` to the account that owns it.
 *
 * Justified use of `systemDb`: the webhook runs before any tenant is known,
 * and this is the query that establishes one. Everything after it uses the
 * scoped client returned here.
 *
 * When two configs share a phone number id — which happens after a tenant
 * migrates a number — the most recently updated wins, matching the previous
 * behaviour.
 */
async function resolveAccount(phoneNumberId: string): Promise<Account | null> {
  const config = await systemDb.whatsappConfig.findFirst({
    where: { phoneNumberId },
    orderBy: { updatedAt: 'desc' },
    select: { tenantId: true, userId: true, accessToken: true },
  });
  if (!config) {
    log.warn('inbound for an unknown phone number id', { phoneNumberId });
    return null;
  }

  try {
    return {
      tenantId: config.tenantId,
      userId: config.userId,
      db: tenantDb(config.tenantId),
      accessToken: decrypt(config.accessToken),
      phoneNumberId,
    };
  } catch (error) {
    // A token encrypted under a rotated ENCRYPTION_KEY. Logged, not thrown:
    // one broken account must not stop the batch.
    log.error('could not decrypt the access token for an inbound message', {
      phoneNumberId,
      err: error,
    });
    return null;
  }
}

// ── verification (GET) ──────────────────────────────────────────────

/**
 * Meta's subscribe handshake. Answers with the challenge as plain text when
 * the supplied verify token matches either the environment fallback or any
 * stored token.
 *
 * The stored-token comparison decrypts each candidate, which is unavoidable:
 * the column holds ciphertext and Meta sends plaintext. The set is small (one
 * row per connected account) and this runs only during setup.
 */
async function verifySubscription(url: URL): Promise<Response> {
  const mode = url.searchParams.get('hub.mode');
  const challenge = url.searchParams.get('hub.challenge');
  const verifyToken = url.searchParams.get('hub.verify_token');

  if (mode !== 'subscribe' || !challenge || !verifyToken) {
    return NextResponse.json({ error: 'Missing verification parameters.' }, { status: 400 });
  }

  const plainText = (body: string) =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });

  if (process.env.WEBHOOK_VERIFY_TOKEN && process.env.WEBHOOK_VERIFY_TOKEN === verifyToken) {
    log.info('webhook verified from the environment token');
    return plainText(challenge);
  }

  // Justified systemDb use: no tenant exists yet at verification time.
  const configs = await systemDb.whatsappConfig.findMany({
    select: { id: true, verifyToken: true },
  });

  for (const config of configs) {
    if (!config.verifyToken) continue;
    let stored: string;
    try {
      stored = decrypt(config.verifyToken);
    } catch {
      continue; // wrong key or malformed row — try the next
    }
    if (stored !== verifyToken) continue;

    // Opportunistic re-encryption of legacy CBC ciphertext, preserved from the
    // previous handler so connected accounts migrate without a backfill.
    if (isLegacyFormat(config.verifyToken)) {
      await systemDb.whatsappConfig
        .update({ where: { id: config.id }, data: { verifyToken: encrypt(verifyToken) } })
        .catch((error: unknown) => log.warn('verify token re-encryption failed', { err: error }));
    }
    return plainText(challenge);
  }

  log.warn('webhook verify token mismatch');
  return NextResponse.json({ error: 'Verification token mismatch.' }, { status: 403 });
}

// ── message parsing ─────────────────────────────────────────────────

/**
 * Normalises one Meta message into our shape.
 *
 * Media is *verified* with Meta before a proxy URL is stored, so the thread
 * never renders a link to an attachment that has already expired. Verification
 * failure degrades to no media rather than dropping the message.
 */
async function parseMessage(message: MetaMessage, accessToken: string): Promise<InboundMessage> {
  const base: InboundMessage = {
    whatsappMessageId: message.id,
    from: message.from,
    profileName: null,
    timestamp: Number.parseInt(message.timestamp, 10) || Math.floor(Date.now() / 1000),
    contentType: ALLOWED_CONTENT_TYPES.has(message.type)
      ? message.type
      : message.type === 'sticker'
        ? 'image'
        : 'text',
    contentText: null,
    mediaUrl: null,
    interactiveReplyId: null,
    contextWhatsappMessageId: message.context?.id ?? null,
  };

  const mediaProxyUrl = async (mediaId: string): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken });
      return `/api/whatsapp/media/${mediaId}`;
    } catch (error) {
      log.warn('media could not be verified with Meta', { err: error });
      return null;
    }
  };

  switch (message.type) {
    case 'text':
      return { ...base, contentText: message.text?.body ?? null };

    case 'image':
      if (!message.image?.id) return base;
      return {
        ...base,
        contentText: message.image.caption ?? null,
        mediaUrl: await mediaProxyUrl(message.image.id),
      };

    case 'video':
      if (!message.video?.id) return base;
      return {
        ...base,
        contentText: message.video.caption ?? null,
        mediaUrl: await mediaProxyUrl(message.video.id),
      };

    case 'document':
      if (!message.document?.id) return base;
      return {
        ...base,
        contentText: message.document.caption ?? message.document.filename ?? null,
        mediaUrl: await mediaProxyUrl(message.document.id),
      };

    case 'audio':
      if (!message.audio?.id) return base;
      return { ...base, mediaUrl: await mediaProxyUrl(message.audio.id) };

    case 'sticker':
      if (!message.sticker?.id) return base;
      return { ...base, mediaUrl: await mediaProxyUrl(message.sticker.id) };

    case 'location': {
      const location = message.location;
      if (!location) return base;
      const label = [location.name, location.address, `${location.latitude},${location.longitude}`]
        .filter(Boolean)
        .join(' - ');
      return { ...base, contentText: label };
    }

    case 'button':
      // A tap on a template quick-reply (e.g. a campaign's "Claim offer").
      // Treated as text for flows/automations; the AI is told separately
      // that it was a button tap on a campaign message.
      return { ...base, contentType: 'text', contentText: message.button?.text ?? message.button?.payload ?? '[Button reply]' };

    case 'interactive': {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      if (!reply?.id) return { ...base, contentText: '[Interactive reply]' };
      return { ...base, contentText: reply.title || reply.id, interactiveReplyId: reply.id };
    }

    default:
      return { ...base, contentText: `[Unsupported message type: ${message.type}]` };
  }
}

// ── routing ─────────────────────────────────────────────────────────

/**
 * Decides who answers, honouring the tenant's configured routing mode.
 *
 * Automations run only when nothing else consumed the message, which is the
 * previous behaviour and the right one: an automation that fires alongside an
 * AI reply sends the customer two answers.
 */
/**
 * A Click-to-WhatsApp ad lead: tag it, remember which ad it came from (so
 * later replies keep the ad context) and open a deal in the first pipeline,
 * the way lead-ads tooling in WATI / AiSensy does.
 */
async function captureAdLead(account: Account, contactId: string, conversationId: string, referral: AdReferral): Promise<void> {
  const tag =
    (await systemDb.tag.findFirst({ where: { tenantId: account.tenantId, name: 'Meta Ads Lead' }, select: { id: true } })) ??
    (await systemDb.tag.create({ data: { tenantId: account.tenantId, userId: account.userId, name: 'Meta Ads Lead', color: '#1877f2' }, select: { id: true } }));
  await systemDb.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    create: { contactId, tagId: tag.id },
    update: {},
  });

  const adMarker = referral.source_id ? `Ad ID: ${referral.source_id}` : referral.headline ? `Headline: ${referral.headline}` : null;
  const seen = await systemDb.contactNote.findFirst({
    where: {
      tenantId: account.tenantId,
      contactId,
      noteText: adMarker ? { contains: adMarker } : { startsWith: META_AD_NOTE_PREFIX },
    },
    select: { id: true },
  });
  if (seen) return; // same ad already recorded for this contact
  await systemDb.contactNote.create({
    data: { tenantId: account.tenantId, contactId, userId: account.userId, noteText: adNoteText(referral) },
  });

  const openDeal = await systemDb.deal.findFirst({ where: { tenantId: account.tenantId, contactId, status: 'active' }, select: { id: true } });
  if (openDeal) return;
  const pipeline = await systemDb.pipeline.findFirst({
    where: { tenantId: account.tenantId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, stages: { orderBy: { position: 'asc' }, take: 1, select: { id: true } } },
  });
  if (!pipeline?.stages[0]) return;
  await systemDb.deal.create({
    data: {
      tenantId: account.tenantId,
      userId: account.userId,
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      contactId,
      conversationId,
      title: `Ad lead: ${referral.headline || 'Meta ad'}`.slice(0, 190),
      notes: adNoteText(referral),
    },
  });
}

async function route(input: {
  account: Account;
  stored: { contactId: string; conversationId: string; isFirstInboundMessage: boolean; contactWasCreated: boolean; text: string };
  message: InboundMessage;
  referral?: AdReferral | null;
  isButtonReply?: boolean;
}): Promise<void> {
  const { account, stored, message } = input;

  // Live dashboard notification + Google Sheets lead row for new contacts.
  notifyTenant(account.tenantId, {
    type: stored.contactWasCreated ? 'lead' : 'message',
    title: stored.contactWasCreated ? `New lead: ${message.profileName || `+${message.from}`}` : `Message from ${message.profileName || `+${message.from}`}`,
    body: (stored.text || '').slice(0, 140),
    href: '/inbox',
  });
  if (stored.contactWasCreated) {
    void pushToGoogleSheet(account.tenantId, {
      type: 'lead',
      name: message.profileName ?? '',
      phone: message.from,
      firstMessage: (stored.text || '').slice(0, 500),
      source: input.referral ? `Meta ad: ${input.referral.headline ?? input.referral.source_id ?? ''}` : 'WhatsApp',
      createdAt: new Date().toISOString(),
    });
  }

  const profile = await account.db.profile
    .findFirst({ where: { userId: account.userId }, select: { businessType: true } })
    .catch(() => null);
  const segment = getBusinessSegment(profile?.businessType ?? null);
  const routingMode = await getInboundRoutingMode(account.userId, segment);

  // AI attempt. A model failure before anything was sent (`AiUnavailableError`)
  // is safe to retry; any other error may have happened after a reply went
  // out, so it is never retried.
  let aiRetrySafe = true;
  const runAi = async (): Promise<AiOutcome> => {
    if (!aiRetrySafe) return 'failed';
    const replyContext = await resolveReplyContext({
      tenantId: account.tenantId,
      contactId: stored.contactId,
      referral: input.referral,
      contextWhatsappMessageId: message.contextWhatsappMessageId,
      isButtonReply: input.isButtonReply,
    }).catch((error: unknown) => {
      log.warn('reply context failed', { err: error });
      return undefined;
    });
    if (replyContext) log.info('ai reply context', { layer: replyContext.layer, label: replyContext.label });

    const args = {
      replyContext,
      messageText: stored.text,
      senderPhone: message.from,
      contactId: stored.contactId,
      userId: account.userId,
      conversationId: stored.conversationId,
      contextMessageId: message.whatsappMessageId,
      accessToken: account.accessToken,
      phoneNumberId: account.phoneNumberId,
      isFirstInboundMessage: stored.isFirstInboundMessage,
    };
    try {
      const replied = segment === 'healthcare'
        ? await processHealthcareAIMessage(args)
        : await processBusinessAIMessage(args);
      return replied ? 'handled' : 'declined';
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) aiRetrySafe = false;
      log.error('AI handler failed', { segment, retrySafe: aiRetrySafe, err: error });
      return 'failed';
    }
  };

  const transport = await WhatsappTransport.forTenant(account.db);

  const runFlows = async (pass: FlowPass): Promise<boolean> => {
    if (!transport) return false;
    const result = await FlowEngineService.create(account.db, account.userId, transport).dispatchInbound({
      contactId: stored.contactId,
      conversationId: stored.conversationId,
      message: message.interactiveReplyId
        ? {
            kind: 'interactive_reply',
            replyId: message.interactiveReplyId,
            replyTitle: stored.text,
            metaMessageId: message.whatsappMessageId,
          }
        : { kind: 'text', text: stored.text, metaMessageId: message.whatsappMessageId },
      isFirstInboundMessage: stored.isFirstInboundMessage,
      entry: pass === 'live_only' ? 'none' : pass,
      // The exact pass already offered the message to a live run.
      skipActiveRun: pass === 'non_exact',
    });
    return result.consumed;
  };

  const engine = transport ? AutomationEngineService.create(account.db, account.userId, transport) : null;
  const runAutomations = async (triggerType: AutomationTriggerType, scope: AutomationScope, keyword: KeywordFilter) => {
    if (!engine) return 0;
    // Awaited, never fired and forgotten: a frozen serverless function would
    // otherwise drop the remaining steps.
    const r = await engine.dispatch(
      { triggerType, contactId: stored.contactId, context: { messageText: stored.text, conversationId: stored.conversationId } },
      { scope, keyword },
    );
    return r.executed;
  };

  // Most specific trigger first, so a "welcome" automation on
  // `first_inbound_message` runs before a generic `new_message_received` one.
  const triggers: AutomationTriggerType[] = ['new_message_received', 'keyword_match'];
  if (stored.contactWasCreated) triggers.unshift('new_contact_created');
  if (stored.isFirstInboundMessage) triggers.unshift('first_inbound_message');

  const outcome = await routeInbound({
    mode: routingMode,
    triggers,
    runAi,
    runFlows,
    runAutomations,
    sendAiFallback: () =>
      sendAiFallback({
        db: account.db,
        userId: account.userId,
        tenantId: account.tenantId,
        transport,
        contactId: stored.contactId,
        conversationId: stored.conversationId,
        customerLabel: message.profileName || `+${message.from}`,
      }),
  });
  log.info('inbound routed', { mode: routingMode, repliedBy: outcome.repliedBy, ai: outcome.aiOutcome ?? 'not_run' });
}
// ── processing ──────────────────────────────────────────────────────

function campaignFeedback(db: TenantDb, userId: string): BroadcastService {
  // The template gate and Meta transport are only needed for *sending*, and
  // the webhook never sends a campaign — so neither is supplied here.
  return BroadcastService.create(db, userId, TemplateService.create(db, userId));
}

async function processStatuses(account: Account, statuses: NonNullable<MetaChangeValue['statuses']>) {
  const inbound = InboundService.create(account.db, account.userId, campaignFeedback(account.db, account.userId));
  for (const status of statuses) {
    await inbound
      .applyStatus({
        whatsappMessageId: status.id,
        status: status.status,
        at: new Date((Number.parseInt(status.timestamp, 10) || 0) * 1000 || Date.now()),
      })
      .catch((error: unknown) => log.warn('status update failed', { status: status.status, err: error }));
    await applyPrescriptionStatus(status.id, status.status, Number.parseInt(status.timestamp, 10)).catch((error: unknown) =>
      log.warn('prescription status update failed', { err: error }),
    );
  }
}

/** Mirrors Meta delivery receipts onto prescriptions sent on WhatsApp. */
async function applyPrescriptionStatus(messageId: string, status: string, ts: number) {
  const at = new Date((ts || 0) * 1000 || Date.now());
  const order = ['pending', 'uploaded', 'sent', 'delivered', 'read'];
  const rx = await systemDb.prescription.findFirst({ where: { whatsappMessageId: messageId }, select: { id: true, deliveryStatus: true } });
  if (!rx) return;
  if (status === 'failed') {
    await systemDb.prescription.update({ where: { id: rx.id }, data: { deliveryStatus: 'failed', deliveryError: 'Meta reported the message as failed.' } });
    return;
  }
  // Receipts can arrive out of order; never move backwards.
  if (order.indexOf(status) <= order.indexOf(rx.deliveryStatus)) return;
  await systemDb.prescription.update({
    where: { id: rx.id },
    data: { deliveryStatus: status, ...(status === 'delivered' ? { deliveredAt: at } : {}), ...(status === 'read' ? { readAt: at } : {}) },
  });
}

async function processMessages(account: Account, value: MetaChangeValue) {
  const inbound = InboundService.create(account.db, account.userId, campaignFeedback(account.db, account.userId));
  const messages = value.messages ?? [];

  for (let index = 0; index < messages.length; index += 1) {
    const raw = messages[index];
    const profile = value.contacts?.[index] ?? value.contacts?.[0];

    // Idempotency before any write. Meta redelivers until it sees a 2xx.
    if (await inbound.isDuplicate(raw.id)) {
      log.info('duplicate inbound ignored');
      continue;
    }

    if (raw.type === 'reaction' && raw.reaction?.message_id) {
      await inbound.applyReaction({
        targetWhatsappMessageId: raw.reaction.message_id,
        emoji: raw.reaction.emoji ?? '',
        from: raw.from,
      });
      continue;
    }

    const message = await parseMessage(raw, account.accessToken);
    const stored = await inbound.store({
      ...message,
      profileName: profile?.profile?.name ?? null,
    });

    if (raw.referral) {
      await captureAdLead(account, stored.contactId, stored.conversationId, raw.referral).catch((error: unknown) =>
        log.warn('ad lead capture failed', { err: error }),
      );
    }

    await route({ account, stored, message: { ...message, profileName: profile?.profile?.name ?? null }, referral: raw.referral ?? null, isButtonReply: raw.type === 'button' });
  }
}

function templateStatusToLocal(event: string): 'Pending' | 'Approved' | 'Rejected' | 'Paused' | 'Disabled' | null {
  switch (event.toUpperCase()) {
    case 'APPROVED':
      return 'Approved';
    case 'PAUSED':
    case 'FLAGGED':
      return 'Paused';
    case 'DISABLED':
      return 'Disabled';
    case 'REJECTED':
    case 'DELETED':
      return 'Rejected';
    case 'PENDING':
    case 'IN_APPEAL':
    case 'REINSTATED':
      return 'Pending';
    default:
      return null;
  }
}

/**
 * Apply a template status / category change pushed by Meta.
 *
 * These events identify the WABA (`entry.id`), not a phone number, so the
 * owning tenant(s) are resolved by `wabaId`. Justified `systemDb` use: the
 * tenant is derived from the WABA, exactly like `resolveAccount`.
 */
async function processTemplateEvent(wabaId: string, field: string, value: MetaTemplateEventValue): Promise<void> {
  const name = value.message_template_name;
  const language = value.message_template_language;
  if (!wabaId || !name) return;

  const configs = await systemDb.whatsappConfig.findMany({ where: { wabaId }, select: { tenantId: true } });
  if (!configs.length) {
    log.warn('template event for an unknown WABA', { wabaId });
    return;
  }

  const data: { status?: string; category?: string; approvedAt?: Date; rejectedAt?: Date; rejectionReason?: string | null } = {};
  if (field === 'message_template_status_update' && value.event) {
    const status = templateStatusToLocal(value.event);
    if (status) data.status = status;
    // Approval timeline + reason, only ever from Meta's own event.
    if (status === 'Approved') {
      data.approvedAt = new Date();
      data.rejectionReason = null;
    }
    if (status === 'Rejected' || status === 'Disabled' || status === 'Paused') {
      data.rejectedAt = new Date();
      data.rejectionReason = value.reason && value.reason !== 'NONE' ? String(value.reason) : status === 'Paused' ? 'Paused by Meta due to low quality feedback.' : null;
    }
  }
  if (field === 'template_category_update' && value.new_category) {
    const upper = value.new_category.toUpperCase();
    data.category = upper === 'UTILITY' ? 'Utility' : upper === 'AUTHENTICATION' ? 'Authentication' : 'Marketing';
  }
  if (!Object.keys(data).length) return;

  // Prefer the exact Meta template id when we stored it (only that WABA's row).
  const metaId = value.message_template_id ? String(value.message_template_id) : null;
  const tenantIds = configs.map((c) => c.tenantId);
  let updated = metaId
    ? await systemDb.messageTemplate.updateMany({ where: { tenantId: { in: tenantIds }, metaTemplateId: metaId }, data })
    : { count: 0 };
  if (!updated.count) {
    updated = await systemDb.messageTemplate.updateMany({
      where: { tenantId: { in: tenantIds }, name, ...(language ? { language } : {}) },
      data,
    });
  }
  log.info('template event applied', { field, event: value.event, name, language, reason: value.reason ?? undefined, rows: updated.count });
}

async function processWebhook(body: MetaWebhookBody): Promise<void> {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (TEMPLATE_FIELDS.has(change.field)) {
        await processTemplateEvent(entry.id, change.field, change.value as unknown as MetaTemplateEventValue).catch(
          (error: unknown) => log.warn('template event failed', { field: change.field, err: error }),
        );
        continue;
      }
      const value = change.value;
      const account = await resolveAccount(value.metadata?.phone_number_id ?? '');
      if (!account) continue;

      if (value.statuses?.length) {
        await processStatuses(account, value.statuses);
      }
      if (value.messages?.length) {
        await processMessages(account, value);
      }
    }
  }
}

// ── handlers ────────────────────────────────────────────────────────

export const webhookController = {
  verify: createRawHandler({
    operation: 'webhook.verify',
    auth: 'public',
    handle: async ({ request }) => verifySubscription(request.nextUrl),
  }),

  receive: createRawHandler({
    operation: 'webhook.receive',
    auth: 'public',
    handle: async ({ request }) => {
      // Read once: the signature covers these exact bytes.
      const rawBody = await request.text();

      let body: MetaWebhookBody;
      try {
        body = JSON.parse(rawBody) as MetaWebhookBody;
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
      }

      // Prefer the tenant's own app secret when one is configured, so tenants
      // do not have to share a single platform secret.
      let tenantSecret: string | undefined;
      // Message events carry a phone number id; WABA-level events (template
      // status updates) only carry the WABA id in `entry.id`.
      const phoneNumberId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      const wabaId = body.entry?.[0]?.id;
      if (phoneNumberId || wabaId) {
        const config = await systemDb.whatsappConfig.findFirst({
          where: phoneNumberId ? { phoneNumberId } : { wabaId },
          orderBy: { updatedAt: 'desc' },
          select: { metaAppSecret: true },
        });
        if (config?.metaAppSecret) {
          try {
            tenantSecret = decrypt(config.metaAppSecret);
          } catch (error) {
            log.warn('tenant app secret could not be decrypted', { err: error });
          }
        }
      }

      if (!verifyMetaWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'), tenantSecret)) {
        log.warn('rejected an unsigned or wrongly-signed webhook');
        return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
      }

      // Acknowledge first. Meta's timeout is short and a single inbound can
      // fan out to AI, a flow and several automations; a late 200 makes Meta
      // redeliver, which the idempotency guard absorbs but at real cost.
      void processWebhook(body).catch((error: unknown) =>
        log.error('webhook processing failed', { err: error }),
      );

      return NextResponse.json({ status: 'received' }, { status: 200 });
    },
  }),
};
