import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySuperAdminToken } from "@/lib/auth";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("super_admin_session")?.value ?? cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

// GET /api/super-admin/stats — Realtime Tenant and Platform Metrics
export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startTime = Date.now();

  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [users, conversations, tenants, messages24h, recentMessages, recentUsers, broadcasts] = await Promise.all([
      prisma.user.findMany({
        include: {
          profile: true,
          whatsappConfigs: { select: { status: true, phoneNumberId: true, updatedAt: true } },
          contacts: { select: { id: true } },
          tenantsOwned: { select: { id: true, name: true, plan: true, isActive: true, createdAt: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.conversation.findMany({ select: { id: true, status: true, updatedAt: true, tenantId: true } }),
      prisma.tenant.findMany({
        include: {
          owner: { select: { id: true, email: true, profile: { select: { fullName: true, businessName: true } } } },
          whatsappConfig: { select: { status: true, phoneNumberId: true } },
          _count: { select: { contacts: true, conversations: true, broadcasts: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.message.findMany({
        where: { createdAt: { gte: last24h } },
        select: { id: true, senderType: true, status: true, createdAt: true },
      }),
      prisma.message.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          senderType: true,
          status: true,
          contentType: true,
          createdAt: true,
          conversation: {
            select: {
              tenant: { select: { name: true } },
              contact: { select: { name: true, phone: true } },
            },
          },
        },
      }),
      prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          createdAt: true,
          isVerified: true,
          profile: { select: { fullName: true, businessName: true } },
        },
      }),
      prisma.broadcast.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          totalRecipients: true,
          sentCount: true,
          deliveredCount: true,
          createdAt: true,
          tenant: { select: { name: true } },
        },
      }),
    ]);

    const dbLatencyMs = Date.now() - startTime;

    // Monthly signups (last 12 months)
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

    // Tenant counts & status
    const totalTenants = tenants.length;
    const activeTenants = tenants.filter((t) => t.isActive).length;
    const suspendedTenants = totalTenants - activeTenants;

    const totalUsers = users.length;
    const verifiedUsers = users.filter((u) => u.isVerified).length;
    const unverifiedUsers = totalUsers - verifiedUsers;

    // WhatsApp connectivity
    const waConnected = users.filter((u) => u.whatsappConfigs[0]?.status === "connected").length;
    const waDisconnected = totalUsers - waConnected;
    const waConnectionRate = verifiedUsers > 0 ? Math.round((waConnected / verifiedUsers) * 100) : 0;

    const totalContacts = users.reduce((s, u) => s + u.contacts.length, 0);
    const openConversations = conversations.filter((c) => c.status === "open").length;

    // 24h Message Volume
    const messagesLast24h = messages24h.length;
    const inbound24h = messages24h.filter((m) => m.senderType === "customer").length;
    const outbound24h = messages24h.filter((m) => m.senderType !== "customer").length;
    const failed24h = messages24h.filter((m) => m.status === "failed").length;

    // Realtime Tenant Health List (Top Tenants with live stats)
    const liveTenants = tenants.slice(0, 15).map((t) => {
      const isConnected = t.whatsappConfig[0]?.status === "connected";
      return {
        id: t.id,
        name: t.name || t.owner?.profile?.businessName || "Unnamed Tenant",
        ownerEmail: t.owner?.email || "—",
        ownerName: t.owner?.profile?.fullName || "—",
        plan: t.plan,
        isActive: t.isActive,
        waStatus: isConnected ? "connected" : "disconnected",
        phoneNumberId: t.whatsappConfig[0]?.phoneNumberId || null,
        contactsCount: t._count.contacts,
        conversationsCount: t._count.conversations,
        broadcastsCount: t._count.broadcasts,
        createdAt: t.createdAt.toISOString(),
      };
    });

    // Realtime Event Stream (Normalized from recent messages, signups, broadcasts)
    const recentEvents = [
      ...recentUsers.map((u) => ({
        id: `user-${u.id}`,
        type: "signup" as const,
        title: "New Tenant Registration",
        description: `${u.profile?.fullName || u.email} created an account (${u.profile?.businessName || "No business specified"})`,
        timestamp: u.createdAt.toISOString(),
        badge: u.isVerified ? "Verified" : "Pending Approval",
        badgeColor: u.isVerified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
      })),
      ...recentMessages.map((m) => ({
        id: `msg-${m.id}`,
        type: "message" as const,
        title: m.senderType === "customer" ? "Inbound WhatsApp Message" : "Outbound Message Sent",
        description: `${m.conversation.tenant?.name || "Tenant"} ${m.senderType === "customer" ? "received message from" : "sent to"} ${m.conversation.contact?.name || m.conversation.contact?.phone || "Customer"}`,
        timestamp: m.createdAt.toISOString(),
        badge: m.status,
        badgeColor: m.status === "failed" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700",
      })),
      ...broadcasts.map((b) => ({
        id: `broadcast-${b.id}`,
        type: "broadcast" as const,
        title: `Campaign: ${b.name}`,
        description: `${b.tenant?.name || "Tenant"} executed campaign (${b.sentCount}/${b.totalRecipients} delivered)`,
        timestamp: b.createdAt.toISOString(),
        badge: b.status,
        badgeColor: b.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700",
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 15);

    // Operational System Health
    const systemHealth = {
      database: { status: "healthy", latencyMs: dbLatencyMs },
      metaWebhook: { status: process.env.WEBHOOK_VERIFY_TOKEN ? "ready" : "unconfigured" },
      smtp: { status: process.env.EMAIL_USERNAME ? "ready" : "unconfigured" },
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json({
      totalUsers,
      verifiedUsers,
      unverifiedUsers,
      waConnected,
      waDisconnected,
      waConnectionRate,
      totalTenants,
      activeTenants,
      suspendedTenants,
      totalContacts,
      openConversations,
      totalConversations: conversations.length,
      planBreakdown,
      monthlySignups,
      throughput: {
        messagesLast24h,
        inbound24h,
        outbound24h,
        failed24h,
      },
      liveTenants,
      recentEvents,
      systemHealth,
    });
  } catch (err: any) {
    console.error("[SuperAdmin Stats]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
