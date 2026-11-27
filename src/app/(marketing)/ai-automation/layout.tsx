import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Official WhatsApp Marketing | Personalize WhatsApp Campaigns", description: "Automate WhatsApp replies, follow-ups and lead qualification with AI. Personalize every campaign with customer names, orders and appointments on the official WhatsApp Business API.", path: "/ai-automation" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
