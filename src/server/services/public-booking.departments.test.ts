import { describe, expect, it } from 'vitest';

import { bookableDepartments } from './public-booking-departments';

const doc = (department: string, departmentIds: string[] = []) => ({ department, departmentIds: [...departmentIds] });

describe('bookableDepartments', () => {
  it('one department assigned to one doctor lists only that doctor (production case)', () => {
    const doctors = [doc('Orthodontics', ['opd']), doc('Prosthodontics'), doc('Dentist')];
    const list = bookableDepartments([{ id: 'opd', name: 'OPD', description: null }], doctors);
    expect(list).toEqual([{ id: 'opd', name: 'OPD', description: null, doctorCount: 1 }]);
    expect(doctors.filter((d) => d.departmentIds.includes('opd'))).toHaveLength(1);
  });

  it('never invents departments or places unassigned doctors', () => {
    const doctors = [doc('Cardiology', ['a']), doc('ENT', ['b']), doc('ENT'), doc('Dermatology')];
    const list = bookableDepartments([{ id: 'a', name: 'Cardiology', description: null }, { id: 'b', name: 'ENT', description: null }], doctors);
    expect(list.map((d) => `${d.id}:${d.doctorCount}`)).toEqual(['a:1', 'b:1']);
  });

  it('lists a doctor under every department they are assigned to', () => {
    const list = bookableDepartments([{ id: 'a', name: 'OPD', description: null }, { id: 'b', name: 'Surgery', description: null }], [doc('General', ['a', 'b'])]);
    expect(list.map((d) => d.doctorCount)).toEqual([1, 1]);
  });

  it('hides configured departments that have no doctors', () => {
    const list = bookableDepartments(
      [{ id: 'a', name: 'Cardiology', description: null }, { id: 'b', name: 'Empty', description: null }, { id: 'c', name: 'ENT', description: null }],
      [doc('Cardiology', ['a']), doc('ENT', ['c'])],
    );
    expect(list.map((d) => d.id)).toEqual(['a', 'c']);
  });

  it('returns no departments (all doctors listed) when no configured department has doctors', () => {
    expect(bookableDepartments([{ id: 'opd', name: 'OPD', description: null }], [doc('Dentist'), doc('Orthodontics')])).toEqual([]);
  });

  it('groups by specialisation only when the clinic has no departments at all', () => {
    const list = bookableDepartments([], [doc('Dentist'), doc('Orthodontics'), doc('Dentist')]);
    expect(list.map((d) => `${d.id}:${d.doctorCount}`)).toEqual(['spec:Dentist:2', 'spec:Orthodontics:1']);
  });
});