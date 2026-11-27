import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "WhatsApp CRM: Manage Leads, Contacts and Pipelines", description: "A WhatsApp CRM that turns chats into customers. Capture leads, tag contacts, track deals in pipelines and automate follow-ups.", path: "/crm" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
