import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "WhatsApp Automation Tool to Send Personalized Messages", description: "Send personalized WhatsApp campaigns and broadcasts to thousands of contacts with the official WhatsApp Business API. Segment audiences, schedule sends and track delivery and replies.", path: "/whatsapp-marketing" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
