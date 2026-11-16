import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, NotFoundError } from '../kernel';
import { AppointmentService, type AppointmentServiceDeps } from './appointment.service';

const FRIDAY = '2026-05-22';
const NOW = new Date('2026-05-20T08:00:00.000Z');

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    appointmentDate: utcDate(FRIDAY),
    appointmentTime: '09:00',
    status: 'scheduled',
    patientName: 'Asha',
    patientAge: '34',
    reasonForVisit: 'Checkup',
    remindersSent: null,
    feedbackSent: false,
    followupSent: false,
    sheetsSynced: false,
    createdAt: NOW,
    updatedAt: NOW,
    doctorId: 'doc-1',
    contactId: 'contact-1',
    clinicId: 'clinic-1',
    contact: { id: 'contact-1', phone: '919876543210', name: 'Asha' },
    doctor: { id: 'doc-1', doctorName: 'Dr Rao', specialization: 'Dentist' },
    ...overrides,
  };
}

interface TimingRow {
  id: string;
  dayName: string;
  isClosed: boolean;
  openingTime: string | null;
  closingTime: string | null;
  lunchBreakStart: string | null;
  lunchBreakEnd: string | null;
}

interface BookInput {
  clinicId: string;
  contactId: string;
  doctorId: string;
  appointmentDate: Date;
  appointmentTime: string;
  patientName: string | null;
  patientAge: string | null;
  reasonForVisit: string | null;
}

function makeDeps() {
  const appointments = {
    list: vi.fn(),
    findById: vi.fn(async () => appointmentRow()),
    findBookedSlots: vi.fn(
      async (): Promise<Array<{ appointmentDate: Date; appointmentTime: string }>> => [],
    ),
    // Explicit signature so `mock.calls[0][0]` is typed, and so the
    // null-return (lost race) cases below type-check.
    book: vi.fn(
      async (_input: BookInput): Promise<ReturnType<typeof appointmentRow> | null> =>
        appointmentRow(),
    ),
    reschedule: vi.fn(
      async (): Promise<ReturnType<typeof appointmentRow> | null> =>
        appointmentRow({ appointmentTime: '10:00' }),
    ),
    setStatus: vi.fn(async () => appointmentRow({ status: 'completed' })),
    findUpcoming: vi.fn(async (): Promise<Array<ReturnType<typeof appointmentRow>>> => []),
    markReminderSent: vi.fn(async () => true),
    markFeedbackSent: vi.fn(async () => true),
    markFollowupSent: vi.fn(async () => true),
    markSheetsSynced: vi.fn(async () => undefined),
    createIntake: vi.fn(),
    listIntakes: vi.fn(),
    createFeedback: vi.fn(),
    listFeedback: vi.fn(),
    averageRating: vi.fn(async () => ({ average: 4.5, count: 10 })),
    listAiChatLogs: vi.fn(),
    recordAiChat: vi.fn(),
    countAiChats: vi.fn(),
  };
  const clinics = {
    find: vi.fn(async () => ({ id: 'clinic-1', dateExceptions: {} })),
    require: vi.fn(),
    upsert: vi.fn(),
    // Annotated: an inferred `lunchBreakStart: null` would reject the
    // lunch-break override used further down.
    listTimings: vi.fn(
      async (): Promise<TimingRow[]> => [
        {
          id: 't-1',
          dayName: 'Friday',
          isClosed: false,
          openingTime: '09:00',
          closingTime: '12:00',
          lunchBreakStart: null,
          lunchBreakEnd: null,
        },
      ],
    ),
    replaceTimings: vi.fn(),
    listDoctors: vi.fn(),
    findDoctor: vi.fn(async () => ({
      id: 'doc-1',
      doctorName: 'Dr Rao',
      specialization: 'Dentist',
      qualification: null,
      experience: null,
      availableDays: ['Friday'],
      availableStartTime: null,
      availableEndTime: null,
      consultationFee: 500,
      languagesSpoken: null,
      profilePhoto: null,
      weeklySlots: null,
      dateExceptions: {},
    })),
    createDoctor: vi.fn(),
    updateDoctor: vi.fn(),
    deleteDoctor: vi.fn(),
    listServices: vi.fn(async () => [
      {
        id: 's-1',
        serviceName: 'Consultation',
        description: null,
        startingPrice: 500,
        duration: 30,
        isActive: true,
      },
    ]),
    createService: vi.fn(),
    updateService: vi.fn(),
    deleteService: vi.fn(),
    listFaqs: vi.fn(),
    createFaq: vi.fn(),
    updateFaq: vi.fn(),
    deleteFaq: vi.fn(),
    importFaqs: vi.fn(),
    findAiSettings: vi.fn(),
    upsertAiSettings: vi.fn(),
  };
  const contacts = { exists: vi.fn(async () => true) };
  return { appointments, clinics, contacts } as unknown as AppointmentServiceDeps & {
    appointments: typeof appointments;
    clinics: typeof clinics;
    contacts: typeof contacts;
  };
}

let deps: ReturnType<typeof makeDeps>;
let service: AppointmentService;

beforeEach(() => {
  deps = makeDeps();
  service = new AppointmentService(deps);
});

describe('setup guard', () => {
  it('404s with a hint when the clinic has not been set up', async () => {
    deps.clinics.find.mockResolvedValueOnce(null as never);
    await expect(service.list({ page: 1, pageSize: 25 } as never)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('availability', () => {
  it('returns slots per day, derived from clinic hours and the service duration', async () => {
    const result = await service.availability({ doctorId: 'doc-1', days: 3 }, NOW);
    expect(result.doctorName).toBe('Dr Rao');
    expect(result.days).toHaveLength(3);

    const friday = result.days.find((day) => day.date === FRIDAY);
    expect(friday?.slots).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('excludes slots already booked on that date', async () => {
    deps.appointments.findBookedSlots.mockResolvedValueOnce([
      { appointmentDate: utcDate(FRIDAY), appointmentTime: '09:00' },
      { appointmentDate: utcDate(FRIDAY), appointmentTime: '10:30' },
    ]);

    const result = await service.availability({ doctorId: 'doc-1', days: 3 }, NOW);
    const friday = result.days.find((day) => day.date === FRIDAY);
    expect(friday?.slots).toEqual(['09:30', '10:00', '11:00', '11:30']);
  });

  it('reports a reason for a day the doctor does not work', async () => {
    const result = await service.availability({ doctorId: 'doc-1', days: 3 }, NOW);
    const wednesday = result.days.find((day) => day.date === '2026-05-20');
    expect(wednesday?.slots).toEqual([]);
    expect(wednesday?.closedReason).toBeTruthy();
  });

  it('404s for a doctor from another clinic', async () => {
    deps.clinics.findDoctor.mockResolvedValueOnce(null as never);
    await expect(service.availability({ doctorId: 'doc-x', days: 7 }, NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('falls back to a 30-minute grid when no active service defines a duration', async () => {
    deps.clinics.listServices.mockResolvedValueOnce([]);
    const result = await service.availability({ doctorId: 'doc-1', days: 3 }, NOW);
    expect(result.days.find((day) => day.date === FRIDAY)?.slots).toHaveLength(6);
  });
});

describe('book', () => {
  const body = {
    contactId: 'contact-1',
    doctorId: 'doc-1',
    appointmentDate: utcDate(FRIDAY),
    appointmentTime: '09:00',
    patientName: 'Asha',
    patientAge: '34',
    reasonForVisit: 'Checkup',
  };

  it('books a slot that availability would offer', async () => {
    await service.book(body, NOW);
    expect(deps.appointments.book).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-1', appointmentTime: '09:00' }),
    );
  });

  it('refuses a slot that was never offered — off the step grid', async () => {
    await expect(service.book({ ...body, appointmentTime: '09:15' }, NOW)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(deps.appointments.book).not.toHaveBeenCalled();
  });

  it('refuses a slot outside opening hours', async () => {
    await expect(service.book({ ...body, appointmentTime: '08:00' }, NOW)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses a slot during lunch', async () => {
    deps.clinics.listTimings.mockResolvedValueOnce([
      {
        id: 't-1',
        dayName: 'Friday',
        isClosed: false,
        openingTime: '09:00',
        closingTime: '12:00',
        lunchBreakStart: '10:00',
        lunchBreakEnd: '10:30',
      },
    ]);
    await expect(service.book({ ...body, appointmentTime: '10:00' }, NOW)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses a slot already taken, and suggests alternatives', async () => {
    deps.appointments.findBookedSlots.mockResolvedValueOnce([
      { appointmentDate: utcDate(FRIDAY), appointmentTime: '09:00' },
    ]);

    await service.book(body, NOW).catch((error: ConflictError) => {
      const details = error.details as { availableSlots: string[] };
      expect(details.availableSlots).toContain('09:30');
    });
  });

  it('surfaces a lost race as a 409 rather than a 500', async () => {
    deps.appointments.book.mockResolvedValueOnce(null as never);
    await expect(service.book(body, NOW)).rejects.toBeInstanceOf(ConflictError);
  });

  it('404s for a contact outside the tenant', async () => {
    deps.contacts.exists.mockResolvedValueOnce(false);
    await expect(service.book(body, NOW)).rejects.toBeInstanceOf(NotFoundError);
    expect(deps.appointments.book).not.toHaveBeenCalled();
  });

  it('stores the date as given, without a timezone shift', async () => {
    await service.book(body, NOW);
    const call = deps.appointments.book.mock.calls[0][0];
    // A server-local parse on a UTC+5:30 host would have stored 2026-05-21.
    expect(call.appointmentDate.toISOString()).toBe('2026-05-22T00:00:00.000Z');
  });
});

describe('reschedule', () => {
  const body = { appointmentDate: utcDate(FRIDAY), appointmentTime: '10:00' };

  it('moves an appointment to another offered slot', async () => {
    await service.reschedule('appt-1', body, NOW);
    expect(deps.appointments.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'appt-1', appointmentTime: '10:00' }),
    );
  });

  it('does not treat the appointment’s own slot as a collision', async () => {
    await service.reschedule('appt-1', body, NOW);
    // The exclusion is passed down so the appointment cannot block itself.
    expect(deps.appointments.findBookedSlots).toHaveBeenCalledWith(
      'doc-1',
      expect.any(Date),
      expect.any(Date),
      'appt-1',
    );
  });

  it('refuses to reschedule a cancelled appointment', async () => {
    deps.appointments.findById.mockResolvedValueOnce(appointmentRow({ status: 'cancelled' }) as never);
    await expect(service.reschedule('appt-1', body, NOW)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to reschedule a completed appointment', async () => {
    deps.appointments.findById.mockResolvedValueOnce(appointmentRow({ status: 'completed' }) as never);
    await expect(service.reschedule('appt-1', body, NOW)).rejects.toBeInstanceOf(ConflictError);
  });

  it('surfaces a lost race as a 409', async () => {
    deps.appointments.reschedule.mockResolvedValueOnce(null as never);
    await expect(service.reschedule('appt-1', body, NOW)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('setStatus', () => {
  it('applies a legal change', async () => {
    await service.setStatus('appt-1', { status: 'completed' });
    expect(deps.appointments.setStatus).toHaveBeenCalledWith('clinic-1', 'appt-1', 'completed');
  });

  it('is idempotent for the current status', async () => {
    await service.setStatus('appt-1', { status: 'scheduled' });
    expect(deps.appointments.setStatus).not.toHaveBeenCalled();
  });

  it('refuses to change a terminal status, which would re-arm reminders', async () => {
    deps.appointments.findById.mockResolvedValueOnce(appointmentRow({ status: 'completed' }) as never);
    await expect(service.setStatus('appt-1', { status: 'scheduled' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('findRemindersDue', () => {
  it('returns an appointment inside the 24h window that has had no reminder', async () => {
    const at = new Date(NOW.getTime() + 20 * 3_600_000);
    deps.appointments.findUpcoming.mockResolvedValueOnce([
      appointmentRow({
        appointmentDate: utcDate(at.toISOString().slice(0, 10)),
        appointmentTime: at.toISOString().slice(11, 16),
        remindersSent: null,
      }),
    ]);

    const due = await service.findRemindersDue('24h', NOW);
    expect(due).toHaveLength(1);
  });

  it('skips an appointment whose reminder already went out', async () => {
    const at = new Date(NOW.getTime() + 20 * 3_600_000);
    deps.appointments.findUpcoming.mockResolvedValueOnce([
      appointmentRow({
        appointmentDate: utcDate(at.toISOString().slice(0, 10)),
        appointmentTime: at.toISOString().slice(11, 16),
        remindersSent: { '24h': NOW.toISOString() },
      }),
    ]);

    expect(await service.findRemindersDue('24h', NOW)).toEqual([]);
  });

  it('recognises the legacy boolean reminder shape as already sent', async () => {
    const at = new Date(NOW.getTime() + 20 * 3_600_000);
    deps.appointments.findUpcoming.mockResolvedValueOnce([
      appointmentRow({
        appointmentDate: utcDate(at.toISOString().slice(0, 10)),
        appointmentTime: at.toISOString().slice(11, 16),
        remindersSent: { '24h': true },
      }),
    ]);

    expect(await service.findRemindersDue('24h', NOW)).toEqual([]);
  });

  it('skips an appointment beyond the window', async () => {
    const at = new Date(NOW.getTime() + 40 * 3_600_000);
    deps.appointments.findUpcoming.mockResolvedValueOnce([
      appointmentRow({
        appointmentDate: utcDate(at.toISOString().slice(0, 10)),
        appointmentTime: at.toISOString().slice(11, 16),
      }),
    ]);

    expect(await service.findRemindersDue('24h', NOW)).toEqual([]);
  });

  it('skips an appointment already in the past', async () => {
    const at = new Date(NOW.getTime() - 3_600_000);
    deps.appointments.findUpcoming.mockResolvedValueOnce([
      appointmentRow({
        appointmentDate: utcDate(at.toISOString().slice(0, 10)),
        appointmentTime: at.toISOString().slice(11, 16),
      }),
    ]);

    expect(await service.findRemindersDue('24h', NOW)).toEqual([]);
  });

  it('uses a tighter window for the 2h offset', async () => {
    const at = new Date(NOW.getTime() + 3 * 3_600_000);
    deps.appointments.findUpcoming.mockResolvedValue([
      appointmentRow({
        appointmentDate: utcDate(at.toISOString().slice(0, 10)),
        appointmentTime: at.toISOString().slice(11, 16),
      }),
    ]);

    expect(await service.findRemindersDue('2h', NOW)).toEqual([]);
    expect(await service.findRemindersDue('4h', NOW)).toHaveLength(1);
  });
});
