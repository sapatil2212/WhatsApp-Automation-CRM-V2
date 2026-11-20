import { contactController } from '@/server/controllers/contact.controller';

export const GET = contactController.get;
export const PATCH = contactController.update;
export const DELETE = contactController.remove;
