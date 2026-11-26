import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/realtime', () => ({ triggerRealtimeEvent: vi.fn() }));

import { deletePatients } from './patient-record.service';

function fakeDb(existing: string[]) {
  const calls: Array<{ model: string; where: unknown }> = [];
  const model = (name: string) => ({ deleteMany: vi.fn(async ({ where }: { where: unknown }) => { calls.push({ model: name, where }); return { count: 1 }; }) });
  const tx = Object.fromEntries(
    ['prescription', 'consultation', 'appointment', 'appointmentNotificationLog', 'patientDocument', 'patientIntake', 'patientFeedback', 'patientProfile'].map((m) => [m, model(m)]),
  );
  const contactDelete = vi.fn();
  const db = {
    clinic: { findFirst: vi.fn(async () => ({ id: 'clinic-1', tenantId: 't1' })) },
    contact: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => existing.includes(id)).map((id) => ({ id }))), deleteMany: contactDelete },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  };
  return { db: db as never, calls, contactDelete };
}

describe('deletePatients', () => {
  it('removes every clinical record for the patients and keeps the contact', async () => {
    const { db, calls, contactDelete } = fakeDb(['p1', 'p2']);
    const res = await deletePatients(db, { tenantId: 't1' }, ['p1', 'p2', 'p1']);
    expect(res).toEqual({ deleted: ['p1', 'p2'], blocked: [] });
    expect(calls.map((c) => c.model)).toEqual(['prescription', 'consultation', 'appointment', 'appointmentNotificationLog', 'patientDocument', 'patientIntake', 'patientFeedback', 'patientProfile']);
    expect(calls.find((c) => c.model === 'appointment')?.where).toEqual({ contactId: { in: ['p1', 'p2'] }, clinicId: 'clinic-1' });
    expect(contactDelete).not.toHaveBeenCalled();
  });

  it('reports ids that are not patients of this clinic and deletes nothing for them', async () => {
    const { db, calls } = fakeDb([]);
    const res = await deletePatients(db, { tenantId: 't1' }, ['x']);
    expect(res).toEqual({ deleted: [], blocked: [{ id: 'x', reason: 'Patient not found.' }] });
    expect(calls).toHaveLength(0);
  });
});