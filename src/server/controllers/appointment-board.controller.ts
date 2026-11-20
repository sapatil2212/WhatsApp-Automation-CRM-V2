/**
 * Clinic dashboard appointments board.
 *
 *   GET   /api/healthcare/appointments/board          list + stats + doctors
 *   POST  /api/healthcare/appointments/board          book from the dashboard
 *   GET   /api/healthcare/appointments/board/[id]     full detail
 *   PATCH /api/healthcare/appointments/board/[id]     status / reschedule / remind
 */

import { z } from 'zod';

import { createHandler } from '../kernel';
import {
  actOnBoard,
  boardActionSchema,
  boardCreateSchema,
  boardDetail,
  boardQuerySchema,
  createFromBoard,
  listBoard,
} from '../services/appointment-board.service';

const idParams = z.object({ id: z.string().uuid() });
const loose = z.any();

export const appointmentBoardController = {
  list: createHandler({
    operation: 'appointments.board.list',
    auth: 'tenant',
    query: boardQuerySchema,
    response: loose,
    handle: async ({ db, query }) => listBoard(db, query),
  }),

  create: createHandler({
    operation: 'appointments.board.create',
    auth: 'tenant',
    body: boardCreateSchema,
    response: loose,
    status: 201,
    message: 'Appointment booked.',
    handle: async ({ ctx, db, body }) => createFromBoard(db, { tenantId: ctx.tenantId, userId: ctx.userId }, body),
  }),

  detail: createHandler({
    operation: 'appointments.board.detail',
    auth: 'tenant',
    params: idParams,
    response: loose,
    handle: async ({ db, params }) => boardDetail(db, params.id),
  }),

  act: createHandler({
    operation: 'appointments.board.act',
    auth: 'tenant',
    params: idParams,
    body: boardActionSchema,
    response: loose,
    handle: async ({ ctx, db, params, body }) => actOnBoard(db, ctx.tenantId, params.id, body),
  }),
};
