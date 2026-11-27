/**
 * What the customer gets when every AI provider failed (Anthropic, Gemini
 * and OpenRouter all down or erroring).
 *
 * - Sends one short holding message in the customer's own language, at most
 *   once per conversation every 5 minutes, so an outage does not spam a chat.
 * - Marks the conversation open so it shows in the team's inbox. This is not
 *   a transfer: the AI keeps answering the next messages, and only a team
 *   member actually replying makes it step back.
 * - Notifies staff in real time.
 *
 * Every step is best-effort and isolated: a failed send still opens the
 * conversation and notifies staff, so nobody is left without an owner.
 */
import { ALL_FALLBACK_TEXTS, cannedText, FALLBACK_TEXTS } from '@/lib/ai/conversation-kit';
import { resolveLanguage } from '@/lib/ai/language';
import { getLogger, type TenantDb } from '../kernel';
import { notifyTenant } from './booking-notify';
import { OutboundMessageService, type SystemTransport } from './outbound.service';

const log = getLogger('ai.fallback');

/** English holding text (kept for callers/tests that need the default). */
export const AI_FALLBACK_TEXT = FALLBACK_TEXTS.en;
export const AI_FALLBACK_COOLDOWN_MS = 5 * 60 * 1000;

export async function sendAiFallback(input: {
  db: TenantDb;
  userId: string;
  tenantId: string;
  transport: SystemTransport | null;
  contactId: string;
  conversationId: string;
  customerLabel: string;
  /** The customer's message, so the notice goes out in their language. */
  customerText?: string;
  now?: Date;
}): Promise<{ sent: boolean }> {
  const now = input.now ?? new Date();
  const text = cannedText('fallback', resolveLanguage(input.customerText ?? ''));

  const recent = await input.db.message
    .findFirst({
      where: {
        conversationId: input.conversationId,
        senderType: 'bot',
        contentText: { in: ALL_FALLBACK_TEXTS },
        createdAt: { gte: new Date(now.getTime() - AI_FALLBACK_COOLDOWN_MS) },
      },
      select: { id: true },
    })
    .catch(() => null);

  let sent = false;
  if (!recent && input.transport) {
    try {
      const outbound = OutboundMessageService.create(input.db, input.userId, input.transport);
      const target = await outbound.resolveTarget({ contactId: input.contactId, conversationId: input.conversationId });
      await outbound.sendText(target, text);
      sent = true;
    } catch (error) {
      log.error('fallback send failed', { conversationId: input.conversationId, err: error });
    }
  }

  await input.db.conversation
    .update({ where: { id: input.conversationId }, data: { status: 'open' } })
    .catch((error: unknown) => log.error('could not open conversation', { conversationId: input.conversationId, err: error }));

  // One alert per cooldown window, matching the customer notice.
  if (!recent) {
    notifyTenant(input.tenantId, {
      type: 'message',
      title: `AI couldn't reply to ${input.customerLabel}`,
      body: sent
        ? 'They got a short holding reply. Please check the chat — the AI will keep answering new messages.'
        : 'No automatic notice could be sent. Please reply from the inbox.',
      href: `/inbox?c=${input.conversationId}`,
    });
  }

  return { sent };
}
