import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token") || cookieStore.get("admin_session");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const data = await prisma.user.findMany({
      include: {
        profile: true
      }
    });

    const users = data.map((u) => {
      const profile = u.profile;
      return {
        id: u.id,
        email: u.email ?? "",
        full_name: profile?.fullName ?? "",
        avatar_url: profile?.avatarUrl ?? "",
        created_at: u.createdAt.toISOString(),
        last_sign_in_at: u.updatedAt.toISOString(),
        confirmed: u.isVerified,
        provider: "email",
      };
    });

    return NextResponse.json({ users });
  } catch (err: any) {
    console.error('[Admin Users GET] Error:', err);
    return NextResponse.json({ error: err.message || "Failed to fetch users" }, { status: 500 });
  }
}
