/** Pure helper for the public booking page (no DB access). */

type PublicDepartment = { id: string; name: string; description: string | null; doctorCount: number };

/**
 * Departments shown on the booking page, exactly as configured in Business
 * Setup; nothing is invented and no doctor is placed automatically.
 *
 *   - No departments configured → group doctors by specialisation
 *     (`spec:<name>`, which the booking API already accepts).
 *   - Departments configured → show those that have doctors assigned. Only
 *     the assigned doctors are listed under them; a doctor without a
 *     department is not bookable until assigned (Setup warns about this).
 *   - Departments exist but none has doctors → return [] so the page lists
 *     all doctors without a department step.
 */
export function bookableDepartments(
  configured: Array<{ id: string; name: string; description: string | null }>,
  doctors: Array<{ departmentIds: string[]; department: string }>,
): PublicDepartment[] {
  if (configured.length === 0) {
    return [...new Set(doctors.map((d) => d.department))]
      .sort()
      .map((name) => ({ id: `spec:${name}`, name, description: null, doctorCount: doctors.filter((d) => d.department === name).length }));
  }
  const count = (id: string) => doctors.filter((doc) => doc.departmentIds.includes(id)).length;
  return configured
    .map((d) => ({ id: d.id, name: d.name, description: d.description, doctorCount: count(d.id) }))
    .filter((d) => d.doctorCount > 0);
}