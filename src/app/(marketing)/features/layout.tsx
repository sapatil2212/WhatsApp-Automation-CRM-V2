import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "WhatsApp Marketing Features: Campaigns, Automation, CRM", description: "Explore ChatNexGen features: WhatsApp campaigns, AI auto-replies, drip sequences, templates, CRM pipelines, team inbox and analytics on the official WhatsApp Business API.", path: "/features" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
