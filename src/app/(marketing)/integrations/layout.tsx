import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "WhatsApp Integrations: Connect Your Tools and APIs", description: "Connect ChatNexGen with the WhatsApp Business API, webhooks, payment gateways and your existing business tools.", path: "/integrations" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
