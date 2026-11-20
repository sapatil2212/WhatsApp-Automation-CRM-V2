import { inboxController } from '@/server/controllers/inbox.controller';

export const POST = inboxController.addTag;
export const DELETE = inboxController.removeTag;
