import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "WhatsApp Marketing Analytics and Campaign Reports", description: "Track delivery, read and reply rates for every WhatsApp campaign. See which messages convert and which team members respond fastest.", path: "/analytics" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
