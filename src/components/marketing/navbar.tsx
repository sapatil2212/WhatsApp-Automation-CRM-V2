"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useMarketingTheme } from "@/components/marketing/marketing-theme-provider";
import { ThemeToggle } from "./theme-toggle";
import { BookDemoTrigger } from "./book-demo-trigger";
import { usePublicSettings } from "@/lib/cms/use-public-settings";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { name: "Home", href: "/" },
  { name: "Features", href: "/features" },
  { name: "AI Automation", href: "/ai-automation" },
  { name: "Pricing", href: "/pricing" },
];

const MOBILE_LINKS = [
  { name: "Shared Inbox", href: "/shared-team-inbox" },
  { name: "CRM Engine", href: "/crm" },
  { name: "Analytics Dashboard", href: "/analytics" },
  { name: "Enterprise Readiness", href: "/enterprise" },
  { name: "Security & Compliance", href: "/security" },
  { name: "About Us", href: "/about-us" },
];

export function GlassNavbar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { resolvedTheme } = useMarketingTheme();
  const { settings } = usePublicSettings();

  const logoSrc =
    resolvedTheme === "light"
      ? settings.site_branding.logoLightUrl || "/images/logo/chatnexgen-logo-light.png"
      : settings.site_branding.logoDarkUrl || "/images/logo/chatnexgen-logo.png";

  // Track scroll position (only re-renders when crossing the threshold).
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Session check runs once on mount.
  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (!cancelled) setIsLoggedIn(!!session);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // On the home page the bar is fully transparent over the hero until the page scrolls.
  const transparent = pathname === "/" && !scrolled && !isOpen;
  const linkCls = "text-[var(--m-text-secondary)] hover:text-[var(--m-text-heading)]";
  const ctaHref = isLoggedIn ? "/dashboard" : "/login";
  const ctaLabel = isLoggedIn ? "Dashboard" : "Sign In";

  return (
    <>
      <header
        className={cn(
          "fixed top-0 inset-x-0 z-50 h-16 border-b transition-colors duration-300 ease-out px-8 sm:px-20 lg:px-32",
          transparent
            ? "border-transparent bg-transparent"
            : "border-[var(--m-border-primary)] bg-[var(--m-bg-primary)]"
        )}
      >
        <div className="mx-auto flex h-full max-w-[1360px] items-center justify-between">
          <Link href="/" className="flex items-center shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoSrc}
              alt={settings.site_branding.siteName || "ChatNexGen Logo"}
              className="h-8 w-auto object-contain"
            />
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-xs font-semibold tracking-wide transition-colors whitespace-nowrap",
                  pathname === link.href ? "text-emerald-500" : linkCls
                )}
              >
                {link.name}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3 shrink-0">
            <ThemeToggle />
            <BookDemoTrigger
              className={cn("text-xs font-semibold transition-colors px-3 py-1.5 whitespace-nowrap cursor-pointer", linkCls)}
            >
              Book Demo
            </BookDemoTrigger>
            <Link
              href={ctaHref}
              className="group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#00DF82] px-5 py-2.5 text-xs font-semibold text-slate-950 shadow-[0_6px_24px_rgba(0,223,130,0.25)] transition-all duration-300 ease-out hover:-translate-y-px hover:bg-[#00c673]"
            >
              {ctaLabel}
              <ArrowRight className="size-4 transition-transform duration-300 ease-out group-hover:translate-x-1" />
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            aria-label={isOpen ? "Close menu" : "Open menu"}
            aria-expanded={isOpen}
            className="md:hidden w-9 h-9 border flex items-center justify-center bg-[var(--m-bg-secondary)] border-[var(--m-border-primary)] text-[var(--m-text-secondary)] hover:text-[var(--m-text-heading)]"
          >
            {isOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </header>

      {isOpen && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-40 p-6 flex flex-col justify-between md:hidden bg-[var(--m-bg-primary)] overflow-y-auto">
          <div className="space-y-6">
            <div className="flex flex-col gap-4">
              <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--m-text-muted)]">
                Navigation
              </span>
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="text-sm font-bold text-[var(--m-text-primary)] hover:text-emerald-500"
                >
                  {link.name}
                </Link>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--m-text-muted)]">
                Solutions
              </span>
              <div className="grid grid-cols-2 gap-3">
                {MOBILE_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsOpen(false)}
                    className="text-xs font-semibold text-[var(--m-text-secondary)] hover:text-emerald-500"
                  >
                    {link.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 mt-8">
            <div className="flex justify-center py-1">
              <ThemeToggle className="w-full justify-around" />
            </div>
            <BookDemoTrigger className="w-full text-center text-xs font-bold py-3 border border-[var(--m-border-primary)] bg-[var(--m-bg-tertiary)] text-[var(--m-text-primary)]">
              Book Demo
            </BookDemoTrigger>
            <Link
              href={ctaHref}
              onClick={() => setIsOpen(false)}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#00DF82] py-3 text-xs font-semibold text-slate-950 shadow-[0_6px_24px_rgba(0,223,130,0.25)] transition-all duration-300 ease-out hover:bg-[#00c673]"
            >
              {ctaLabel}
              <ArrowRight className="size-4 transition-transform duration-300 ease-out group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
