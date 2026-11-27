import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "Data Deletion Request", description: "How to request deletion of your data from ChatNexGen.", path: "/data-deletion" });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
