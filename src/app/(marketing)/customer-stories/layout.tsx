import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Customer Stories: Businesses Growing with WhatsApp", description: "See how clinics, gyms, retailers and service businesses grow with ChatNexGen WhatsApp marketing and automation.", path: "/customer-stories" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
