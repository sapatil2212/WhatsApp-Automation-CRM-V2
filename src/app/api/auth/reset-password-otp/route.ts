import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";
import crypto from "crypto";
import bcrypt from "bcryptjs";

interface OtpEntry {
  code: string;
  expires: number;
}
interface VerifiedEntry {
  verified: boolean;
  expires: number;
}

const globalStore = globalThis as any;
globalStore.otpStore = globalStore.otpStore || new Map<string, OtpEntry>();
globalStore.verifiedStore = globalStore.verifiedStore || new Map<string, VerifiedEntry>();

const otpStore: Map<string, OtpEntry> = globalStore.otpStore;
const verifiedStore: Map<string, VerifiedEntry> = globalStore.verifiedStore;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (action === "send") {
      // Check if user exists first
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });
      if (!user) {
        return NextResponse.json({ error: "User with this email not found." }, { status: 404 });
      }

      // 1. Generate 6-digit OTP code
      const code = crypto.randomInt(100000, 999999).toString();
      
      // 2. Save code in our store with 10-minute validity
      otpStore.set(email, {
        code,
        expires: Date.now() + 10 * 60 * 1000,
      });

      // 3. Prepare SMTP Configuration
      const cleanEnv = (val: string | undefined): string => {
        if (!val) return "";
        return val.replace(/^["']|["']$/g, "");
      };

      const smtpHost = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST);
      const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
      const smtpPort = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
      const smtpUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
      const smtpPass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);

      if (!smtpHost || !smtpUser || !smtpPass) {
        console.warn("SMTP settings are not configured. Falling back to mock console output.");
        console.log(`[SMTP MOCK OTP] Code for ${email} is ${code}`);
        return NextResponse.json({ success: true, mock: true });
      }

      // 4. Send Email via Nodemailer
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: `"ChatNexGen Triage" <${smtpUser}>`,
        to: email,
        subject: "ChatNexGen Password Reset Verification Code",
        text: `Your password reset code is: ${code}. It expires in 10 minutes.`,
        html: `<p>Your password reset code is: <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
      });

      return NextResponse.json({ success: true });
    }

    if (action === "verify") {
      const { code } = body;
      if (!code) {
        return NextResponse.json({ error: "Code is required" }, { status: 400 });
      }

      const stored = otpStore.get(email);
      if (!stored) {
        return NextResponse.json({ error: "No reset session active. Please request a new code." }, { status: 400 });
      }

      if (stored.expires < Date.now()) {
        otpStore.delete(email);
        return NextResponse.json({ error: "Verification code expired. Please request a new one." }, { status: 400 });
      }

      if (stored.code !== code) {
        return NextResponse.json({ error: "Invalid verification code. Please try again." }, { status: 400 });
      }

      // Mark the email as verified for password resets
      otpStore.delete(email);
      verifiedStore.set(email, {
        verified: true,
        expires: Date.now() + 10 * 60 * 1000, // Valid for 10 minutes to reset
      });

      return NextResponse.json({ success: true });
    }

    if (action === "reset") {
      const { password } = body;
      if (!password) {
        return NextResponse.json({ error: "Password is required" }, { status: 400 });
      }

      const verifiedEntry = verifiedStore.get(email);
      if (!verifiedEntry || !verifiedEntry.verified || verifiedEntry.expires < Date.now()) {
        return NextResponse.json({ error: "Session expired. Please verify your email again." }, { status: 400 });
      }

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (!user) {
        return NextResponse.json({ error: "User with this email not found." }, { status: 404 });
      }

      // Hash the new password
      const passwordHash = await bcrypt.hash(password, 10);

      // Reset the password in database
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash }
      });

      // Clear verification record
      verifiedStore.delete(email);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("OTP password reset error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
