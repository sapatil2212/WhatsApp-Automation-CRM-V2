/**
 * Sends a finalized prescription PDF to the patient on WhatsApp.
 *
 *  1. Consent + phone checks (no send to a number that doesn't match the
 *     patient record, or without consent).
 *  2. Idempotency through AppointmentNotificationLog (eventKey per
 *     prescription; explicit staff resends get their own key).
 *  3. Upload the PDF to the tenant's phone number → media_id.
 *  4. Approved `patient_prescription_delivery` template with the PDF as the
 *     document header; inside the 24h window a plain document is allowed;
 *     otherwise blocked with an actionable status.
 *  5. Temporary failures are retried by the server ticker (max 3 attempts).
 *
 * The clinical record is never affected by delivery problems.
 */

import { mapVariables } from '@/lib/whatsapp/appointment-template-library';
import { getLogger, systemDb, tenantDb } from '../kernel';
import { isTransient } from './appointment-notify';
import { notifyTenant } from './booking-notify';
import { pickActive, readVariables } from './utility-template.service';
import { WhatsappTransport } from './whatsapp-transport';

const log = getLogger('prescription-delivery');
const WINDOW_MS = 24 * 60 * 60 * 1000 - 5 * 60 * 1000;
export const MAX_DELIVERY_ATTEMPTS = 3;

const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');

export interface DeliveryOutcome {
  status: 'sent' | 'failed' | 'blocked' | 'duplicate' | 'skipped';
  message: string;
}

export async function deliverPrescription(tenantId: string, prescriptionId: string, opts: { manual?: boolean; byUserId?: string } = {}): Promise<DeliveryOutcome> {
  const rx = await systemDb.prescription.findFirst({
    where: { id: prescriptionId, tenantId },
    include: {
      contact: { select: { id: true, name: true, phone: true } },
      doctor: { select: { doctorName: true } },
      clinic: { select: { clinicName: true } },
      consultation: { select: { appointmentId: true, appointment: { select: { patientName: true, detail: { select: { whatsappConsent: true, patientPhone: true } } } } } },
    },
  });
  if (!rx) return { status: 'skipped', message: 'Prescription not found.' };
  if (rx.status !== 'finalized' || !rx.pdf) return { status: 'skipped', message: 'Only finalized prescriptions can be sent.' };
  if (!opts.manual && ['sent', 'delivered', 'read'].includes(rx.deliveryStatus)) return { status: 'duplicate', message: 'Already sent.' };

  const set = (data: Record<string, unknown>) => systemDb.prescription.update({ where: { id: rx.id }, data });
  const detail = rx.consultation.appointment.detail;
  const phone = digits(rx.contact.phone);
  const consent = !detail || detail.whatsappConsent;

  if (phone.length < 10) {
    await set({ deliveryStatus: 'blocked', deliveryError: 'No valid WhatsApp number on the patient record.' });
    return { status: 'blocked', message: 'No valid WhatsApp number on the patient record.' };
  }
  if (detail?.patientPhone && digits(detail.patientPhone) !== phone) {
    await set({ deliveryStatus: 'blocked', deliveryError: 'The booking phone differs from the patient record. Verify the number before sending.' });
    return { status: 'blocked', message: 'Phone mismatch — verify the patient number first.' };
  }
  if (!consent && !opts.manual) {
    await set({ deliveryStatus: 'blocked', deliveryError: 'Patient has not agreed to WhatsApp messages. Staff can send it manually after confirming consent.' });
    return { status: 'blocked', message: 'No WhatsApp consent.' };
  }

  // Idempotency claim (auto sends: one per prescription; manual: one per minute).
  const eventKey = opts.manual ? `prescription@${rx.prescriptionNo}#manual-${new Date().toISOString().slice(0, 16)}` : `prescription@${rx.prescriptionNo}`;
  let logId: string;
  try {
    logId = (
      await systemDb.appointmentNotificationLog.create({
        data: { tenantId, appointmentId: rx.consultation.appointmentId, contactId: rx.contact.id, eventType: 'prescription', eventKey, phoneNumber: phone, status: 'pending' },
        select: { id: true },
      })
    ).id;
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e;
    const prev = await systemDb.appointmentNotificationLog.findUnique({ where: { appointmentId_eventKey: { appointmentId: rx.consultation.appointmentId, eventKey } }, select: { id: true, status: true, attempts: true } });
    if (!prev || prev.status === 'sent' || prev.attempts >= MAX_DELIVERY_ATTEMPTS) return { status: 'duplicate', message: 'This prescription was already sent.' };
    logId = prev.id;
  }
  const finishLog = (data: Record<string, unknown>) => systemDb.appointmentNotificationLog.update({ where: { id: logId }, data }).catch(() => undefined);

  const transport = await WhatsappTransport.forTenant(tenantDb(tenantId));
  if (!transport) {
    await set({ deliveryStatus: 'failed', deliveryError: 'WhatsApp is not connected for this clinic.', deliveryAttempts: { increment: 1 } });
    await finishLog({ status: 'failed', errorMessage: 'WhatsApp not connected', attempts: { increment: 1 } });
    return { status: 'failed', message: 'WhatsApp is not connected.' };
  }

  const fileName = `Prescription-${rx.prescriptionNo}.pdf`;
  const patientName = rx.consultation.appointment.patientName || rx.contact.name || 'there';
  const doctorName = rx.doctor?.doctorName ? (/^dr\.?\s/i.test(rx.doctor.doctorName) ? rx.doctor.doctorName : `Dr. ${rx.doctor.doctorName}`) : 'your doctor';

  try {
    const mediaId = await transport.uploadMedia({ bytes: new Uint8Array(rx.pdf), mimeType: 'application/pdf', fileName });
    await set({ deliveryStatus: 'uploaded', mediaId });

    const templates = await systemDb.messageTemplate.findMany({
      where: { tenantId, eventType: 'prescription' },
      select: { id: true, name: true, language: true, status: true, isEnabled: true, version: true, eventType: true, variables: true },
    });
    const template = pickActive(templates, 'prescription');
    let messageId: string;
    let channel: 'template' | 'document';
    if (template) {
      const params = mapVariables(readVariables(template.variables), { customer_name: patientName, doctor_name: doctorName, business_name: rx.clinic.clinicName });
      ({ whatsappMessageId: messageId } = await transport.sendTemplate({
        to: phone,
        templateName: template.name,
        language: template.language,
        params,
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: fileName } }] },
          { type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) },
        ],
      }));
      channel = 'template';
    } else {
      const last = await systemDb.message.findFirst({ where: { senderType: 'customer', conversation: { tenantId, contactId: rx.contact.id } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (!last || Date.now() - last.createdAt.getTime() > WINDOW_MS) {
        const msg = 'Approve the "Prescription delivery (PDF)" WhatsApp template to send prescriptions outside the 24-hour window.';
        await set({ deliveryStatus: 'blocked', deliveryError: msg });
        await finishLog({ status: 'blocked_no_template', errorMessage: msg });
        notifyTenant(tenantId, { type: 'template', title: 'Prescription not sent on WhatsApp', body: msg, href: '/connections/whatsapp-templates' });
        return { status: 'blocked', message: msg };
      }
      ({ whatsappMessageId: messageId } = await transport.sendDocument({ to: phone, mediaId, fileName, caption: `Hello ${patientName}, your prescription from ${doctorName} at ${rx.clinic.clinicName} is attached.` }));
      channel = 'document';
    }

    const now = new Date();
    await set({ deliveryStatus: 'sent', whatsappMessageId: messageId, sentAt: now, deliveryError: null, deliveryAttempts: { increment: 1 } });
    await finishLog({ status: 'sent', channel: channel === 'template' ? 'template' : 'text', templateId: template?.id ?? null, templateName: template?.name ?? null, templateVersion: template?.version ?? null, messageId, sentAt: now, attempts: { increment: 1 } });
    // Show it in the inbox thread.
    const conversation = await systemDb.conversation.findFirst({ where: { tenantId, contactId: rx.contact.id }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
    if (conversation) {
      await systemDb.message
        .create({ data: { conversationId: conversation.id, senderType: 'bot', contentType: 'document', contentText: `📄 ${fileName}`, templateName: template?.name ?? null, status: 'sent', messageId } })
        .catch(() => undefined);
    }
    return { status: 'sent', message: channel === 'template' ? 'Sent with the approved template.' : 'Sent as a document (patient messaged within 24 hours).' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const transient = isTransient(msg);
    await set({ deliveryStatus: 'failed', deliveryError: `${transient ? '[will retry] ' : ''}${msg}`.slice(0, 2000), deliveryAttempts: { increment: 1 } });
    await finishLog({ status: 'failed', errorMessage: msg.slice(0, 2000), attempts: { increment: 1 } });
    log.warn('prescription delivery failed', { tenantId, prescriptionId, transient, err: msg });
    return { status: 'failed', message: msg };
  }
}

/** Ticker hook: retries temporary failures (queue-style, max 3 attempts). */
export async function retryPrescriptionDeliveries(now = new Date()): Promise<number> {
  const rows = await systemDb.prescription.findMany({
    where: { status: 'finalized', deliveryStatus: 'failed', deliveryAttempts: { lt: MAX_DELIVERY_ATTEMPTS }, deliveryError: { startsWith: '[will retry]' }, updatedAt: { lt: new Date(now.getTime() - 2 * 60 * 1000) } },
    select: { id: true, tenantId: true },
    take: 20,
  });
  let retried = 0;
  for (const r of rows) {
    await deliverPrescription(r.tenantId, r.id).catch(() => undefined);
    retried += 1;
  }
  return retried;
}
