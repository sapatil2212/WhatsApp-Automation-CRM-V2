import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === 'super_admin_session') {
        return { value: 'valid-super-admin-token' };
      }
      return undefined;
    },
    set: vi.fn(),
  }),
}));

vi.mock('@/lib/auth', () => ({
  verifySuperAdminToken: (token: string) => token === 'valid-super-admin-token',
  generateAccessToken: () => 'mock-access-token',
  generateRefreshToken: () => 'mock-refresh-token',
  setAuthCookies: vi.fn(async () => {}),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }) => {
        if (where.id === 'user-1') {
          return {
            id: 'user-1',
            email: 'tenant@example.com',
            role: 'tenant_admin',
            profile: { fullName: 'Tenant Owner' },
          };
        }
        return null;
      }),
      update: vi.fn(async () => ({})),
    },
  },
}));

describe('POST /api/super-admin/impersonate', () => {
  it('rejects impersonation when userId is missing', async () => {
    const req = new NextRequest('http://localhost/api/super-admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Missing userId');
  });

  it('rejects when user does not exist', async () => {
    const req = new NextRequest('http://localhost/api/super-admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-non-existent' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  it('generates session and returns redirectUrl on success', async () => {
    const req = new NextRequest('http://localhost/api/super-admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.redirectUrl).toBe('/inbox');
    expect(body.user.email).toBe('tenant@example.com');
  });
});
