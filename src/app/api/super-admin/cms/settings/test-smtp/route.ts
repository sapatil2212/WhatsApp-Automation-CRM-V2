import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySuperAdminToken } from "@/lib/auth";
import { createMailTransporter } from "@/lib/email/smtp";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("super_admin_session")?.value ?? cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

// POST /api/super-admin/cms/settings/test-smtp
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { targetEmail, config } = body;

    if (!targetEmail || !targetEmail.includes("@")) {
      return NextResponse.json({ error: "Valid target recipient email is required" }, { status: 400 });
    }

    const { transporter, config: resolvedConfig } = await createMailTransporter(config);

    // Verify SMTP connection
    await transporter.verify();

    // Send test email
    const info = await transporter.sendMail({
      from: `"${resolvedConfig.fromName}" <${resolvedConfig.fromEmail}>`,
      to: targetEmail,
      subject: `[SMTP Test] ChatNexGen Email Verification Successful`,
      text: `Hello,\n\nThis is a test email sent from ChatNexGen Super Admin CMS to confirm that your SMTP configuration is active and working properly.\n\nHost: ${resolvedConfig.host}\nPort: ${resolvedConfig.port}\nTimestamp: ${new Date().toISOString()}\n\nBest regards,\nChatNexGen System Administrator`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #4f46e5; margin-top: 0;">SMTP Test Successful!</h2>
          <p style="color: #334155; font-size: 14px; line-height: 1.6;">
            This email confirms that your outgoing SMTP credentials configured in the <strong>ChatNexGen Super Admin CMS</strong> are verified and operational.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 8px; font-family: monospace; font-size: 12px; color: #475569; margin: 16px 0;">
            <div><strong>Host:</strong> ${resolvedConfig.host}</div>
            <div><strong>Port:</strong> ${resolvedConfig.port}</div>
            <div><strong>Sender:</strong> ${resolvedConfig.fromEmail}</div>
            <div><strong>Time:</strong> ${new Date().toLocaleString()}</div>
          </div>
          <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">
            A product of Brightwave Digital Products LLP.
          </p>
        </div>
      `,
    });

    return NextResponse.json({
      ok: true,
      messageId: info.messageId,
      accepted: info.accepted,
    });
  } catch (err: any) {
    console.error("[Test SMTP Error]", err);
    return NextResponse.json(
      { error: err.message || "Failed to connect to SMTP server or send test email" },
      { status: 500 }
    );
  }
}
