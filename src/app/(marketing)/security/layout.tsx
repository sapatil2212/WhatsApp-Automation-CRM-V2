import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Security and Data Protection | ChatNexGen", description: "How ChatNexGen protects your WhatsApp data: encryption, role-based access, tenant isolation and compliance with Meta platform policies.", path: "/security" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
