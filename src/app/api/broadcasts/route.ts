import { broadcastController } from '@/server/controllers/broadcast.controller';

export const GET = broadcastController.list;
export const POST = broadcastController.create;
