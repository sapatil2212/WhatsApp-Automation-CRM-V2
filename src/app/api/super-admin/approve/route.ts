import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";
import path from "path";

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

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 0; text-align: center; }
            .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 40px 30px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
            .logo-text { font-size: 24px; font-weight: 800; color: #4f46e5; margin-bottom: 25px; letter-spacing: -0.025em; }
            h1 { font-size: 26px; font-weight: 700; color: #059669; margin: 0 0 10px 0; }
            p.subtitle { font-size: 16px; color: #475569; margin: 0 0 30px 0; }
            .divider { height: 1px; background-color: #e2e8f0; margin: 30px 0; }
            p.body-text { font-size: 15px; color: #334155; margin: 0 0 30px 0; line-height: 1.6; }
            .btn { display: inline-block; background-color: #10b981; color: #ffffff !important; text-decoration: none; font-weight: bold; font-size: 14px; padding: 14px 32px; border-radius: 8px; margin-bottom: 30px; }
            .footer { font-size: 12px; color: #64748b; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo-text">ChatNexGen</div>
            <h1>Account Activated! 🎉</h1>
            <p class="subtitle">Welcome to ChatNexGen, ${fullName}!</p>
            <div class="divider"></div>
            <p class="body-text">
              Great news! Your payment has been confirmed, and your 1-month active subscription has started. Your workspace is fully active and ready to use.
            </p>
            <p class="body-text" style="font-size: 13px; color: #ef4444; font-weight: bold;">
              Subscription Active Until: ${subscriptionExpiresAt.toLocaleDateString()}
            </p>
            <a href="${dashboardUrl}" class="btn">Log In to Dashboard</a>
            <div class="divider"></div>
            <p class="footer">
              This is an automated confirmation email from ChatNexGen.<br>
              Need help? Contact support at <a href="mailto:chatnexgen@gmail.com" style="color:#059669;">chatnexgen@gmail.com</a>.
            </p>
          </div>
        </body>
        </html>
        `;

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
