import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Enterprise WhatsApp Marketing and Automation Platform", description: "Scale WhatsApp marketing across teams and locations with role-based access, audit trails, priority support and custom onboarding.", path: "/enterprise" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
