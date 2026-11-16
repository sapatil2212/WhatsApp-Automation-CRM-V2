"use client";

import { useState, useEffect } from "react";

export interface PublicSettings {
  site_branding: {
    siteName: string;
    siteTagline: string;
    logoLightUrl: string;
    logoDarkUrl: string;
    faviconUrl: string;
    primaryColor: string;
  };
  footer_details: {
    companyName: string;
    attributionText: string;
    copyrightText: string;
    footerDescription: string;
    disclaimerText: string;
    socialLinks: {
      linkedin?: string;
      twitter?: string;
      facebook?: string;
      instagram?: string;
    };
  };
  contact_info: {
    supportEmail: string;
    salesEmail: string;
    phone: string;
    address: string;
    businessHours: string;
    helpDeskUrl: string;
  };
}

const DEFAULT_SETTINGS: PublicSettings = {
  site_branding: {
    siteName: "ChatNexGen",
    siteTagline: "AI-Powered WhatsApp CRM & Marketing Automation",
    logoLightUrl: "/images/logo/chatnexgen-logo-light.png",
    logoDarkUrl: "/images/logo/chatnexgen-logo.png",
    faviconUrl: "/favicon.ico",
    primaryColor: "#7c3aed",
  },
  footer_details: {
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
  },
  contact_info: {
    supportEmail: "support@chatnexgen.online",
    salesEmail: "sales@chatnexgen.online",
    phone: "+91 98765 43210",
    address: "Registered Office: India",
    businessHours: "Monday - Saturday, 9:00 AM - 6:00 PM IST",
    helpDeskUrl: "/contact-us",
  },
};

export function usePublicSettings() {
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/cms/public-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.site_branding && data.footer_details && data.contact_info) {
          setSettings(data);
        }
      })
      .catch((err) => console.error("Error loading public settings:", err))
      .finally(() => setLoading(false));
  }, []);

  return { settings, loading };
}
