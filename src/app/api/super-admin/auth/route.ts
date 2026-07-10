import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const ADMIN_USER = (process.env.SUPER_ADMIN_USERNAME ?? "admin@chatnexgen.com").trim().toLowerCase();
const ADMIN_PASS = (process.env.SUPER_ADMIN_PASSWORD ?? "admin123").trim();
const SESSION_COOKIE = "super_admin_session";

// POST /api/super-admin/auth — Login
export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = (body.email ?? body.username ?? "").trim().toLowerCase();
  const password = (body.password ?? "").trim();

  if (email !== ADMIN_USER || password !== ADMIN_PASS) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
    path: "/",
  });

  return NextResponse.json({ ok: true });
}

// GET /api/super-admin/auth — Check session
export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (session !== "authenticated") {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, email: process.env.SUPER_ADMIN_USERNAME });
}

// DELETE /api/super-admin/auth — Logout
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
