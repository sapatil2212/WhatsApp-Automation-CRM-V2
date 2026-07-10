import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get("admin_session")?.value === "authenticated";
}

export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [users, conversations] = await Promise.all([
      prisma.user.findMany({
        include: {
          whatsappConfigs: true,
          contacts: { select: { id: true } }
        }
      }),
      prisma.conversation.findMany({
        select: { id: true, status: true }
      })
    ]);

    const now = new Date();
    const monthlySignups: { month: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const monthIndex = d.getMonth();
      const count = users.filter(u => {
        const cDate = new Date(u.createdAt);
        return cDate.getFullYear() === year && cDate.getMonth() === monthIndex;
      }).length;
      monthlySignups.push({ month: d.toLocaleString("en-US", { month: "short" }), count });
    }

    if (users.length === 0) {
      return NextResponse.json({
        totalUsers: 0, activeUsers: 0, confirmedUsers: 0,
        totalContacts: 0, totalConversations: 0, openConversations: 0,
        monthlySignups,
      });
    }

    const totalContacts = users.reduce((sum, u) => sum + u.contacts.length, 0);
    const totalConversations = conversations.length;
    const openConversations = conversations.filter(c => c.status === "open").length;
    const activeUsers = users.filter(u => u.whatsappConfigs[0]?.status === "connected").length;
    const confirmedUsers = users.filter(u => u.isVerified).length;

    return NextResponse.json({
      totalUsers:         users.length,
      activeUsers,
      confirmedUsers,
      totalContacts,
      totalConversations,
      openConversations,
      monthlySignups,
    });
  } catch (err: any) {
    console.error('[Admin Stats GET] Error:', err);
    return NextResponse.json({ error: err.message || "Failed to fetch stats" }, { status: 500 });
  }
}
