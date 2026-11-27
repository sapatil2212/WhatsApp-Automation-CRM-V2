import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Book a Free WhatsApp Marketing Software Demo", description: "See ChatNexGen in action. Book a free live demo of WhatsApp campaigns, AI automation and the shared team inbox.", path: "/book-demo" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
