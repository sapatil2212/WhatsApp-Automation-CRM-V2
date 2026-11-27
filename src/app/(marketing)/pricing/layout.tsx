import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "WhatsApp Marketing Software Pricing and Plans", description: "Simple ChatNexGen plans for WhatsApp marketing, automation and CRM. Compare features and start with a free trial.", path: "/pricing" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
