import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Super Admin — ChatNexGen",
  description: "Super Admin Portal for ChatNexGen",
  robots: { index: false, follow: false },
};

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
