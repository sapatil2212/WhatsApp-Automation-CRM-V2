import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/server/kernel/auth-context';
import { tenantDb } from '@/server/kernel/db';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    if (!ctx?.tenantId) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const db = tenantDb(ctx.tenantId);

    const contacts = await db.contact.findMany({
      include: {
        tags: {
          include: { tag: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const headers = ['Name', 'Phone', 'Email', 'Company', 'Tags', 'Created At'];
    const rows = contacts.map((c) => [
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${(c.phone || '').replace(/"/g, '""')}"`,
      `"${(c.email || '').replace(/"/g, '""')}"`,
      `"${(c.company || '').replace(/"/g, '""')}"`,
      `"${c.tags.map((t) => t.tag.name).join('; ').replace(/"/g, '""')}"`,
      `"${c.createdAt.toISOString()}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err: any) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
}
