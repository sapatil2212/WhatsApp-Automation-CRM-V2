import { flowController } from '@/server/controllers/flow.controller';

export const GET = flowController.get;
export const PATCH = flowController.update;
export const DELETE = flowController.remove;
