import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Careers at ChatNexGen", description: "Join the team building AI-powered WhatsApp marketing and CRM software.", path: "/careers" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
