import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySuperAdminToken } from "@/lib/auth";
import { getSmtpConfig } from "@/lib/email/smtp";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("super_admin_session")?.value ?? cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

// Defaults for each setting
const DEFAULT_BRANDING = {
  siteName: "ChatNexGen",
  siteTagline: "AI-Powered WhatsApp CRM & Marketing Automation",
  logoLightUrl: "/images/logo/chatnexgen-logo-light.png",
  logoDarkUrl: "/images/logo/chatnexgen-logo.png",
  faviconUrl: "/favicon.ico",
  primaryColor: "#7c3aed",
};

const DEFAULT_FOOTER = {
  companyName: "Brightwave Digital Products LLP",
  attributionText: "A product of Brightwave Digital Products LLP.",
  copyrightText: "© 2026 ChatNexGen Technologies. All rights reserved.",
  footerDescription:
    "ChatNexGen is a premium AI-powered WhatsApp CRM and customer support automation platform. Automate business communication, configure smart chatbots, organize leads, and sync calendar reminders using the official WhatsApp Business API.",
  disclaimerText:
    "\"ChatNexGen uses WhatsApp Business API solutions in accordance with Meta and WhatsApp Business policies. Businesses are responsible for obtaining user consent before initiating communication.\"",
  socialLinks: {
    linkedin: "https://linkedin.com",
    twitter: "https://twitter.com",
    facebook: "https://facebook.com",
    instagram: "https://instagram.com",
  },
};

const DEFAULT_CONTACT = {
  supportEmail: "chatnexgen@gmail.com",
  salesEmail: "sales@chatnexgen.com",
  phone: "+91 98765 43210",
  address: "Pune, Maharashtra, India",
  businessHours: "Monday - Saturday, 9:00 AM - 6:00 PM IST",
  helpDeskUrl: "/contact-us",
};

// GET /api/super-admin/cms/settings — Retrieve all CMS settings
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await prisma.cmsSetting.findMany();
    const map: Record<string, any> = {};
    for (const s of settings) {
      map[s.key] = s.value;
    }

    const smtpConfig = await getSmtpConfig();

    return NextResponse.json({
      site_branding: map.site_branding || DEFAULT_BRANDING,
      footer_details: map.footer_details || DEFAULT_FOOTER,
      contact_info: map.contact_info || DEFAULT_CONTACT,
      smtp_config: map.smtp_config || smtpConfig,
    });
  } catch (err: any) {
    console.error("[CMS Settings GET]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/super-admin/cms/settings — Update CMS settings
export async function PUT(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const allowedKeys = ["site_branding", "footer_details", "contact_info", "smtp_config"];

    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        await prisma.cmsSetting.upsert({
          where: { key },
          create: {
            key,
            value: body[key],
          },
          update: {
            value: body[key],
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[CMS Settings PUT]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
