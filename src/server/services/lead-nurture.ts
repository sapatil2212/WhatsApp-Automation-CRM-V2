/**
 * Sales follow-up ("lead nurture") — cross-tenant, run by the server ticker.
 *
 * When a customer goes quiet after our last message, a friendly, human-sounding
 * nudge goes out, up to three times, all inside WhatsApp's 24-hour customer
 * service window (free-form text outside it is refused by Meta, so we never
 * try):
 *
 *   nudge 1   3h after the customer's last message
 *   nudge 2   10h after
 *   nudge 3   21h after (last chance, soft close)
 *
 * It stops by itself when the customer replies (a newer inbound message
 * restarts the cycle), opts out ("stop", "not interested"), books an
 * appointment, the conversation is closed, or the deal is won/lost. Messages
 * are only sent between 09:00 and 20:59 local time (APP_TIMEZONE).
 *
 * Tenants can turn it off with `Tenant.settings.leadNurture.enabled = false`.
 */

import { callLLM } from '@/lib/ai/llm';
import { getLogger, systemDb } from '../kernel';
import { sendTenantText } from './booking-notify';

const log = getLogger('lead-nurture');
const HOUR = 3_600_000;
const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';

/** Hours of customer silence (since their last message) before each nudge. */
export const NUDGE_AFTER_HOURS = [3, 10, 21] as const;
export const MAX_NUDGES = NUDGE_AFTER_HOURS.length;
const QUIET_FROM = 9;
const QUIET_TO = 21;

const OPT_OUT = /^\s*(stop|unsubscribe|cancel( all)?|no thanks?|not interested|don'?t (message|contact|text) me|leave me alone)\W*$/i;

export function isOptOut(text: string | null | undefined): boolean {
  return Boolean(text && OPT_OUT.test(text.trim()));
}

export function localHour(at: Date, tz = TZ): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(at));
}

export function withinSendingHours(at: Date, tz = TZ): boolean {
  const h = localHour(at, tz);
  return h >= QUIET_FROM && h < QUIET_TO;
}

export function isEnabled(settings: unknown): boolean {
  const raw = settings && typeof settings === 'object' ? (settings as { leadNurture?: { enabled?: unknown } }).leadNurture : undefined;
  return raw?.enabled !== false;
}

/** Which nudge (0-based) is due, or null. Pure — unit tested. */
export function dueNudge(input: { step: number; inboundAt: Date; now: Date }): number | null {
  if (input.step >= MAX_NUDGES) return null;
  const silent = input.now.getTime() - input.inboundAt.getTime();
  // Past the window nothing can be sent as free text.
  if (silent >= 24 * HOUR - 15 * 60_000) return null;
  return silent >= NUDGE_AFTER_HOURS[input.step] * HOUR ? input.step : null;
}

const FALLBACK = [
  (n: string, b: string) => `Hi ${n}, just checking in from ${b}. 😊 Is there anything else I can help you with, or any question I can answer?`,
  (n: string, _b: string) => `Hi ${n}, I wanted to follow up on our chat. If you'd like, I can help you get started or book a convenient time — just reply here and I'll take care of it.`,
  (n: string, b: string) => `Hi ${n}, this is my last note so I don't disturb you. 🙏 Whenever you're ready, reply here and ${b} will be glad to help. Have a lovely day!`,
];

export function fallbackMessage(step: number, name: string, business: string): string {
  const first = name.trim().split(/\s+/)[0] || 'there';
  return FALLBACK[Math.min(step, FALLBACK.length - 1)](first, business);
}

async function composeNudge(opts: { step: number; name: string; business: string; transcript: string }): Promise<string> {
  const fallback = fallbackMessage(opts.step, opts.name, opts.business);
  try {
    const goal = ['a warm check-in that re-opens the conversation', 'a helpful follow-up that removes friction and offers the next step (e.g. booking / details)', 'a polite final note with no pressure, inviting them to reply whenever ready'][Math.min(opts.step, 2)];
    const prompt = `You are an expert, friendly sales executive for "${opts.business}" chatting on WhatsApp.
The customer (${opts.name || 'unknown name'}) has gone quiet. Write follow-up #${opts.step + 1} of ${MAX_NUDGES}: ${goal}.
Rules: 1-3 short sentences, max 280 characters, same language the customer used, at most one emoji, no links, never invent prices/offers/medical advice, never pressure, end with a simple question or call to reply. Output ONLY the message text.

Recent conversation:
${opts.transcript}`;
    const res = await callLLM(prompt, { maxTokens: 200, temperature: 0.6, taskCriticality: 'standard' });
    const text = res.success ? res.text.trim().replace(/^["']|["']$/g, '') : '';
    return text.length >= 10 && text.length <= 600 ? text : fallback;
  } catch {
    return fallback;
  }
}

/** One pass over quiet conversations across all tenants. */
export async function runLeadNurture(now = new Date()): Promise<{ checked: number; sent: number }> {
  if (!withinSendingHours(now)) return { checked: 0, sent: 0 };

  // Conversations whose latest message (ours) is still unanswered, last active
  // inside the window.
  const candidates = await systemDb.conversation.findMany({
    where: {
      status: { not: 'closed' },
      lastMessageAt: { gte: new Date(now.getTime() - 24 * HOUR), lte: new Date(now.getTime() - 1 * HOUR) },
    },
    select: { id: true, tenantId: true, contactId: true, bookingStage: true },
    orderBy: { lastMessageAt: 'asc' },
    take: 300,
  });
  if (!candidates.length) return { checked: 0, sent: 0 };

  const tenantIds = [...new Set(candidates.map((c) => c.tenantId))];
  const tenants = await systemDb.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, settings: true } });
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  let sent = 0;

  for (const c of candidates) {
    const tenant = tenantById.get(c.tenantId);
    if (!tenant || !isEnabled(tenant.settings)) continue;
    try {
      const recent = await systemDb.message.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' }, take: 8, select: { senderType: true, contentText: true, createdAt: true } });
      const last = recent[0];
      // Only nudge when the customer is the one who stopped replying.
      if (!last || last.senderType === 'customer') continue;
      const lastInbound = recent.find((m) => m.senderType === 'customer');
      if (!lastInbound) continue; // never wrote to us — campaigns/templates are not nudged

      let state = await systemDb.leadFollowUp.findUnique({ where: { conversationId: c.id } });
      if (state && state.inboundAt.getTime() !== lastInbound.createdAt.getTime()) {
        // The customer replied since the last cycle: start over.
        state = await systemDb.leadFollowUp.update({ where: { id: state.id }, data: { inboundAt: lastInbound.createdAt, step: 0, status: 'active', stopReason: null } });
      }
      if (state && state.status !== 'active') continue;

      const stop = async (reason: string) => {
        await systemDb.leadFollowUp.upsert({
          where: { conversationId: c.id },
          create: { tenantId: c.tenantId, conversationId: c.id, contactId: c.contactId, inboundAt: lastInbound.createdAt, status: 'stopped', stopReason: reason },
          update: { status: 'stopped', stopReason: reason },
        });
      };

      if (isOptOut(lastInbound.contentText)) {
        await stop('opted_out');
        continue;
      }

      const step = state?.step ?? 0;
      if (dueNudge({ step, inboundAt: lastInbound.createdAt, now }) === null) continue;
      // Never nudge twice inside an hour.
      if (state?.lastSentAt && now.getTime() - state.lastSentAt.getTime() < HOUR) continue;

      const [upcoming, openDeal, closedDeal, contact] = await Promise.all([
        systemDb.appointment.count({ where: { contactId: c.contactId, status: 'scheduled', appointmentDate: { gte: new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z') } } }),
        systemDb.deal.count({ where: { contactId: c.contactId, status: 'active' } }),
        systemDb.deal.count({ where: { contactId: c.contactId, status: { in: ['won', 'lost'] } } }),
        systemDb.contact.findUnique({ where: { id: c.contactId }, select: { name: true, phone: true } }),
      ]);
      if (!contact?.phone) continue;
      if (upcoming > 0) { await stop('booked'); continue; }
      if (closedDeal > 0 && openDeal === 0) { await stop('deal_closed'); continue; }

      const transcript = [...recent].reverse().map((m) => `${m.senderType === 'customer' ? 'Customer' : 'Us'}: ${(m.contentText ?? '').slice(0, 200)}`).join('\n');
      const text = await composeNudge({ step, name: contact.name ?? '', business: tenant.name || 'our team', transcript });

      // Claim before sending so overlapping ticks cannot double-send.
      const claimed = state
        ? (await systemDb.leadFollowUp.updateMany({ where: { id: state.id, step, status: 'active' }, data: { step: step + 1, lastSentAt: now } })).count === 1
        : await systemDb.leadFollowUp.create({ data: { tenantId: c.tenantId, conversationId: c.id, contactId: c.contactId, inboundAt: lastInbound.createdAt, step: 1, lastSentAt: now } }).then(() => true, () => false);
      if (!claimed) continue;

      const ok = await sendTenantText(c.tenantId, contact.phone.replace(/[^\d]/g, ''), text, c.contactId);
      if (ok) {
        sent += 1;
        if (step + 1 >= MAX_NUDGES) await systemDb.leadFollowUp.update({ where: { conversationId: c.id }, data: { status: 'exhausted' } }).catch(() => undefined);
      } else {
        // Hand the slot back so the next tick retries.
        await systemDb.leadFollowUp.updateMany({ where: { conversationId: c.id, step: step + 1 }, data: { step } }).catch(() => undefined);
      }
    } catch (error) {
      log.warn('lead nurture failed for a conversation', { conversationId: c.id, err: error });
    }
  }
  if (sent) log.info('lead nudges sent', { checked: candidates.length, sent });
  return { checked: candidates.length, sent };
}
