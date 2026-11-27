import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Privacy Policy", description: "How ChatNexGen collects, uses and protects your personal and WhatsApp messaging data.", path: "/privacy-policy" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
