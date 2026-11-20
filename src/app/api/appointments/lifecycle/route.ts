import { z } from 'zod';

import { createHandler } from '@/server/kernel';
import { runAppointmentLifecycle } from '@/server/services/appointment-lifecycle';
import { retryPrescriptionDeliveries } from '@/server/services/prescription-delivery';

/**
 * Cron (server ticker, every minute): appointment confirmations, reminders,
 * post-visit and follow-up messages, plus retries of prescription PDFs whose
 * WhatsApp delivery hit a temporary error.
 */
export const POST = createHandler({
  operation: 'appointments.lifecycle',
  auth: 'cron',
  response: z.object({ checked: z.number(), sent: z.number(), prescriptionRetries: z.number() }),
  handle: async () => {
    const result = await runAppointmentLifecycle();
    const prescriptionRetries = await retryPrescriptionDeliveries().catch(() => 0);
    return { ...result, prescriptionRetries };
  },
});
export const GET = POST;
