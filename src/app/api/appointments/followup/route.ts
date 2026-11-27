import { z } from 'zod';

import { createHandler } from '@/server/kernel';
import { runBookingFollowUps } from '@/server/services/booking-followup';

/**
 * Cron (server ticker, every minute): remind patients who started booking an
 * appointment on WhatsApp but stopped replying (5 min, 5 h, 10 h).
 */
export const POST = createHandler({
  operation: 'appointments.followup',
  auth: 'cron',
  response: z.object({ checked: z.number(), sent: z.number() }),
  handle: async () => runBookingFollowUps(),
});
export const GET = POST;
