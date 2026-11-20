import { describe, expect, it } from 'vitest';

import { applyWhereGuard, ownerFilter } from './db';
import { TENANT_SCOPES } from './tenant-scope';

describe('tenant scope chains', () => {
  it('every parent-scoped model resolves to a tenantId column through its parents', () => {
    for (const [model, scope] of Object.entries(TENANT_SCOPES)) {
      if (scope.kind !== 'parent') continue;
      const filter = ownerFilter(scope.parentModel, 't1');
      // Walk the nested object down to the tenantId leaf.
      let node: Record<string, unknown> = filter;
      let depth = 0;
      while (!('tenantId' in node)) {
        const keys = Object.keys(node);
        expect(keys, `${model}: ${JSON.stringify(filter)}`).toHaveLength(1);
        node = node[keys[0]] as Record<string, unknown>;
        depth += 1;
        expect(depth).toBeLessThan(5);
      }
      expect(node.tenantId).toBe('t1');
    }
  });

  it('guards grandchildren through the full chain (Doctor has no tenantId)', async () => {
    const where = await applyWhereGuard({ tenantId: 't1', scope: TENANT_SCOPES.DoctorDetail, where: { doctorId: 'd1' }, resolveOwnedIds: async () => [] });
    expect(where).toEqual({ doctorId: 'd1', doctor: { clinic: { tenantId: 't1' } } });
    const appt = await applyWhereGuard({ tenantId: 't1', scope: TENANT_SCOPES.AppointmentDetail, where: {}, resolveOwnedIds: async () => [] });
    expect(appt).toEqual({ appointment: { clinic: { tenantId: 't1' } } });
  });

  it('a caller cannot widen the scope through the relation filter', async () => {
    const where = await applyWhereGuard({ tenantId: 't1', scope: TENANT_SCOPES.DoctorDetail, where: { doctor: { clinic: { tenantId: 'evil' } } }, resolveOwnedIds: async () => [] });
    expect(where).toEqual({ doctor: { clinic: { tenantId: 't1' } } });
  });

  it('one-level parents are unchanged', async () => {
    const where = await applyWhereGuard({ tenantId: 't1', scope: TENANT_SCOPES.Message, where: {}, resolveOwnedIds: async () => [] });
    expect(where).toEqual({ conversation: { tenantId: 't1' } });
  });
});
