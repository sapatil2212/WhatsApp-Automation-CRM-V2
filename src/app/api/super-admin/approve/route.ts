import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";
import { emailLayout, emailHeading, emailSubtitle, emailText, emailButton, emailDivider, emailTokens } from "@/lib/email/template";

export async function GET(req: NextRequest) {
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

    // Activate User & Start 1-month Subscription
    const subscriptionExpiresAt = new Date();
    subscriptionExpiresAt.setMonth(subscriptionExpiresAt.getMonth() + 1); // 1 month from now

    await prisma.user.update({
      where: { id: userId },
      data: {
        isVerified: true,
        subscriptionExpiresAt,
      },
    });

    // Update Tenant Plan if exists and set isActive to true
    if (user.tenantsOwned.length > 0) {
      const tenant = user.tenantsOwned[0];
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          plan: user.selectedPlan || "starter",
          isActive: true,
        },
      });
    }

    // Send Welcome & Activation Confirmation Email to the user
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const dashboardUrl = `${siteUrl}/dashboard`;
    const fullName = user.profile?.fullName || "Valued Partner";

    const cleanEnv = (val: string | undefined): string => {
      if (!val) return "";
      return val.replace(/^["']|["']$/g, "");
    };

    const smtpHost = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST);
    const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
    const smtpPort = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
    const smtpUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
    const smtpPass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);

    if (smtpHost && smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        const htmlContent = emailLayout({
          title: "Your ChatNexGen account is activated",
          preview: "Your workspace is active and ready to use.",
          contentHtml:
            emailHeading("Account activated 🎉") +
            emailSubtitle(`Welcome to ChatNexGen, ${fullName}!`) +
            emailDivider() +
            emailText(
              "Your payment has been confirmed and your 1-month subscription has started. Your workspace is fully active and ready to use."
            ) +
            emailText(`Subscription active until <strong>${subscriptionExpiresAt.toLocaleDateString()}</strong>.`, {
              size: 12,
              color: emailTokens.muted,
            }) +
            emailButton(dashboardUrl, "Log in to dashboard"),
        });

        await transporter.sendMail({
          from: `"ChatNexGen Support" <${smtpUser}>`,
          to: user.email,
          subject: "🎉 Account Activated! Your ChatNexGen Workspace is Ready",
          text: `Welcome, ${fullName}! Your account has been activated. Subscription valid until ${subscriptionExpiresAt.toLocaleDateString()}. Login here: ${dashboardUrl}`,
          html: htmlContent
        });
        console.log(`[SMTP] Welcome and activation email sent to ${user.email}`);
      } catch (mailErr: any) {
        console.error("[approve] Error sending welcome activation email:", mailErr.message || mailErr);
      }
    } else {
      console.warn("SMTP settings are not configured. Welcome email not sent.");
    }

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
