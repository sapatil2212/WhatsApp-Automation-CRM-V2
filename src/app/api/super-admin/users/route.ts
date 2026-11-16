import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifySuperAdminToken } from "@/lib/auth";
import nodemailer from "nodemailer";
import { emailLayout, emailHeading, emailSubtitle, emailText, emailButton, emailDivider, emailTokens } from "@/lib/email/template";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("super_admin_session")?.value ?? cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

// ─── GET /api/super-admin/users ─────────────────────────────────────────────
export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const users = await prisma.user.findMany({
      include: {
        profile: true,
        whatsappConfigs: { select: { status: true, phoneNumberId: true } },
        contacts: { select: { id: true } },
        broadcasts: { select: { id: true } },
        automations: { select: { id: true } },
        tenantsOwned: {
          select: { id: true, name: true, plan: true, isActive: true, createdAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const convCounts = await prisma.conversation.groupBy({
      by: ["userId"],
      _count: { id: true },
    });
    const convMap = new Map(convCounts.map((r) => [r.userId, r._count.id]));

    const result = users.map((u) => {
      const tenant = u.tenantsOwned[0] ?? null;
      return {
        id: u.id,
        email: u.email,
        role: u.role,
        isVerified: u.isVerified,
        isEmailVerified: u.isEmailVerified,
        subscriptionExpiresAt: u.subscriptionExpiresAt ? u.subscriptionExpiresAt.toISOString() : null,
        selectedPlan: u.selectedPlan || "starter",
        paymentProofAttached: u.paymentProofAttached,
        paymentProofUrl: u.paymentProofUrl || null,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
        // Profile
        fullName: u.profile?.fullName ?? "",
        businessName: u.profile?.businessName ?? "",
        businessType: u.profile?.businessType ?? "",
        phoneNumber: u.profile?.phoneNumber ?? "",
        avatarUrl: u.profile?.avatarUrl ?? null,
        betaFeatures: (u.profile?.betaFeatures as string[]) ?? [],
        // Tenant / Subscription
        tenantId: tenant?.id ?? null,
        tenantName: tenant?.name ?? null,
        plan: tenant?.plan ?? "free",
        tenantActive: tenant?.isActive ?? true,
        // WhatsApp
        waStatus: u.whatsappConfigs[0]?.status ?? "disconnected",
        waConnected: u.whatsappConfigs[0]?.status === "connected",
        // Stats
        contacts: u.contacts.length,
        broadcasts: u.broadcasts.length,
        automations: u.automations.length,
        conversations: convMap.get(u.id) ?? 0,
      };
    });

    return NextResponse.json({ users: result });
  } catch (err: any) {
    console.error("[SuperAdmin Users GET]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── POST /api/super-admin/users — Create user ───────────────────────────────
export async function POST(req: NextRequest) {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { email, password, fullName, businessName, businessType, plan, role } = await req.json();

    if (!email || !password || !fullName)
      return NextResponse.json({ error: "email, password and fullName are required" }, { status: 400 });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
      return NextResponse.json({ error: "User with this email already exists" }, { status: 400 });

    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: role ?? "tenant_admin",
          isVerified: true, // Super admin creates verified users
        },
      });

      // Create tenant
      const tenantName = businessName || `${fullName}'s Organization`;
      let slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      slug = `${slug}-${user.id.substring(0, 8)}`;

      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug,
          ownerUserId: user.id,
          plan: plan ?? "free",
          settings: {},
        },
      });

      // Create default workspace
      const workspace = await tx.workspace.create({
        data: {
          tenantId: tenant.id,
          name: "Default Workspace",
          slug: "default",
          settings: {},
          isDefault: true,
        },
      });

      // Seed roles
      const rolesToCreate = [
        { name: "owner", description: "Full access", permissions: ["*"], isSystem: true },
        { name: "admin", description: "Admin access", permissions: ["inbox:*", "contacts:*", "broadcasts:*", "automations:*", "settings:*"], isSystem: true },
        { name: "agent", description: "Agent access", permissions: ["inbox:view", "inbox:reply", "contacts:view"], isSystem: true },
      ];
      await tx.role.createMany({
        data: rolesToCreate.map((r) => ({ tenantId: tenant.id, ...r })),
      });

      const ownerRole = await tx.role.findFirstOrThrow({
        where: { tenantId: tenant.id, name: "owner" },
      });

      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, roleId: ownerRole.id, status: "active" },
      });

      // Create profile
      await tx.profile.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          fullName,
          email,
          role: role ?? "tenant_admin",
          businessName: businessName ?? null,
          businessType: businessType ?? null,
          betaFeatures: [],
        } as any,
      });

      // Create tenant configuration
      await tx.tenantConfiguration.create({ data: { tenantId: tenant.id } });

      return { user, tenant };
    });

    return NextResponse.json({ ok: true, userId: result.user.id });
  } catch (err: any) {
    console.error("[SuperAdmin Users POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── PATCH /api/super-admin/users — Update user ──────────────────────────────
export async function PATCH(req: NextRequest) {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, isVerified, plan, role, fullName, businessName, businessType, phoneNumber, betaFeatures, tenantActive } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing user id" }, { status: 400 });

    // Update user fields
    const userUpdateData: Record<string, any> = {};
    let shouldSendWelcomeEmail = false;
    let computedExpiry: Date | null = null;

    if (isVerified !== undefined) {
      userUpdateData.isVerified = isVerified;
      if (isVerified === true) {
        // Fetch current user verification status
        const currUser = await prisma.user.findUnique({
          where: { id },
          include: { profile: true }
        });
        if (currUser && !currUser.isVerified) {
          shouldSendWelcomeEmail = true;
          computedExpiry = new Date();
          computedExpiry.setMonth(computedExpiry.getMonth() + 1); // 1 month
          userUpdateData.subscriptionExpiresAt = computedExpiry;
        }
      }
    }
    if (role !== undefined) userUpdateData.role = role;

    if (Object.keys(userUpdateData).length > 0) {
      await prisma.user.update({ where: { id }, data: userUpdateData });
    }

    // Send welcome activation email if newly verified
    if (shouldSendWelcomeEmail && computedExpiry) {
      const user = await prisma.user.findUnique({
        where: { id },
        include: { profile: true }
      });
      if (user) {
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
                emailSubtitle(`Hi ${fullName}, welcome to ChatNexGen!`) +
                emailDivider() +
                emailText(
                  "Your payment has been verified and your 1-month subscription is now active. Your workspace is ready to use."
                ) +
                emailText(`Subscription active until <strong>${computedExpiry.toLocaleDateString()}</strong>.`, {
                  size: 12,
                  color: emailTokens.muted,
                }) +
                emailButton(dashboardUrl, "Log in to dashboard"),
            });

            await transporter.sendMail({
              from: `"ChatNexGen Support" <${smtpUser}>`,
              to: user.email,
              subject: "🎉 Account Activated! Your ChatNexGen Workspace is Ready",
              text: `Welcome, ${fullName}! Your account has been activated. Subscription valid until ${computedExpiry.toLocaleDateString()}. Login here: ${dashboardUrl}`,
              html: htmlContent
            });
            console.log(`[SMTP PATCH] Welcome and activation email sent to ${user.email}`);
          } catch (mailErr: any) {
            console.error("[SuperAdmin PATCH Approve Email] Error:", mailErr);
          }
        }
      }
    }

    // If access is being revoked, immediately kill all active sessions
    if (isVerified === false) {
      await prisma.refreshToken.deleteMany({ where: { userId: id } });
    }

    // Update profile fields
    const profileUpdateData: Record<string, any> = {};
    if (fullName !== undefined) profileUpdateData.fullName = fullName;
    if (businessName !== undefined) profileUpdateData.businessName = businessName;
    if (businessType !== undefined) profileUpdateData.businessType = businessType;
    if (phoneNumber !== undefined) profileUpdateData.phoneNumber = phoneNumber;
    if (role !== undefined) profileUpdateData.role = role;
    if (betaFeatures !== undefined) profileUpdateData.betaFeatures = betaFeatures;

    if (Object.keys(profileUpdateData).length > 0) {
      await prisma.profile.updateMany({ where: { userId: id }, data: profileUpdateData });
    }

    // Update tenant plan and active status
    if (plan !== undefined || tenantActive !== undefined) {
      const tenantData: Record<string, any> = {};
      if (plan !== undefined) tenantData.plan = plan;
      if (tenantActive !== undefined) tenantData.isActive = tenantActive;
      await prisma.tenant.updateMany({ where: { ownerUserId: id }, data: tenantData });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[SuperAdmin Users PATCH]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── DELETE /api/super-admin/users?id=xxx ────────────────────────────────────
export async function DELETE(req: NextRequest) {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing user id" }, { status: 400 });

  try {
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[SuperAdmin Users DELETE]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
