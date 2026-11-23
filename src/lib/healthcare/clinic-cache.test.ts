import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAllCaches,
  getCachedAppointments,
  getCachedClinicContext,
  invalidateClinicCache,
  invalidateClinicCacheByClinicId,
  invalidateClinicCacheForTenant,
  setCachedAppointments,
  setCachedClinicContext,
} from './clinic-cache';

const ctx = (clinicId: string, tenantId: string) => ({
  clinic: { id: clinicId, tenantId },
  aiSettings: { aiEnabled: true },
  timings: [],
  doctors: [],
  services: [],
  faqs: [],
});

beforeEach(() => {
  clearAllCaches();
  setCachedClinicContext('owner-a', ctx('clinic-a', 'tenant-a'));
  setCachedClinicContext('owner-b', ctx('clinic-b', 'tenant-b'));
  setCachedAppointments('clinic-a', [{ id: 'appt' }]);
  setCachedAppointments('clinic-b', [{ id: 'appt' }]);
});

describe('clinic cache invalidation', () => {
  it('by userId clears the context and that clinic’s appointments', () => {
    invalidateClinicCache('owner-a');
    expect(getCachedClinicContext('owner-a')).toBeNull();
    expect(getCachedAppointments('clinic-a')).toBeNull();
    expect(getCachedClinicContext('owner-b')).not.toBeNull();
  });

  it('by clinicId works whoever made the edit (the entry is keyed by the owner)', () => {
    invalidateClinicCacheByClinicId('clinic-a');
    expect(getCachedClinicContext('owner-a')).toBeNull();
    expect(getCachedAppointments('clinic-a')).toBeNull();
    expect(getCachedClinicContext('owner-b')).not.toBeNull();
    expect(getCachedAppointments('clinic-b')).not.toBeNull();
  });

  it('by tenant clears only that tenant', () => {
    invalidateClinicCacheForTenant('tenant-b');
    expect(getCachedClinicContext('owner-b')).toBeNull();
    expect(getCachedAppointments('clinic-b')).toBeNull();
    expect(getCachedClinicContext('owner-a')).not.toBeNull();
  });
});
