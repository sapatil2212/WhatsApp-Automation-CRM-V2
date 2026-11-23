/**
 * Clinic dashboard appointments board.
 *
 *   GET   /api/healthcare/appointments/board          list + stats + doctors
 *   POST  /api/healthcare/appointments/board          book from the dashboard
 *   GET   /api/healthcare/appointments/board/[id]     full detail
 *   PATCH /api/healthcare/appointments/board/[id]     status / reschedule / remind / edit
 *   DELETE /api/healthcare/appointments/board/[id]    delete one
 *   POST  /api/healthcare/appointments/board/bulk-delete  delete many
 */

import { z } from 'zod';

import { ConflictError, createHandler } from '../kernel';
import {
  actOnBoard,
  boardActionSchema,
  boardBulkDeleteSchema,
  boardCreateSchema,
  boardDetail,
  boardQuerySchema,
  createFromBoard,
  deleteFromBoard,
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

  remove: createHandler({
    operation: 'appointments.board.delete',
    auth: 'tenant',
    params: idParams,
    response: loose,
    handle: async ({ ctx, db, params }) => {
      const res = await deleteFromBoard(db, ctx.tenantId, [params.id]);
      if (res.blocked.length) throw new ConflictError(res.blocked[0].reason);
      return res;
    },
  }),

  bulkRemove: createHandler({
    operation: 'appointments.board.bulkDelete',
    auth: 'tenant',
    body: boardBulkDeleteSchema,
    response: loose,
    handle: async ({ ctx, db, body }) => deleteFromBoard(db, ctx.tenantId, body.ids),
  }),
};
