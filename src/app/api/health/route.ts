import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const startTime = Date.now();

  let dbStatus = 'down';
  let dbLatencyMs = -1;

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = 'healthy';
  } catch (err: any) {
    dbStatus = 'unreachable';
  }

  const isDbHealthy = dbStatus === 'healthy';
  const hasJwtSecret = Boolean(process.env.JWT_SECRET);
  const hasSuperAdminSecret = Boolean(process.env.SUPER_ADMIN_SECRET);

  const isOverallHealthy = isDbHealthy && hasJwtSecret;

  const payload = {
    status: isOverallHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    version: process.env.npm_package_version || '0.2.0',
    environment: process.env.NODE_ENV || 'development',
    checks: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      secrets: {
        jwt: hasJwtSecret ? 'configured' : 'missing',
        superAdmin: hasSuperAdminSecret ? 'configured' : 'missing',
      },
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    },
  };

  return NextResponse.json(payload, {
    status: isOverallHealthy ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}
