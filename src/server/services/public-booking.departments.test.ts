import { describe, expect, it } from 'vitest';

import { bookableDepartments } from './public-booking-departments';

const doc = (department: string, departmentIds: string[] = []) => ({ department, departmentIds: [...departmentIds] });

describe('bookableDepartments', () => {
  it('keeps unassigned doctors bookable when the only department has no doctors (production case)', () => {
    const doctors = [doc('Orthodontics'), doc('Prosthodontics'), doc('Dentist')];
    const list = bookableDepartments([{ id: 'opd', name: 'OPD', description: null }], doctors);
    expect(list.map((d) => d.id)).toEqual(['spec:Dentist', 'spec:Orthodontics', 'spec:Prosthodontics']);
    expect(list.every((d) => d.doctorCount === 1)).toBe(true);
  });

  it('puts an unassigned doctor under the configured department with the same name', () => {
    const doctors = [doc('Dentist'), doc('Dentist', ['dent'])];
    const list = bookableDepartments([{ id: 'dent', name: 'dentist', description: 'Teeth' }], doctors);
    expect(list).toEqual([{ id: 'dent', name: 'dentist', description: 'Teeth', doctorCount: 2 }]);
    expect(doctors[0].departmentIds).toEqual(['dent']);
  });

  it('lists configured departments with doctors and groups the rest', () => {
    const list = bookableDepartments(
      [{ id: 'a', name: 'Cardiology', description: null }, { id: 'b', name: 'Empty', description: null }],
      [doc('Cardiology', ['a']), doc('General')],
    );
    expect(list.map((d) => `${d.id}:${d.doctorCount}`)).toEqual(['a:1', 'spec:General:1']);
  });

  it('returns nothing when there are no doctors', () => {
    expect(bookableDepartments([{ id: 'a', name: 'OPD', description: null }], [])).toEqual([]);
  });
});
