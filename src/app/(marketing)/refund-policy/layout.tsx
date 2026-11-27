import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Refund Policy", description: "ChatNexGen subscription cancellation and refund policy.", path: "/refund-policy" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
