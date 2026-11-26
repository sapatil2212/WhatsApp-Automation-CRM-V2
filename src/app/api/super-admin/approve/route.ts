import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activateAccount } from "@/server/services/account-activation";
import { requireSuperAdmin } from "@/server/kernel/auth-context";

export async function GET(req: NextRequest) {
  // Only a signed-in super admin may activate accounts (this link is emailed to the admin).
  // Without this, anyone who knows a userId could activate an account without paying.
  try {
    await requireSuperAdmin();
  } catch {
    const back = `/api/super-admin/approve${req.nextUrl.search}`;
    return NextResponse.redirect(new URL(`/super-admin/login?next=${encodeURIComponent(back)}`, req.url));
  }

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return new NextResponse("<h1>Error: Missing userId</h1>", {
        headers: { "Content-Type": "text/html" },
        status: 400,
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, tenantsOwned: true },
    });

    if (!user) {
      return new NextResponse("<h1>Error: User not found</h1>", {
        headers: { "Content-Type": "text/html" },
        status: 404,
      });
    }

    if (user.isVerified) {
      return new NextResponse(
        `
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #4f46e5;">Already Activated</h2>
          <p>User account for <strong>${user.email}</strong> is already active and verified.</p>
          <p><a href="/super-admin" style="color: #10b981; text-decoration: none; font-weight: bold;">Go to Super Admin Portal</a></p>
        </div>
        `,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // Activate, start the 1-month subscription and send the welcome email.
    const { subscriptionExpiresAt } = await activateAccount(user.id, { plan: user.selectedPlan, reason: "manual" });

    return new NextResponse(
      `
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <div style="display: inline-block; width: 60px; h-60; background: #d1fae5; border-radius: 50%; padding: 15px; margin-bottom: 20px;">
          <svg style="width: 30px; height: 30px; color: #10b981;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
        </div>
        <h2 style="color: #059669; margin: 0 0 10px 0;">Approval Successful!</h2>
        <p>User <strong>${user.email}</strong> is now verified and active.</p>
        <p>1-Month Subscription Ends: <strong>${subscriptionExpiresAt.toLocaleDateString()}</strong></p>
        <p style="margin-top: 30px;"><a href="/super-admin/users" style="color: #4f46e5; text-decoration: none; font-weight: bold; font-size: 14px;">Return to Super Admin Dashboard</a></p>
      </div>
      `,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (error: any) {
    console.error("[SuperAdmin Approve GET] Error:", error);
    return new NextResponse(`<h1>Internal Server Error</h1><p>${error.message}</p>`, {
      headers: { "Content-Type": "text/html" },
      status: 500,
    });
  }
}
