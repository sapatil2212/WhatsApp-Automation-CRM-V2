import type { Metadata } from "next";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://chatnexgen.online").replace(/\/$/, "");
export const SITE_NAME = "ChatNexGen";
export const DEFAULT_TITLE = "#1 WhatsApp Marketing Software | WhatsApp Automation Tool to Send Personalized Messages";
export const DEFAULT_DESCRIPTION =
  "ChatNexGen is the #1 WhatsApp marketing software for businesses. Use the official WhatsApp Business API to send personalized campaigns, automate replies with AI, manage leads in a WhatsApp CRM and share one team inbox.";
/** 1200x630 JPG made from public/images/banner-image.png (the original is 1.7 MB, too big for WhatsApp link previews). */
export const OG_IMAGE = { url: `${SITE_URL}/images/banner-og.jpg`, width: 1200, height: 630, alt: "ChatNexGen WhatsApp marketing, automation and CRM platform" };
export const KEYWORDS = [
  "WhatsApp marketing software", "WhatsApp automation tool", "WhatsApp CRM", "WhatsApp Business API",
  "official WhatsApp marketing", "WhatsApp campaigns", "personalized WhatsApp messages", "WhatsApp bulk message sender",
  "WhatsApp chatbot", "AI WhatsApp automation", "shared team inbox", "WhatsApp broadcast software", "WhatsApp CRM India",
];

/** Per-page metadata with canonical URL, Open Graph and Twitter cards (all using the shared banner). */
export function pageMeta({ title, description, path, noindex }: { title: string; description: string; path: string; noindex?: boolean }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: SITE_NAME, type: "website", locale: "en_US", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  };
}