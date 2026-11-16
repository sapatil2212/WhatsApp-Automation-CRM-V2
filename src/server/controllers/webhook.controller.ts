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
import { AutomationEngineService } from '../services/automation-engine.service';
import { BroadcastService } from '../services/broadcast.service';
import { FlowEngineService } from '../services/flow-engine.service';
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
}

interface MetaChangeValue {
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile: { name: string }; wa_id: string }>;
  messages?: MetaMessage[];
  statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }>;
}

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
async function route(input: {
  account: Account;
  stored: { contactId: string; conversationId: string; isFirstInboundMessage: boolean; contactWasCreated: boolean; text: string };
  message: InboundMessage;
}): Promise<void> {
  const { account, stored, message } = input;

  const profile = await account.db.profile
    .findFirst({ where: { userId: account.userId }, select: { businessType: true } })
    .catch(() => null);
  const segment = getBusinessSegment(profile?.businessType ?? null);
  const routingMode = await getInboundRoutingMode(account.userId, segment);

  const runAi = async (): Promise<boolean> => {
    const args = {
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
      return segment === 'healthcare'
        ? await processHealthcareAIMessage(args)
        : await processBusinessAIMessage(args);
    } catch (error) {
      log.error('AI handler failed', { segment, err: error });
      return false;
    }
  };

  const runFlows = async (): Promise<boolean> => {
    const transport = await WhatsappTransport.forTenant(account.db);
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
    });
    return result.consumed;
  };

  let handled = false;
  switch (routingMode) {
    case 'ai_only':
      handled = await runAi();
      break;
    case 'flows_only':
      handled = await runFlows();
      break;
    case 'flows_first':
      handled = (await runFlows()) || (await runAi());
      break;
    default:
      handled = (await runAi()) || (await runFlows());
  }

  if (handled) return;

  const transport = await WhatsappTransport.forTenant(account.db);
  if (!transport) return;
  const engine = AutomationEngineService.create(account.db, account.userId, transport);

  // Most specific trigger first, so a "welcome" automation on
  // `first_inbound_message` runs before a generic `new_message_received` one.
  const triggers: AutomationTriggerType[] = ['new_message_received', 'keyword_match'];
  if (stored.contactWasCreated) triggers.unshift('new_contact_created');
  if (stored.isFirstInboundMessage) triggers.unshift('first_inbound_message');

  for (const triggerType of triggers) {
    // Awaited in sequence, not fired and forgotten. The previous handler used
    // `.catch()` without awaiting, so the serverless function could be frozen
    // mid-automation and the remaining steps never ran.
    await engine.dispatch({
      triggerType,
      contactId: stored.contactId,
      context: { messageText: stored.text, conversationId: stored.conversationId },
    });
  }
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
  }
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

    await route({ account, stored, message });
  }
}

async function processWebhook(body: MetaWebhookBody): Promise<void> {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
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
      const phoneNumberId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      if (phoneNumberId) {
        const config = await systemDb.whatsappConfig.findFirst({
          where: { phoneNumberId },
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
