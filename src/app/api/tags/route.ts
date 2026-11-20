import { contactController } from '@/server/controllers/contact.controller';

export const GET = contactController.listTags;
export const POST = contactController.createTag;
