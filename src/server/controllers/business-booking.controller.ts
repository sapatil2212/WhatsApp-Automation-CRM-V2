/**
 * Bookings board for non-clinic businesses.
 *
 *   GET    /api/business/bookings              list + services + contacts
 *   POST   /api/business/bookings              add a booking
 *   PATCH  /api/business/bookings/[id]         edit, or { status } only
 *   DELETE /api/business/bookings/[id]         delete one
 *   POST   /api/business/bookings/bulk-delete  delete many
 */

import { z } from 'zod';

import { createHandler, NotFoundError } from '../kernel';
import {
  businessBookingBulkDeleteSchema,
  businessBookingSchema,
  businessBookingUpdateSchema,
  createBusinessBooking,
  deleteBusinessBookings,
  listBusinessBookings,
  updateBusinessBooking,
} from '../services/business-booking.service';

const idParams = z.object({ id: z.string().uuid() });
const loose = z.any();

export const businessBookingController = {
  list: createHandler({ operation: 'business.bookings.list', auth: 'tenant', response: loose, handle: ({ db }) => listBusinessBookings(db) }),
  create: createHandler({
    operation: 'business.bookings.create',
    auth: 'tenant',
    body: businessBookingSchema,
    response: loose,
    status: 201,
    message: 'Booking added.',
    handle: ({ ctx, db, body }) => createBusinessBooking(db, { tenantId: ctx.tenantId, userId: ctx.userId }, body),
  }),
  update: createHandler({
    operation: 'business.bookings.update',
    auth: 'tenant',
    params: idParams,
    body: businessBookingUpdateSchema,
    response: loose,
    handle: ({ ctx, db, params, body }) => updateBusinessBooking(db, { tenantId: ctx.tenantId, userId: ctx.userId }, params.id, body),
  }),
  remove: createHandler({
    operation: 'business.bookings.delete',
    auth: 'tenant',
    params: idParams,
    response: loose,
    async handle({ ctx, db, params }) {
      const res = await deleteBusinessBookings(db, ctx.tenantId, [params.id]);
      if (!res.deleted.length) throw new NotFoundError('Booking');
      return res;
    },
  }),
  bulkRemove: createHandler({
    operation: 'business.bookings.bulkDelete',
    auth: 'tenant',
    body: businessBookingBulkDeleteSchema,
    response: loose,
    handle: ({ ctx, db, body }) => deleteBusinessBookings(db, ctx.tenantId, body.ids),
  }),
};
