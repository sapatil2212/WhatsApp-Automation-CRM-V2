import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const revalidate = 60; // Cache for 60 seconds

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
  attributionText: "ChatNexGen is a product operated by Brightwave Digital Products LLP.",
  copyrightText: "© 2026 Brightwave Digital Products LLP. All rights reserved.",
  footerDescription:
    "ChatNexGen is a WhatsApp Business communication and automation SaaS platform operated by Brightwave Digital Products LLP. We enable businesses to connect their own WhatsApp Business Accounts via Meta Cloud API for customer support, CRM, and consent-based messaging.",
  disclaimerText:
    "ChatNexGen is an independent software application operated by Brightwave Digital Products LLP. ChatNexGen is not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc. or WhatsApp Inc. WhatsApp is a registered trademark of Meta Platforms, Inc. Businesses are strictly required to obtain prior explicit user opt-in before initiating any WhatsApp communications.",
  socialLinks: {
    linkedin: "https://linkedin.com",
    twitter: "https://twitter.com",
    facebook: "https://facebook.com",
    instagram: "https://instagram.com",
  },
};

const DEFAULT_CONTACT = {
  supportEmail: "support@chatnexgen.online",
  salesEmail: "sales@chatnexgen.online",
  phone: "+91 98765 43210",
  address: "Registered Office: India",
  businessHours: "Monday - Saturday, 9:00 AM - 6:00 PM IST",
  helpDeskUrl: "/contact-us",
};

// GET /api/cms/public-settings — Safe public branding, footer & contact info
export async function GET() {
  try {
    const settings = await prisma.cmsSetting.findMany({
      where: {
        key: { in: ["site_branding", "footer_details", "contact_info"] },
      },
    });

    const map: Record<string, any> = {};
    for (const s of settings) {
      map[s.key] = s.value;
    }

    return NextResponse.json({
      site_branding: map.site_branding || DEFAULT_BRANDING,
      footer_details: map.footer_details || DEFAULT_FOOTER,
      contact_info: map.contact_info || DEFAULT_CONTACT,
    });
  } catch (err: any) {
    console.error("[Public Settings GET]", err);
    return NextResponse.json({
      site_branding: DEFAULT_BRANDING,
      footer_details: DEFAULT_FOOTER,
      contact_info: DEFAULT_CONTACT,
    });
  }
}
