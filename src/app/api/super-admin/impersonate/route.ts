import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { generateAccessToken, generateRefreshToken, setAuthCookies, verifySuperAdminToken } from "@/lib/auth";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token =
    cookieStore.get("super_admin_session")?.value ??
    cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    let targetUserId = body.userId;

    if (!targetUserId && body.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: body.tenantId },
        select: { ownerUserId: true },
      });
      targetUserId = tenant?.ownerUserId;
    }

    if (!targetUserId) {
      return NextResponse.json({ error: "Missing userId or tenantId parameter" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: { profile: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Save refresh token to RefreshToken table
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Set tenant session cookies
    await setAuthCookies(accessToken, refreshToken);

    return NextResponse.json({
      ok: true,
      redirectUrl: "/inbox",
      user: {
        id: user.id,
        email: user.email,
        fullName: user.profile?.fullName || user.email,
      },
    });
  } catch (err: any) {
    console.error("[SuperAdmin Impersonate POST]", err);
    return NextResponse.json({ error: err.message || "Failed to impersonate user" }, { status: 500 });
  }
}
