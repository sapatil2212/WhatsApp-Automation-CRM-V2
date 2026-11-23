import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

/**
 * POST /api/auth/payment-proof — signup step 3: the new user says they paid.
 *
 * Called before the user can log in (accounts are approved manually), so it
 * cannot require a session. To stop it being used to flag arbitrary accounts
 * it only accepts accounts that are still awaiting approval and were created
 * in the last 7 days, and it is rate limited. Renewals go through WhatsApp
 * from the login and Subscription pages instead.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "anonymous";
    const limit = checkRateLimit(`payment-proof:${ip}`, { limit: 10, windowMs: 60_000 });
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await req.json().catch(() => ({}));
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isVerified: true, createdAt: true } });
    const recent = user && Date.now() - user.createdAt.getTime() < 7 * 24 * 60 * 60 * 1000;
    if (!user || user.isVerified || !recent) {
      // Same response for every rejection so ids cannot be probed.
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    await prisma.user.update({ where: { id: userId }, data: { paymentProofAttached: true } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[payment-proof POST]", err);
    return NextResponse.json({ error: "Could not save payment status" }, { status: 500 });
  }
}
