import { automationController } from '@/server/controllers/automation.controller';

export const GET = automationController.list;
export const POST = automationController.create;
