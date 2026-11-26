import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateSuperAdminToken } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const SESSION_TOKEN = "admin_session";

/** Same credentials as /api/super-admin/auth; without them admin login is off (no defaults). */
function adminCredentials(): { user: string; pass: string } | null {
  const user = (process.env.SUPER_ADMIN_USERNAME ?? process.env.ADMIN_EMAIL)?.trim().toLowerCase();
  const pass = (process.env.SUPER_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD)?.trim();
  return user && pass ? { user, pass } : null;
}

const safeEqual = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "anonymous";
  const limit = checkRateLimit(`admin-login:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!limit.success) return rateLimitResponse(limit);

  const creds = adminCredentials();
  if (!creds) return NextResponse.json({ error: "Admin sign-in is not configured on this server." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  // Accept both field names — login form sends `username`, some callers send `email`
  const submittedUser = String(body.username ?? body.email ?? "").trim().toLowerCase();
  const submittedPass = String(body.password ?? "").trim();
  const userOk = safeEqual(submittedUser, creds.user);
  const passOk = safeEqual(submittedPass, creds.pass);
  if (!userOk || !passOk) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  const token = generateSuperAdminToken(submittedUser);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_TOKEN, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
    path: "/",
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_TOKEN);
  return NextResponse.json({ ok: true });
}
