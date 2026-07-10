import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get("super_admin_session")?.value === "authenticated";
}

// GET /api/super-admin/stats
export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [users, conversations, tenants] = await Promise.all([
      prisma.user.findMany({
        include: {
          whatsappConfigs: { select: { status: true } },
          contacts: { select: { id: true } },
          tenantsOwned: { select: { plan: true, isActive: true } },
        },
      }),
      prisma.conversation.findMany({ select: { id: true, status: true } }),
      prisma.tenant.findMany({ select: { plan: true, isActive: true } }),
    ]);

    // Monthly signups (last 12 months)
    const now = new Date();
    const monthlySignups: { month: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const count = users.filter((u) => {
        const cd = new Date(u.createdAt);
        return cd.getFullYear() === d.getFullYear() && cd.getMonth() === d.getMonth();
      }).length;
      monthlySignups.push({
        month: d.toLocaleString("en-US", { month: "short" }),
        count,
      });
    }

    // Plan breakdown
    const planBreakdown: Record<string, number> = { free: 0, starter: 0, pro: 0, enterprise: 0 };
    for (const t of tenants) {
      const p = t.plan as string;
      planBreakdown[p] = (planBreakdown[p] ?? 0) + 1;
    }

    const totalUsers = users.length;
    const verifiedUsers = users.filter((u) => u.isVerified).length;
    const waConnected = users.filter((u) => u.whatsappConfigs[0]?.status === "connected").length;
    const totalContacts = users.reduce((s, u) => s + u.contacts.length, 0);
    const openConversations = conversations.filter((c) => c.status === "open").length;

    return NextResponse.json({
      totalUsers,
      verifiedUsers,
      waConnected,
      totalContacts,
      openConversations,
      totalConversations: conversations.length,
      planBreakdown,
      monthlySignups,
    });
  } catch (err: any) {
    console.error("[SuperAdmin Stats]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
