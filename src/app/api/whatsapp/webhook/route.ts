import { webhookController } from '@/server/controllers/webhook.controller';

export const GET = webhookController.verify;
export const POST = webhookController.receive;
