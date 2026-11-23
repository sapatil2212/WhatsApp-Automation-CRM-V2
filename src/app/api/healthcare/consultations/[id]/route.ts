import { consultationController as c } from '@/server/controllers/consultation.controller';
export const GET = c.workspace;
export const PATCH = c.autosave;
export const DELETE = c.discard;
