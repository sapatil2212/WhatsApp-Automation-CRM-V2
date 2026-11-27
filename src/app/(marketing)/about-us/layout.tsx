import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "About ChatNexGen: WhatsApp Marketing and CRM Platform", description: "Learn about ChatNexGen, the Pune-based team building AI-powered WhatsApp marketing, automation and CRM software for growing businesses.", path: "/about-us" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
