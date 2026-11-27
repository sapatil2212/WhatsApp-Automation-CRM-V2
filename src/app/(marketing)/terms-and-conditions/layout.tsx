import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Terms and Conditions", description: "The terms that apply when you use the ChatNexGen WhatsApp marketing and CRM platform.", path: "/terms-and-conditions" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
