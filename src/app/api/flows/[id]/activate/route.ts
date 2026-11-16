import { flowController } from '@/server/controllers/flow.controller';

export const POST = flowController.activate;
export const PATCH = flowController.setStatus;
