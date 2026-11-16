import { broadcastController } from '@/server/controllers/broadcast.controller';

export const GET = broadcastController.get;
export const PATCH = broadcastController.update;
export const DELETE = broadcastController.delete;
