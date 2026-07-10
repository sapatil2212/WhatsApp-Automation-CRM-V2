import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get("admin_session")?.value === "authenticated";
}

// GET /api/admin/clients
export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [users, clinics, conversations] = await Promise.all([
      prisma.user.findMany({
        include: {
          profile: true,
          whatsappConfigs: true,
          contacts: { select: { id: true } },
          broadcasts: { select: { id: true } },
          automations: { select: { id: true } }
        }
      }),
      prisma.clinic.findMany(),
      prisma.conversation.findMany({
        select: { userId: true, status: true }
      })
    ]);

    const clinicMap = new Map(clinics.map(c => [c.userId, c]));
    const convsMap = new Map<string, Array<{ status: string }>>();
    for (const conv of conversations) {
      if (!convsMap.has(conv.userId)) {
        convsMap.set(conv.userId, []);
      }
      convsMap.get(conv.userId)!.push(conv);
    }

    const clients = users.map(u => {
      const profile = u.profile;
      const wa = u.whatsappConfigs[0] || null;
      const clinic = clinicMap.get(u.id) || null;
      const userConvs = convsMap.get(u.id) || [];

      const contactCount = u.contacts.length;
      const convCount = userConvs.length;
      const openConvCount = userConvs.filter(c => c.status === "open").length;
      const broadcastCount = u.broadcasts.length;
      const autoCount = u.automations.length;

      return {
        id:              u.id,
        name:            profile?.fullName ?? "",
        email:           u.email ?? profile?.email ?? "",
        avatar_url:      profile?.avatarUrl ?? null,
        role:            profile?.role ?? "user",
        // Account status
        is_active:       true,
        is_banned:       false,
        banned_until:    null,
        confirmed:       u.isVerified,
        provider:        "email",
        // Timestamps
        joined_at:       u.createdAt.toISOString(),
        last_sign_in:    u.updatedAt.toISOString(),
        // WhatsApp
        wa_connected:    wa?.status === "connected",
        wa_status:       wa?.status ?? "disconnected",
        wa_phone_id:     wa?.phoneNumberId ?? null,
        wa_waba_id:      wa?.wabaId ?? null,
        wa_connected_at: wa?.connectedAt ? wa.connectedAt.toISOString() : null,
        // Healthcare
        clinic_name:     clinic?.clinicName ?? null,
        clinic_type:     clinic?.clinicType ?? null,
        clinic_city:     clinic?.city ?? null,
        clinic_phone:    clinic?.phone ?? null,
        // Stats
        contacts:        contactCount,
        conversations:   convCount,
        open_conversations: openConvCount,
        broadcasts:      broadcastCount,
        automations:     autoCount,
      };
    });

    return NextResponse.json({ clients });
  } catch (err: any) {
    console.error('[Admin Clients GET] Error:', err);
    return NextResponse.json({ error: err.message || "Failed to fetch clients" }, { status: 500 });
  }
}

// PATCH /api/admin/clients — activate or deactivate a user
export async function PATCH(req: NextRequest) {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, action } = await req.json() as { id: string; action: "activate" | "deactivate" };
  if (!id || !action)
    return NextResponse.json({ error: "Missing id or action" }, { status: 400 });

  try {
    // We toggle isVerified to activate/deactivate
    await prisma.user.update({
      where: { id },
      data: { isVerified: action === "activate" }
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Admin Clients PATCH] Error:', err);
    return NextResponse.json({ error: err.message || "Failed to patch client" }, { status: 500 });
  }
}

// DELETE /api/admin/clients?id=xxx
export async function DELETE(req: NextRequest) {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    await prisma.user.delete({
      where: { id }
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Admin Clients DELETE] Error:', err);
    return NextResponse.json({ error: err.message || "Failed to delete client" }, { status: 500 });
  }
}
