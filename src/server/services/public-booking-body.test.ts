import { describe, expect, it } from 'vitest';

import { publicBookingBodySchema } from './public-booking.service';

const base = { name: 'Test Patient', phone: '', email: '', doctorId: 'fb081764-fb9e-4ee1-a1b7-193b900f832c', date: '2026-11-20', time: '10:00', notes: 'tooth pain', whatsappConsent: false };

describe('publicBookingBodySchema', () => {
  it('accepts a specialisation-based department id (clinics without configured departments)', () => {
    expect(publicBookingBodySchema.safeParse({ ...base, departmentId: 'spec:Dentist' }).success).toBe(true);
  });
  it('accepts a configured department uuid', () => {
    expect(publicBookingBodySchema.safeParse({ ...base, departmentId: '2a969174-0621-45ea-806e-e159d1bd4b0c' }).success).toBe(true);
  });
  it('accepts the full patient form', () => {
    expect(publicBookingBodySchema.safeParse({ ...base, phone: '98765 43210', email: 'a@b.co', age: '32', gender: 'female', whatsappConsent: true }).success).toBe(true);
  });
  it('rejects junk department ids', () => {
    expect(publicBookingBodySchema.safeParse({ ...base, departmentId: 'drop table' }).success).toBe(false);
  });
});
