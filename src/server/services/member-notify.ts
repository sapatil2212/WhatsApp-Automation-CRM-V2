/**
 * WhatsApp messages to gym members (welcome now; renewal / inactivity later).
 *
 * Uses the same delivery engine as appointment messages: inside the 24-hour
 * window the free-form text is sent, outside it the tenant's approved utility
 * template for the event, otherwise nothing (logged, tenant alerted). Only the
 * idempotency log differs: attempts are claimed in MemberMessageLog keyed by
 * (memberId, eventKey), so a member never gets the same message twice.
 */

import type { Prisma } from '@prisma/client';

import type { TemplateEvent, VariableSource } from '@/lib/whatsapp/appointment-template-library';
import { systemDb } from '../kernel';
import { deliverAppointmentMessage, type DeliverInput, type DeliverResult } from './appointment-notify';

export interface MemberMessageInput {
  tenantId: string;
  memberId: string;
  contactId: string | null;
  phone: string | null;
  consent: boolean;
  event: TemplateEvent;
  eventKey: string;
  text: string;
  values: Partial<Record<VariableSource, string | null>>;
}

async function claim(input: DeliverInput): Promise<{ id: string } | null> {
  const key = input.eventKey.slice(0, 120);
  try {
    return await systemDb.memberMessageLog.create({
      data: {
        tenantId: input.tenantId,
        memberId: input.appointmentId,
        contactId: input.contactId,
        eventType: input.event,
        eventKey: key,
        phoneNumber: input.phone?.slice(0, 32) ?? null,
        status: 'pending',
      },
      select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const prev = await systemDb.memberMessageLog.findUnique({
      where: { memberId_eventKey: { memberId: input.appointmentId, eventKey: key } },
      select: { id: true, status: true, attempts: true },
    });
    // Retry only an earlier attempt that failed or had no template yet.
    if (prev && ['failed', 'blocked_no_template'].includes(prev.status) && prev.attempts < 3) return { id: prev.id };
    return null;
  }
}

async function finish(id: string, data: Record<string, unknown>): Promise<void> {
  await systemDb.memberMessageLog.update({ where: { id }, data: data as Prisma.MemberMessageLogUpdateInput });
}

export function deliverMemberMessage(input: MemberMessageInput): Promise<DeliverResult> {
  return deliverAppointmentMessage({
    tenantId: input.tenantId,
    // The engine's idempotency key field; claim/finish above store it as memberId.
    appointmentId: input.memberId,
    contactId: input.contactId,
    phone: input.phone,
    consent: input.consent,
    event: input.event,
    eventKey: input.eventKey,
    text: input.text,
    values: input.values,
    deps: { claim, finish },
  });
}
