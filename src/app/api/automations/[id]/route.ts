import { automationController } from '@/server/controllers/automation.controller';

export const GET = automationController.get;
export const PATCH = automationController.update;
export const DELETE = automationController.remove;
