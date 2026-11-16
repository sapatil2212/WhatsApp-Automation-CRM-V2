/**
 * Appointment controller exposing booking, rescheduling, availability,
 * intake records, and status transitions.
 */

import { z } from 'zod';
import {
  createHandler,
  result,
  type AuthContext,
} from '../kernel';
import { paged } from './controller-kit';
import {
  appointmentDtoSchema,
  doctorAvailabilityDtoSchema,
  patientFeedbackDtoSchema,
  patientIntakeDtoSchema,
} from '../dtos/appointment.dto';
import { AppointmentService } from '../services/appointment.service';
import {
  availabilityQuerySchema,
  bookAppointmentBodySchema,
  clinicChildParamsSchema,
  listAppointmentsQuerySchema,
  recordFeedbackBodySchema,
  recordIntakeBodySchema,
  rescheduleAppointmentBodySchema,
  setAppointmentStatusBodySchema,
} from '../validators/clinic.validator';

function assertTenant(ctx: AuthContext | null): asserts ctx is AuthContext {
  if (!ctx?.tenantId) throw new Error('Tenant context required.');
}

export const appointmentController = {
  list: createHandler({
    operation: 'appointments.list',
    auth: 'tenant',
    query: listAppointmentsQuerySchema,
    response: z.array(appointmentDtoSchema),
    async handle({ query, ctx, db }) {
      assertTenant(ctx);
      const service = AppointmentService.create(db);
      const page = await service.list(query);
      return paged(page);
    },
  }),

  availability: createHandler({
    operation: 'appointments.availability',
    auth: 'tenant',
    query: availabilityQuerySchema,
    response: doctorAvailabilityDtoSchema,
    async handle({ query, ctx, db }) {
      assertTenant(ctx);
      const service = AppointmentService.create(db);
      return result(await service.availability(query));
    },
  }),

  book: createHandler({
    operation: 'appointments.book',
    auth: 'tenant',
    body: bookAppointmentBodySchema,
    response: appointmentDtoSchema,
    status: 201,
    message: 'Appointment booked successfully.',
    async handle({ body, ctx, db }) {
      assertTenant(ctx);
      const service = AppointmentService.create(db);
      return result(await service.book(body));
    },
  }),

  reschedule: createHandler({
    operation: 'appointments.reschedule',
    auth: 'tenant',
    params: clinicChildParamsSchema,
    body: rescheduleAppointmentBodySchema,
    response: appointmentDtoSchema,
    message: 'Appointment rescheduled successfully.',
    async handle({ params, body, ctx, db }) {
      assertTenant(ctx);
      const service = AppointmentService.create(db);
      return result(await service.reschedule(params.id, body));
    },
  }),

  setStatus: createHandler({
    operation: 'appointments.setStatus',
    auth: 'tenant',
    params: clinicChildParamsSchema,
    body: setAppointmentStatusBodySchema,
    response: appointmentDtoSchema,
    message: 'Appointment status updated.',
    async handle({ params, body, ctx, db }) {
      assertTenant(ctx);
      const service = AppointmentService.create(db);
      return result(await service.setStatus(params.id, body));
    },
  }),

  recordIntake: createHandler({
    operation: 'appointments.recordIntake',
    auth: 'tenant',
    params: clinicChildParamsSchema,
    body: recordIntakeBodySchema,
    response: patientIntakeDtoSchema,
    status: 201,
    message: 'Patient intake recorded.',
    async handle({ params, body, ctx, db }) {
      assertTenant(ctx);
      const service = AppointmentService.create(db);
      return result(await service.recordIntake({ ...body, appointmentId: params.id }));
    },
  }),

  recordFeedback: createHandler({
    operation: 'appointments.recordFeedback',
    auth: 'tenant',
    params: clinicChildParamsSchema,
    body: recordFeedbackBodySchema,
    response: patientFeedbackDtoSchema,
    status: 201,
    message: 'Patient feedback recorded.',
    async handle({ params, body, ctx, db }) {
      assertTenant(ctx);
      const service = AppointmentService.create(db);
      return result(await service.recordFeedback({ ...body, appointmentId: params.id }));
    },
  }),
};
