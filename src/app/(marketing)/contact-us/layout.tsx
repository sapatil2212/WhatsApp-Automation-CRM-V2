import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Contact ChatNexGen: WhatsApp Marketing Support and Sales", description: "Talk to the ChatNexGen team about WhatsApp marketing, automation and CRM. Get help with setup, pricing and the WhatsApp Business API.", path: "/contact-us" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
