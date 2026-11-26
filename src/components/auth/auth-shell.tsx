"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useMarketingTheme } from "@/components/marketing/marketing-theme-provider";

interface AuthShellProps {
  variant: "login" | "signup";
  children: ReactNode;
  topRight?: ReactNode;
  maxWidth?: "narrow" | "wide";
  className?: string;
}

const TRUST_POINTS = ["Official WhatsApp Business API", "0% markup on Meta fees", "Live in under 30 minutes"];

/**
 * Simple two-column auth layout: a static brand panel on the left (hidden below
 * `lg`) and the form on the right. No animation, no blur layers.
 */
export function AuthShell({ children, topRight, maxWidth = "narrow", className }: AuthShellProps) {
  const { resolvedTheme } = useMarketingTheme();
  const logo =
    resolvedTheme === "light" ? "/images/logo/chatnexgen-logo-light.png" : "/images/logo/chatnexgen-logo.png";

  return (
    <div className="flex min-h-screen w-full bg-[var(--m-bg-primary)]">
      {/* Left: brand panel */}
      <aside className="hidden lg:flex w-[44%] shrink-0 flex-col justify-between bg-[var(--m-bg-secondary)] px-10 py-8">
        <Link href="/" aria-label="ChatNexGen home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="ChatNexGen" className="h-9 w-auto object-contain" />
        </Link>

        <div className="space-y-6">
          {/* Same visual as the home-page hero. */}
          <Image
            src="/images/hero-images/hero-01.png"
            alt="Customer receiving WhatsApp cart and payment reminders from a business"
            width={1264}
            height={844}
            priority
            sizes="40vw"
            className="h-auto w-full select-none drop-shadow-[0_20px_40px_rgba(0,0,0,0.12)]"
          />
        </div>

        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--m-text-tertiary)]">
          {TRUST_POINTS.map((point) => (
            <li key={point} className="flex items-center gap-1.5">
              <span className="text-emerald-500">✓</span> {point}
            </li>
          ))}
        </ul>
      </aside>

      {/* Right: form */}
      <section className="flex min-h-screen w-full flex-col">
        <div className="flex items-center justify-between gap-4 px-5 pt-5 sm:px-8 lg:px-10">
          <Link href="/" className="lg:hidden" aria-label="ChatNexGen home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="ChatNexGen" className="h-8 w-auto object-contain" />
          </Link>
          <div className="ml-auto text-xs">{topRight}</div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 lg:px-10">
          <div className={cn("w-full", maxWidth === "wide" ? "max-w-[560px]" : "max-w-[400px]", className)}>
            {children}
          </div>
        </div>
      </section>
    </div>
  );
}
