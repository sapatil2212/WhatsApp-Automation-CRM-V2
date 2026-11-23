import type { Viewport } from "next";

/**
 * Public booking pages use compact 13px fields on phones. iOS Safari zooms in
 * on focus for inputs under 16px; maximumScale stops that auto-zoom (users can
 * still pinch-zoom on iOS, which ignores this for gestures).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
