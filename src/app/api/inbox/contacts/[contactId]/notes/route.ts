import { inboxController } from '@/server/controllers/inbox.controller';

export const POST = inboxController.addNote;
export const DELETE = inboxController.deleteNote;
