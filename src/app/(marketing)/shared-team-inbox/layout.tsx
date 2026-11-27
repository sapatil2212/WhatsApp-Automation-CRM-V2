import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Shared WhatsApp Team Inbox for Support and Sales", description: "Let your whole team answer customers from one WhatsApp number. Assign chats, add notes, use quick replies and never miss a lead.", path: "/shared-team-inbox" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
