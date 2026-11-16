import { appointmentController } from '@/server/controllers/appointment.controller';

export const GET = appointmentController.list;
export const POST = appointmentController.book;
