import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { teamController } from './team.controller';

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === 'sb-access-token' || name === 'token') {
        return { value: 'mock-jwt' };
      }
      return undefined;
    },
  }),
}));

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
  tenantDb: () => ({
    profile: {
      findMany: vi.fn(async () => [
        {
          id: 'prof-1',
          userId: 'user-123',
          email: 'admin@example.com',
          fullName: 'Alice Admin',
          avatarUrl: null,
          role: 'tenant_admin',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'prof-2',
          userId: 'user-456',
          email: 'agent@example.com',
          fullName: 'Bob Agent',
          avatarUrl: null,
          role: 'agent',
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
      ]),
      findFirst: vi.fn(async ({ where }) => {
        if (where?.id === 'prof-2') {
          return { id: 'prof-2', userId: 'user-456' };
        }
        if (where?.id === 'prof-1') {
          return { id: 'prof-1', userId: 'user-123' };
        }
        return null;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  }),
  systemDb: {
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({
        id: 'user-new',
        email: data.email,
        profile: {
          id: 'prof-new',
          fullName: data.profile.create.fullName,
          avatarUrl: null,
          role: data.role,
          createdAt: new Date('2026-01-03T00:00:00Z'),
        },
        createdAt: new Date('2026-01-03T00:00:00Z'),
      })),
    },
    profile: {
      update: vi.fn(async ({ data }) => ({
        id: 'prof-existing',
        fullName: data.fullName || 'Existing User',
        avatarUrl: null,
        role: data.role,
        createdAt: new Date('2026-01-03T00:00:00Z'),
      })),
    },
  },
}));

describe('teamController', () => {
  it('lists members for the active tenant', async () => {
    const req = new NextRequest('http://localhost/api/team/members');
    const res = await teamController.list(req);
    const body = await res.json();
    if (!res.ok) console.log('DEBUG RES ERROR:', body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].email).toBe('admin@example.com');
  });

  it('invites a new member to the tenant workspace', async () => {
    const req = new NextRequest('http://localhost/api/team/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newbie@example.com',
        role: 'agent',
        fullName: 'Newbie Agent',
      }),
    });

    const res = await teamController.invite(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('newbie@example.com');
    expect(body.data.role).toBe('agent');
  });

  it('removes a team member', async () => {
    const req = new NextRequest('http://localhost/api/team/members?memberId=prof-2', {
      method: 'DELETE',
    });

    const res = await teamController.remove(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);
  });

  it('prevents removing oneself from workspace', async () => {
    const req = new NextRequest('http://localhost/api/team/members?memberId=prof-1', {
      method: 'DELETE',
    });

    const res = await teamController.remove(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });
});
