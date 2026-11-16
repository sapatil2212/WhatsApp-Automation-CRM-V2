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
