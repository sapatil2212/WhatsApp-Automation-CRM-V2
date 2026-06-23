import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import crypto from "crypto";

// Server-side admin client to bypass RLS and create users
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

interface OtpEntry {
  code: string;
  expires: number;
}

// Development-safe in-memory store that persists across hot reloads in Next.js dev server
const globalStore = globalThis as any;
globalStore.signupOtpStore = globalStore.signupOtpStore || new Map<string, OtpEntry>();
const signupOtpStore: Map<string, OtpEntry> = globalStore.signupOtpStore;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const db = adminClient();

    if (action === "send") {
      // 1. Check if email is already registered in the profiles table
      const { data: profile, error: profileErr } = await db
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (profile) {
        return NextResponse.json({ error: "Email is already registered" }, { status: 400 });
      }

      // 2. Fallback / double-check in auth.users via admin.listUsers
      const { data: usersData, error: listErr } = await db.auth.admin.listUsers();
      if (!listErr && usersData?.users) {
        const matchedUser = usersData.users.find(
          (u) => u.email?.toLowerCase() === email.toLowerCase()
        );
        if (matchedUser) {
          return NextResponse.json({ error: "Email is already registered" }, { status: 400 });
        }
      }

      // 3. Generate 6-digit OTP code
      const code = crypto.randomInt(100000, 999999).toString();

      // 4. Save code in store (10 minutes validity)
      signupOtpStore.set(email, {
        code,
        expires: Date.now() + 10 * 60 * 1000,
      });

      // 5. Prepare SMTP Configuration
      const cleanEnv = (val: string | undefined): string => {
        if (!val) return "";
        return val.replace(/^["']|["']$/g, "");
      };

      const smtpHost = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST);
      const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
      const smtpPort = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
      const smtpUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
      const smtpPass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);
      const smtpFrom = cleanEnv(process.env.SMTP_FROM) || smtpUser || "chatnexgenai@gmail.com";

      // Developer Fallback: Log the verification code to the console
      console.log(`\n--- [SIGNUP OTP] Verification code for ${email} is: ${code} ---\n`);

      if (smtpHost && smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        const formattedFrom = smtpFrom.includes("<") ? smtpFrom : `ChatNexGen <${smtpFrom}>`;
        const mailOptions = {
          from: formattedFrom,
          to: email,
          subject: "Email Verification Code for Registration",
          text: `Your 6-digit verification code is: ${code}. It is valid for 10 minutes.`,
          html: `
            <div style="background-color: #f8fafc; padding: 40px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; min-height: 100%;">
              <div style="max-width: 460px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px 24px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);">
                <div style="margin-bottom: 24px;">
                  <span style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">Chat<span style="color: #10b981;">NexGen</span></span>
                </div>
                
                <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px;">Email Verification</h2>
                
                <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-top: 0; margin-bottom: 24px;">
                  Thank you for registering. Use the verification code below to complete your registration:
                </p>
                
                <div style="font-size: 36px; font-weight: 800; font-family: 'Courier New', Courier, monospace; background-color: #f8fafc; padding: 14px 28px; border-radius: 12px; display: inline-block; letter-spacing: 8px; margin-bottom: 24px; color: #0f172a; border: 1px solid #e2e8f0; text-indent: 8px;">
                  ${code}
                </div>
                
                <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0; border-top: 1px solid #f1f5f9; padding-top: 20px;">
                  This code will expire in 10 minutes.<br>If you did not make this request, you can safely ignore this email.
                </p>
              </div>
            </div>
          `,
        };

        try {
          await transporter.sendMail(mailOptions);
        } catch (mailErr: any) {
          console.error("Failed to send SMTP registration email:", mailErr);
          // In development mode, don't block the user if SMTP fails (since code is printed in terminal)
          if (process.env.NODE_ENV === "development") {
            return NextResponse.json({
              success: true,
              note: "SMTP sending failed, but OTP logged in terminal for development.",
            });
          }
          return NextResponse.json(
            { error: `Failed to send email: ${mailErr.message || mailErr}` },
            { status: 500 }
          );
        }
      } else {
        // If SMTP credentials aren't configured, let development environment succeed using logged OTP
        if (process.env.NODE_ENV !== "development") {
          return NextResponse.json({ error: "SMTP is not configured on the server." }, { status: 500 });
        }
      }

      return NextResponse.json({ success: true });
    }

    if (action === "register") {
      const { code, fullName, password, businessName, businessType } = body;

      if (!code || !fullName || !password || !businessName || !businessType) {
        return NextResponse.json({ error: "Missing required registration parameters" }, { status: 400 });
      }

      // 1. Verify OTP code
      const stored = signupOtpStore.get(email);
      if (!stored) {
        return NextResponse.json(
          { error: "Verification code not found or expired. Please request a new one." },
          { status: 400 }
        );
      }

      if (stored.expires < Date.now()) {
        signupOtpStore.delete(email);
        return NextResponse.json(
          { error: "Verification code expired. Please request a new one." },
          { status: 400 }
        );
      }

      if (stored.code !== code) {
        return NextResponse.json({ error: "Invalid verification code. Please try again." }, { status: 400 });
      }

      // 2. Double-check if email is already registered in the profiles table (prevents race conditions)
      const { data: profileExists } = await db
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (profileExists) {
        signupOtpStore.delete(email);
        return NextResponse.json({ error: "Email is already registered" }, { status: 400 });
      }

      // 3. Create the user using admin client (auto-confirm email!)
      const { data: newUser, error: createErr } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          business_name: businessName,
          business_type: businessType,
        },
      });

      if (createErr) {
        console.error("Supabase user creation failed via Admin SDK:", createErr);
        return NextResponse.json(
          { error: `Registration failed: ${createErr.message}` },
          { status: 500 }
        );
      }

      // 4. Clear the OTP code
      signupOtpStore.delete(email);

      return NextResponse.json({ success: true, user: newUser.user });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("Signup OTP route error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
