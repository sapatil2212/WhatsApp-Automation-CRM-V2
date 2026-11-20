/**
 * Drip sequences: timed WhatsApp messages to enrolled contacts.
 *
 *  - `template` steps work any time (approved Meta template).
 *  - `text` steps are free-form, so they only go out inside the 24-hour
 *    customer-service window; outside it the step is skipped (never fails
 *    the whole sequence).
 *  - The sequence stops when the contact replies (if `stopOnReply`), opts out
 *    ("stop", "not interested"...), or the sequence is paused/deleted.
 *  - Enrolments are claimed with a conditional update, so overlapping ticks
 *    cannot double-send.
 */

import { z } from 'zod';

import { getLogger, systemDb, tenantDb } from '../kernel';
import { isOptOut } from './lead-nurture';
import { sendTenantText } from './booking-notify';
import { WhatsappTransport } from './whatsapp-transport';

const log = getLogger('drip');
const HOUR = 3_600_000;
const WINDOW_MS = 24 * HOUR - 5 * 60_000;

export const stepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('template'), delayHours: z.number().min(0).max(24 * 60), templateName: z.string().trim().min(1).max(120), language: z.string().trim().max(20).default('en_US'), params: z.array(z.string().max(500)).max(20).default([]) }),
  z.object({ kind: z.literal('text'), delayHours: z.number().min(0).max(24 * 60), text: z.string().trim().min(1).max(1000) }),
]);
export type DripStep = z.infer<typeof stepSchema>;
export const stepsSchema = z.array(stepSchema).min(1).max(15);

/** Replaces {{name}} with the contact's first name. */
export function personalize(text: string, name?: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] || 'there';
  return text.replace(/\{\{\s*name\s*\}\}/gi, first);
}

/** When the step at `stepIndex` is due, counted from `from` (pure). */
export function nextRunFor(steps: DripStep[], stepIndex: number, from: Date): Date | null {
  const next = steps[stepIndex];
  return next ? new Date(from.getTime() + next.delayHours * HOUR) : null;
}

export async function enrollContacts(tenantId: string, sequenceId: string, contactIds: string[], now = new Date()): Promise<{ enrolled: number; skipped: number }> {
  const seq = await systemDb.dripSequence.findFirst({ where: { id: sequenceId, tenantId } });
  if (!seq) throw new Error('Sequence not found.');
  const steps = stepsSchema.parse(seq.steps);
  const contacts = await systemDb.contact.findMany({ where: { tenantId, id: { in: contactIds.slice(0, 2000) } }, select: { id: true } });
  let enrolled = 0;
  for (const c of contacts) {
    try {
      await systemDb.dripEnrollment.create({ data: { tenantId, sequenceId, contactId: c.id, nextRunAt: nextRunFor(steps, 0, now)! } });
      enrolled += 1;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e; // already enrolled
    }
  }
  return { enrolled, skipped: contactIds.length - enrolled };
}

async function windowOpen(tenantId: string, contactId: string): Promise<boolean> {
  const last = await systemDb.message.findFirst({ where: { senderType: 'customer', conversation: { tenantId, contactId } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  return Boolean(last && Date.now() - last.createdAt.getTime() < WINDOW_MS);
}

async function sendTemplateStep(tenantId: string, contactId: string, phone: string, step: Extract<DripStep, { kind: 'template' }>, name: string | null): Promise<void> {
  const transport = await WhatsappTransport.forTenant(tenantDb(tenantId));
  if (!transport) throw new Error('WhatsApp is not connected.');
  const params = step.params.map((p) => personalize(p, name));
  const { whatsappMessageId } = await transport.sendTemplate({ to: phone, templateName: step.templateName, language: step.language, params });
  const conversation = await systemDb.conversation.findFirst({ where: { tenantId, contactId }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  if (conversation) {
    const body = (await systemDb.messageTemplate.findFirst({ where: { tenantId, name: step.templateName }, select: { bodyText: true } }))?.bodyText ?? step.templateName;
    const text = body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
    await systemDb.message.create({ data: { conversationId: conversation.id, senderType: 'bot', contentType: 'template', templateName: step.templateName, contentText: text, status: 'sent', messageId: whatsappMessageId } });
    await systemDb.conversation.update({ where: { id: conversation.id }, data: { lastMessageText: text.slice(0, 500), lastMessageAt: new Date() } });
  }
}

/** One pass over due enrolments across tenants. */
export async function runDrips(now = new Date()): Promise<{ checked: number; sent: number }> {
  const due = await systemDb.dripEnrollment.findMany({
    where: { status: 'active', nextRunAt: { lte: now } },
    include: { sequence: true, contact: { select: { name: true, phone: true } } },
    orderBy: { nextRunAt: 'asc' },
    take: 200,
  });
  let sent = 0;
  for (const e of due) {
    const stop = (reason: string) => systemDb.dripEnrollment.update({ where: { id: e.id }, data: { status: 'stopped', stopReason: reason } });
    try {
      if (e.sequence.status !== 'active') continue; // paused: leave the enrolment waiting
      const steps = stepsSchema.parse(e.sequence.steps);
      const step = steps[e.step];
      if (!step) {
        await systemDb.dripEnrollment.update({ where: { id: e.id }, data: { status: 'completed' } });
        continue;
      }
      const phone = (e.contact.phone ?? '').replace(/\D/g, '');
      if (phone.length < 10) {
        await stop('no_phone');
        continue;
      }

      const lastInbound = await systemDb.message.findFirst({ where: { senderType: 'customer', conversation: { tenantId: e.tenantId, contactId: e.contactId } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, contentText: true } });
      if (lastInbound && isOptOut(lastInbound.contentText) && lastInbound.createdAt > e.createdAt) {
        await stop('opted_out');
        continue;
      }
      if (e.sequence.stopOnReply && lastInbound && lastInbound.createdAt > e.createdAt) {
        await stop('replied');
        continue;
      }

      // Claim: advance the cursor first so a second tick cannot resend.
      const following = nextRunFor(steps, e.step + 1, now);
      const claimed = await systemDb.dripEnrollment.updateMany({
        where: { id: e.id, step: e.step, status: 'active' },
        data: { step: e.step + 1, nextRunAt: following ?? now, status: following ? 'active' : 'completed', lastError: null },
      });
      if (claimed.count !== 1) continue;

      try {
        if (step.kind === 'template') {
          await sendTemplateStep(e.tenantId, e.contactId, phone, step, e.contact.name);
          sent += 1;
        } else if (await windowOpen(e.tenantId, e.contactId)) {
          if (!(await sendTenantText(e.tenantId, phone, personalize(step.text, e.contact.name), e.contactId))) throw new Error('Text send failed.');
          sent += 1;
        } else {
          await systemDb.dripEnrollment.update({ where: { id: e.id }, data: { lastError: `Step ${e.step + 1} skipped: outside the 24-hour window (use a template step).` } });
        }
      } catch (error) {
        // Keep the sequence moving; surface the reason on the enrolment.
        await systemDb.dripEnrollment.update({ where: { id: e.id }, data: { lastError: (error instanceof Error ? error.message : String(error)).slice(0, 480) } }).catch(() => undefined);
        log.warn('drip step failed', { enrollmentId: e.id, err: error });
      }
    } catch (error) {
      log.warn('drip enrolment failed', { enrollmentId: e.id, err: error });
    }
  }
  if (sent) log.info('drip messages sent', { checked: due.length, sent });
  return { checked: due.length, sent };
}
