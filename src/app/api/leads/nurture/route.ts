import { z } from 'zod';

import { createHandler } from '@/server/kernel';
import { runLeadNurture } from '@/server/services/lead-nurture';

/** Cron (server ticker, every few minutes): follow up with customers who went quiet. */
export const POST = createHandler({
  operation: 'leads.nurture',
  auth: 'cron',
  response: z.object({ checked: z.number(), sent: z.number() }),
  handle: async () => runLeadNurture(),
});
export const GET = POST;
