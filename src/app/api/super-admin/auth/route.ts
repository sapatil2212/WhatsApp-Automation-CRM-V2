import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateSuperAdminToken, verifySuperAdminToken } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const SESSION_COOKIE = "super_admin_session";

/** Credentials come only from the environment; without them admin login is off. */
function adminCredentials(): { user: string; pass: string } | null {
  const user = process.env.SUPER_ADMIN_USERNAME?.trim().toLowerCase();
  const pass = process.env.SUPER_ADMIN_PASSWORD?.trim();
  return user && pass ? { user, pass } : null;
}

/** Constant-time string comparison (hashing first makes the lengths equal). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

// POST /api/super-admin/auth — Login
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "anonymous";
  const limit = checkRateLimit(`super-admin-login:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!limit.success) {
    return rateLimitResponse(limit);
  }

  const creds = adminCredentials();
  if (!creds) {
    return NextResponse.json({ error: "Admin sign-in is not configured on this server." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "").trim();

  // Evaluate both so a wrong email and a wrong password take the same time.
  const userOk = safeEqual(email, creds.user);
  const passOk = safeEqual(password, creds.pass);
  if (!userOk || !passOk) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
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
