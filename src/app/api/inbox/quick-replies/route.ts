import { inboxController } from '@/server/controllers/inbox.controller';

export const GET = inboxController.listQuickReplies;
export const POST = inboxController.addQuickReply;
export const DELETE = inboxController.deleteQuickReply;
