import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "WhatsApp Marketing Blog: Guides, Tips and Updates", description: "Guides on WhatsApp marketing, automation, templates and CRM from the ChatNexGen team.", path: "/blog" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
