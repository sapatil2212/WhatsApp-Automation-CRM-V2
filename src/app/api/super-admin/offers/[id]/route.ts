import { billingController as c } from '@/server/controllers/billing.controller';
export const PUT = c.offerUpdate;
export const PATCH = c.offerToggle;
export const DELETE = c.offerDelete;
