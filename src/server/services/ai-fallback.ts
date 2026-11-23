/**
 * What the customer gets when the AI should have answered but could not.
 *
 * - Sends one short "our team will reply" notice, at most once per
 *   conversation every 5 minutes, so a model outage does not spam a chat.
 * - Opens the conversation, which hands it to a human: the inbox shows it as
 *   open and the AI stays out while a person owns it.
 * - Notifies staff in real time.
 *
 * Every step is best-effort and isolated: a failed send still opens the
 * conversation and notifies staff, so nobody is left without an owner.
 */
import { getLogger, type TenantDb } from '../kernel';
import { notifyTenant } from './booking-notify';
import { OutboundMessageService, type SystemTransport } from './outbound.service';

const log = getLogger('ai.fallback');

export const AI_FALLBACK_TEXT =
  "Thanks for your message! Our team will reply shortly. 🙏";
export const AI_FALLBACK_COOLDOWN_MS = 5 * 60 * 1000;

export async function sendAiFallback(input: {
  db: TenantDb;
  userId: string;
  tenantId: string;
  transport: SystemTransport | null;
  contactId: string;
  conversationId: string;
  customerLabel: string;
  now?: Date;
}): Promise<{ sent: boolean }> {
  const now = input.now ?? new Date();

  const recent = await input.db.message
    .findFirst({
      where: {
        conversationId: input.conversationId,
        senderType: 'bot',
        contentText: AI_FALLBACK_TEXT,
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
      await outbound.sendText(target, AI_FALLBACK_TEXT);
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
        ? 'They were told the team will reply shortly. The chat is open for you.'
        : 'No automatic notice could be sent. Please reply from the inbox.',
      href: `/inbox?c=${input.conversationId}`,
    });
  }

  return { sent };
}
