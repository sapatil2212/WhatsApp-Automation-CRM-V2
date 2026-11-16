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
    attributionText: "A product of Brightwave Digital Products LLP.",
    copyrightText: "© 2026 ChatNexGen Technologies. All rights reserved.",
    footerDescription:
      "ChatNexGen is a premium AI-powered WhatsApp CRM and customer support automation platform. Automate business communication, configure smart chatbots, organize leads, and sync calendar reminders using the official WhatsApp Business API.",
    disclaimerText:
      "ChatNexGen uses WhatsApp Business API solutions in accordance with Meta and WhatsApp Business policies. Businesses are responsible for obtaining user consent before initiating communication.",
    socialLinks: {
      linkedin: "https://linkedin.com",
      twitter: "https://twitter.com",
      facebook: "https://facebook.com",
      instagram: "https://instagram.com",
    },
  },
  contact_info: {
    supportEmail: "chatnexgen@gmail.com",
    salesEmail: "sales@chatnexgen.com",
    phone: "+91 98765 43210",
    address: "Pune, Maharashtra, India",
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
