import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "WhatsApp API Documentation for Developers", description: "Developer docs for the ChatNexGen API: send WhatsApp messages, manage contacts and receive webhooks.", path: "/api-docs" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
