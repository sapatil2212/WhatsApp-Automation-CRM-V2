/**
 * Booking follow-ups — cross-tenant, run by the server ticker every minute.
 *
 * When a patient starts booking an appointment on WhatsApp and stops
 * answering half-way, the AI reminds them to continue, remembering what they
 * already chose (department, doctor, date) and the chat so far:
 *
 *   reminder 1   5 minutes after the patient's last message
 *   reminder 2   5 hours after
 *   reminder 3   10 hours after (last one, no pressure)
 *
 * All inside WhatsApp's 24-hour customer-service window (free text outside it
 * is refused by Meta). Reminders 2 and 3 are only sent 09:00–20:59 local time;
 * reminder 1 goes out right away since the patient was just chatting.
 *
 * The cycle ends by itself when the patient replies (the next message resumes
 * the booking — "yes" re-asks the pending question, "no" stops it), the
 * booking completes or is cancelled, a team member takes over, or the AI is
 * switched off. The regular lead-nurture nudges skip these chats so the
 * patient never gets two follow-ups at once.
 *
 * Tenants can turn it off with `Tenant.settings.bookingFollowUp.enabled = false`.
 */

import { Prisma } from '@prisma/client';
import { callLLM, type ChatTurn } from '@/lib/ai/llm';
import { languageInstruction, templatesFit, type DetectedLanguage } from '@/lib/ai/language';
import { buildMemory, humanIsActive, localizeText } from '@/lib/ai/conversation-kit';
import { getLogger, systemDb } from '../kernel';
import { sendTenantText } from './booking-notify';
import { localHour } from './lead-nurture';
import { drName, prettyDate, type WizardState } from './whatsapp-booking-flow';

const log = getLogger('booking-followup');
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Patient silence (since their last message) before each reminder. */
export const BOOKING_REMIND_AFTER_MS = [5 * MIN, 5 * HOUR, 10 * HOUR] as const;
export const MAX_BOOKING_REMINDERS = BOOKING_REMIND_AFTER_MS.length;
/** Leave this much of the 24h window unused, so a send is never refused. */
const WINDOW_MS = 24 * HOUR - 30 * MIN;
const SEND_FROM = 9;
const SEND_TO = 21;

export function isFollowUpEnabled(settings: unknown): boolean {
  const raw = settings && typeof settings === 'object' ? (settings as { bookingFollowUp?: { enabled?: unknown } }).bookingFollowUp : undefined;
  return raw?.enabled !== false;
}

/**
 * Which reminder (0-based) is due now, or null. Pure — unit tested.
 * `sent` counts reminders already sent for this patient message.
 */
export function dueBookingReminder(input: { sent: number; inboundAt: Date; now: Date; lastReminderAt?: Date | null }): number | null {
  const { sent, inboundAt, now } = input;
  if (sent >= MAX_BOOKING_REMINDERS) return null;
  const silent = now.getTime() - inboundAt.getTime();
  if (silent < BOOKING_REMIND_AFTER_MS[sent] || silent >= WINDOW_MS) return null;
  // Later reminders only in daytime, and never two within an hour.
  if (sent > 0) {
    const h = localHour(now);
    if (h < SEND_FROM || h >= SEND_TO) return null;
    if (input.lastReminderAt && now.getTime() - input.lastReminderAt.getTime() < HOUR) return null;
  }
  return sent;
}

function isWizard(v: unknown): v is WizardState {
  return Boolean(v && typeof v === 'object' && (v as { flow?: unknown }).flow === 'wizard');
}

const firstName = (n?: string | null) => (n || '').trim().split(/\s+/)[0] || '';

/** What the patient has chosen so far, e.g. "OPD with Dr. Riya Shah on Tue, 1 Dec". */
export function bookingSummary(s: WizardState): string {
  const parts: string[] = [];
  if (s.departmentName) parts.push(s.departmentName);
  if (s.doctorName) parts.push(`${parts.length ? 'with ' : ''}${drName(s.doctorName)}`);
  if (s.date) parts.push(`on ${prettyDate(s.date)}`);
  if (s.time) parts.push(`at ${s.time}`);
  return parts.join(' ');
}

const PENDING_EN: Record<string, string> = {
  patient: "Could you share the patient's name and age?",
  department: 'Which department would you like?',
  doctor: 'Which doctor would you like to see?',
  date: 'Which date works for you?',
  time: 'Which time suits you?',
};
const PENDING_HI: Record<string, string> = {
  patient: 'Patient ka naam aur umar bata dijiye?',
  department: 'Kaunse department mein dikhana hai?',
  doctor: 'Kaunse doctor ko dikhana hai?',
  date: 'Kaunsi date theek rahegi?',
  time: 'Kaunsa time theek rahega?',
};

/** Static reminder, used when the AI cannot write one. Pure — unit tested. */
export function fallbackReminder(step: number, s: WizardState, clinicName: string, hinglish: boolean): string {
  const n = firstName(s.name);
  const summary = bookingSummary(s);
  const pending = (hinglish ? PENDING_HI : PENDING_EN)[s.awaiting ?? ''] ?? (hinglish ? 'Booking aage badhayein?' : 'Shall we continue?');
  if (hinglish) {
    const so = summary ? ` Abhi tak: *${summary}*.` : '';
    return [
      `Hi${n ? ` ${n}` : ''} 🙂 Aapki appointment booking adhoori reh gayi hai.${so} ${pending}`,
      `Hi${n ? ` ${n}` : ''}, bas yaad dila rahe the — aapki appointment booking abhi pending hai.${so} ${pending} Jab bhi ready hon, yahin reply kar dijiye 🙏`,
      `Hi${n ? ` ${n}` : ''}, ${clinicName} se aakhri reminder 🙏${so} Appointment chahiye to bas yahin reply kar dijiye, nahi to koi baat nahi.`,
    ][Math.min(step, 2)];
  }
  const so = summary ? ` So far: *${summary}*.` : '';
  return [
    `Hi${n ? ` ${n}` : ''} 🙂 Shall we finish your appointment booking?${so} ${pending}`,
    `Hi${n ? ` ${n}` : ''}, just a reminder — your appointment booking is still pending.${so} ${pending} Reply here whenever you're ready 🙏`,
    `Hi${n ? ` ${n}` : ''}, one last reminder from ${clinicName} 🙏${so} If you'd still like the appointment, just reply here — and if not, no problem at all.`,
  ][Math.min(step, 2)];
}

export async function composeReminder(o: {
  step: number;
  state: WizardState;
  clinicName: string;
  lang: DetectedLanguage;
  history: ChatTurn[];
}): Promise<string> {
  const fallback = fallbackReminder(o.step, o.state, o.clinicName, o.lang.code === 'hi-Latn');
  const goal = [
    'They stopped replying a few minutes ago. Gently invite them to continue right now.',
    'It has been a few hours. A friendly reminder that the booking is still pending.',
    'Last reminder, many hours later. Warm, no pressure, easy to say yes or ignore.',
  ][Math.min(o.step, 2)];
  const pending = PENDING_EN[o.state.awaiting ?? ''] ?? 'Ask if they would like to continue the booking.';
  const res = await callLLM('(The patient has not replied. Write the reminder now.)', {
    systemPrompt: `You are the WhatsApp front-desk assistant of "${o.clinicName}". A patient started booking an appointment in this chat but did not finish.
Write reminder ${o.step + 1} of ${MAX_BOOKING_REMINDERS}. ${goal}

${languageInstruction(o.lang)}

What they already chose: ${bookingSummary(o.state) || 'nothing yet'}${o.state.name ? ` (patient: ${o.state.name})` : ''}.
The next thing we need from them: ${pending}

Rules:
- 1–3 short, warm sentences like a real receptionist. Use their first name if known. At most one emoji.
- Mention what they already chose so they don't have to repeat it, then ask the next question.
- Do not list slots or options, invent prices or availability, or repeat a reminder you already sent in the chat.
- Output ONLY the message text.`,
    history: o.history,
    taskCriticality: 'basic',
    maxTokens: 250,
    timeoutMs: 12_000,
    deadlineMs: 25_000,
  }).catch(() => null);
  const text = res?.success ? res.text.trim().replace(/^["'`]+|["'`]+$/g, '') : '';
  if (text.length >= 10 && text.length <= 700) return text;
  return templatesFit(o.lang) ? fallback : localizeText(fallback, o.lang);
}

/** One pass over unfinished WhatsApp bookings across all tenants. */
export async function runBookingFollowUps(now = new Date()): Promise<{ checked: number; sent: number }> {
  const candidates = await systemDb.conversation.findMany({
    where: {
      bookingStage: { startsWith: 'wizard_' },
      lastMessageAt: { gte: new Date(now.getTime() - 24 * HOUR), lte: new Date(now.getTime() - BOOKING_REMIND_AFTER_MS[0] + 30_000) },
    },
    select: { id: true, tenantId: true, userId: true, contactId: true, bookingState: true, updatedAt: true },
    orderBy: { lastMessageAt: 'asc' },
    take: 200,
  });
  if (!candidates.length) return { checked: 0, sent: 0 };

  const tenantIds = [...new Set(candidates.map((c) => c.tenantId))];
  const tenants = await systemDb.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, settings: true } });
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  let sent = 0;

  for (const c of candidates) {
    const tenant = tenantById.get(c.tenantId);
    if (!tenant || !isFollowUpEnabled(tenant.settings)) continue;
    const state = (isWizard(c.bookingState) ? c.bookingState : null) as WizardState | null;
    if (!state || state.mode === 'cancel') continue;
    try {
      const recent = await systemDb.message.findMany({
        where: { conversationId: c.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { senderType: true, contentType: true, contentText: true, createdAt: true },
      });
      const last = recent[0];
      // Only when we asked something and the patient went quiet.
      if (!last || last.senderType !== 'bot') continue;
      const lastInbound = recent.find((m) => m.senderType === 'customer');
      if (!lastInbound) continue;
      const memory = buildMemory(recent, '');
      if (humanIsActive(memory, now.getTime())) continue; // a team member is handling this chat

      const inboundMs = lastInbound.createdAt.getTime();
      const sentSoFar = state.reminderFor === inboundMs ? state.reminders ?? 0 : 0;
      const step = dueBookingReminder({
        sent: sentSoFar,
        inboundAt: lastInbound.createdAt,
        now,
        lastReminderAt: state.reminderFor === inboundMs && state.remindedAt ? new Date(state.remindedAt) : null,
      });
      if (step === null) continue;

      const [clinic, contact] = await Promise.all([
        systemDb.clinic.findUnique({ where: { userId: c.userId }, select: { clinicName: true, aiSettings: { select: { aiEnabled: true } } } }),
        systemDb.contact.findUnique({ where: { id: c.contactId }, select: { phone: true } }),
      ]);
      if (!clinic || clinic.aiSettings?.aiEnabled === false || !contact?.phone) continue;

      // Claim before sending so overlapping ticks cannot double-send: the
      // row's updatedAt changes on any write, including a new inbound message.
      const next: WizardState = { ...state, reminders: step + 1, remindedAt: now.getTime(), reminderFor: inboundMs };
      const claimed = await systemDb.conversation.updateMany({
        where: { id: c.id, updatedAt: c.updatedAt },
        data: { bookingState: next as unknown as Prisma.InputJsonValue },
      });
      if (claimed.count !== 1) continue;

      const text = await composeReminder({ step, state, clinicName: clinic.clinicName || tenant.name || 'our clinic', lang: memory.language, history: memory.history });
      const ok = await sendTenantText(c.tenantId, contact.phone.replace(/[^\d]/g, ''), text, c.contactId);
      if (ok) {
        sent += 1;
        log.info('booking reminder sent', { conversationId: c.id, reminder: step + 1, lang: memory.language.code });
      } else {
        // Give the slot back so the next tick retries.
        await systemDb.conversation
          .update({ where: { id: c.id }, data: { bookingState: state as unknown as Prisma.InputJsonValue } })
          .catch(() => undefined);
      }
    } catch (error) {
      log.warn('booking follow-up failed for a conversation', { conversationId: c.id, err: error });
    }
  }
  return { checked: candidates.length, sent };
}
