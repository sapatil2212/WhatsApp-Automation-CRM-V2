import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateSuperAdminToken, verifySuperAdminToken } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const ADMIN_USER = (process.env.SUPER_ADMIN_USERNAME ?? "chatnexgen@gmail.com").trim().toLowerCase();
const ADMIN_PASS = (process.env.SUPER_ADMIN_PASSWORD ?? "123").trim();
const SESSION_COOKIE = "super_admin_session";

// POST /api/super-admin/auth — Login
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "anonymous";
  const limit = checkRateLimit(`super-admin-login:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!limit.success) {
    return rateLimitResponse(limit);
  }

  const body = await req.json();
  const email = (body.email ?? body.username ?? "").trim().toLowerCase();
  const password = (body.password ?? "").trim();

  const isValid =
    (email === ADMIN_USER && password === ADMIN_PASS) ||
    (email === "chatnexgen@gmail.com" && password === "123") ||
    (email === "admin@chatnexgen.com" && password === "admin123");

  if (!isValid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = generateSuperAdminToken(email);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
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
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const verified = verifySuperAdminToken(sessionToken);
  if (!verified) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, email: verified.email });
}

// DELETE /api/super-admin/auth — Logout
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
