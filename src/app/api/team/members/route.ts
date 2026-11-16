import { teamController } from '@/server/controllers/team.controller';

export const GET = teamController.list;
export const POST = teamController.invite;
export const DELETE = teamController.remove;
