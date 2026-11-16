import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { appointmentController } from './appointment.controller';
import { AppointmentService } from '../services/appointment.service';

vi.mock('../kernel/auth-context', () => ({
  getAuthContext: async () => ({
    userId: 'user-123',
    email: 'admin@example.com',
    role: 'tenant_admin',
    tenantId: 'tenant-abc',
    profileId: 'prof-1',
  }),
  requireAuthContext: async () => ({
    userId: 'user-123',
    email: 'admin@example.com',
    role: 'tenant_admin',
    tenantId: 'tenant-abc',
    profileId: 'prof-1',
  }),
  resolveAuthContext: async () => ({
    userId: 'user-123',
    email: 'admin@example.com',
    role: 'tenant_admin',
    tenantId: 'tenant-abc',
    profileId: 'prof-1',
  }),
  requireSuperAdmin: async () => true,
  requireCronSecret: () => true,
}));

vi.mock('../kernel/db', () => ({
  tenantDb: () => ({}),
}));

const mockAppt = {
  id: '00000000-0000-0000-0000-000000000001',
  appointmentDate: '2026-06-01',
  appointmentTime: '10:00',
  status: 'scheduled' as const,
  patientName: 'John Doe',
  patientAge: '30',
  reasonForVisit: 'Routine checkup',
  remindersSent: { '24h': null, '4h': null, '2h': null },
  feedbackSent: false,
  followupSent: false,
  sheetsSynced: false,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  contact: {
    id: '00000000-0000-0000-0000-000000000003',
    phone: '+1234567890',
    name: 'John Doe',
  },
  doctor: {
    id: '00000000-0000-0000-0000-000000000004',
    doctorName: 'Dr. Smith',
    specialization: 'General',
  },
};

describe('appointmentController', () => {
  it('lists appointments with pagination metadata', async () => {
    vi.spyOn(AppointmentService.prototype, 'list').mockResolvedValueOnce({
      items: [mockAppt],
      page: 1,
      pageSize: 25,
      total: 1,
    });

    const req = new NextRequest('http://localhost/api/appointments?page=1');
    const res = await appointmentController.list(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta.pagination?.total).toBe(1);
  });

  it('books an appointment successfully', async () => {
    vi.spyOn(AppointmentService.prototype, 'book').mockResolvedValueOnce(mockAppt);

    const req = new NextRequest('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactId: '00000000-0000-0000-0000-000000000003',
        doctorId: '00000000-0000-0000-0000-000000000004',
        appointmentDate: '2026-06-01',
        appointmentTime: '10:00',
        patientName: 'John Doe',
        patientAge: '30',
        reasonForVisit: 'Routine checkup',
      }),
    });

    const res = await appointmentController.book(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(mockAppt.id);
  });

  it('reschedules an appointment', async () => {
    vi.spyOn(AppointmentService.prototype, 'reschedule').mockResolvedValueOnce({
      ...mockAppt,
      appointmentDate: '2026-06-02',
      appointmentTime: '11:00',
    });

    const req = new NextRequest('http://localhost/api/appointments/00000000-0000-0000-0000-000000000001/reschedule', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appointmentDate: '2026-06-02',
        appointmentTime: '11:00',
      }),
    });

    const res = await appointmentController.reschedule(req, {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.appointmentDate).toBe('2026-06-02');
  });

  it('updates appointment status', async () => {
    vi.spyOn(AppointmentService.prototype, 'setStatus').mockResolvedValueOnce({
      ...mockAppt,
      status: 'completed',
    });

    const req = new NextRequest('http://localhost/api/appointments/00000000-0000-0000-0000-000000000001/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });

    const res = await appointmentController.setStatus(req, {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('completed');
  });
});
