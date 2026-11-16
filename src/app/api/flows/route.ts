import { flowController } from '@/server/controllers/flow.controller';

export const GET = flowController.list;
export const POST = flowController.create;
