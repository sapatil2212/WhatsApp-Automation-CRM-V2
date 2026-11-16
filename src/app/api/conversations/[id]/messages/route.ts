import { conversationController } from '@/server/controllers/conversation.controller';

export const GET = conversationController.listMessages;
export const POST = conversationController.send;
