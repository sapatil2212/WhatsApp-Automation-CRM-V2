/** Pure helper for the public booking page (no DB access). */

type PublicDepartment = { id: string; name: string; description: string | null; doctorCount: number };

/**
 * Departments shown on the booking page. Every doctor must stay bookable,
 * even one the clinic never assigned to a department (a common gap after an
 * AI/document import):
 *   - an unassigned doctor whose specialisation matches a configured
 *     department's name is listed under that department;
 *   - any other unassigned doctor is grouped under its specialisation
 *     (`spec:<name>`, which the booking API already accepts);
 *   - configured departments with no doctors are left out, so patients never
 *     pick a department that leads nowhere.
 * Mutates `doctors[].departmentIds` for the name matches.
 */
export function bookableDepartments(
  configured: Array<{ id: string; name: string; description: string | null }>,
  doctors: Array<{ departmentIds: string[]; department: string }>,
): PublicDepartment[] {
  const byName = new Map(configured.map((d) => [d.name.trim().toLowerCase(), d.id]));
  for (const doc of doctors) {
    if (doc.departmentIds.length) continue;
    const match = byName.get(doc.department.trim().toLowerCase());
    if (match) doc.departmentIds.push(match);
  }
  const real = configured
    .map((d) => ({ id: d.id, name: d.name, description: d.description, doctorCount: doctors.filter((doc) => doc.departmentIds.includes(d.id)).length }))
    .filter((d) => d.doctorCount > 0);
  const unassigned = doctors.filter((d) => !d.departmentIds.length);
  const groups = [...new Set(unassigned.map((d) => d.department))]
    .sort()
    .map((name) => ({ id: `spec:${name}`, name, description: null, doctorCount: unassigned.filter((d) => d.department === name).length }));
  return [...real, ...groups];
}
