import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ 1: 1 }]),
  },
}));

describe('GET /api/health', () => {
  it('returns healthy status when database is reachable', async () => {
    process.env.JWT_SECRET = 'test_secret_for_health_check';
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.checks.database.status).toBe('healthy');
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.checks.system).toHaveProperty('uptimeSeconds');
  });
});
