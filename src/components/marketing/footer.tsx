"use client";

import React from "react";
import Link from "next/link";
import { useMarketingTheme } from "@/components/marketing/marketing-theme-provider";
import { usePublicSettings } from "@/lib/cms/use-public-settings";

export function Footer() {
  const { resolvedTheme } = useMarketingTheme();
  const isLight = resolvedTheme === "light";
  const { settings } = usePublicSettings();

  const branding = settings.site_branding;
  const footer = settings.footer_details;
  const contact = settings.contact_info;

  const productLinks = [
    { name: "Features", href: "/features" },
    { name: "Pricing", href: "/pricing" },
    { name: "AI Automation", href: "/ai-automation" },
    { name: "Use Cases", href: "/" },
  ];

  const quickLinks = [
    { name: "About Us", href: "/about-us" },
    { name: "Contact Us", href: "/contact-us" },
    { name: "Privacy Policy", href: "/privacy-policy" },
    { name: "Terms & Conditions", href: "/terms-and-conditions" },
    { name: "Refund Policy", href: "/refund-policy" },
  ];

  const logoSrc = isLight
    ? branding.logoLightUrl || "/images/logo/chatnexgen-logo-light.png"
    : branding.logoDarkUrl || "/images/logo/chatnexgen-logo.png";

  return (
    <footer className="relative w-full border-t border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] py-16 px-4 md:px-6 overflow-hidden">
      {/* Background radial highlight */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[150px] rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-6 gap-10 md:gap-8 relative z-10">
        {/* Brand Column */}
        <div className="col-span-1 md:col-span-2 space-y-4">
          <Link href="/" className="inline-block">
            <img
              src={logoSrc}
              alt={branding.siteName || "ChatNexGen Logo"}
              className="h-8 w-auto object-contain"
            />
          </Link>
          <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed max-w-sm">
            {footer.footerDescription}
          </p>
          <p className="text-xs font-medium text-[var(--m-text-secondary)]">
            {footer.attributionText}
          </p>
        </div>

        {/* Product Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">Solutions</h6>
          <ul className="space-y-2.5">
            {productLinks.map((link) => (
              <li key={link.name}>
                <Link href={link.href} className="text-xs text-[var(--m-text-muted)] hover:text-[var(--m-text-heading)] transition-colors">
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Legal & Quick Links Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">Quick Links</h6>
          <ul className="space-y-2.5">
            {quickLinks.map((link) => (
              <li key={link.name}>
                <Link href={link.href} className="text-xs text-[var(--m-text-muted)] hover:text-[var(--m-text-heading)] transition-colors">
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Contact Us Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">Contact Us</h6>
          <ul className="space-y-2.5 text-xs text-[var(--m-text-muted)]">
            <li className="font-semibold text-[var(--m-text-secondary)]">{branding.siteName || "ChatNexGen"}</li>
            <li className="text-[11px] text-[var(--m-text-tertiary)]">{footer.companyName || "Brightwave Digital Products LLP"}</li>
            <li>{contact.address}</li>
            {contact.phone && <li>Phone: {contact.phone}</li>}
            <li className="pt-1">
              <span className="block text-[11px] text-[var(--m-text-tertiary)] font-medium">Help &amp; Support:</span>
              <a href={`mailto:${contact.supportEmail}`} className="text-emerald-400 hover:underline">
                {contact.supportEmail}
              </a>
            </li>
          </ul>
        </div>

        {/* Trust signals Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">Trust Signals</h6>
          <ul className="space-y-2 text-[10px] text-[var(--m-text-muted)] font-semibold">
            <li className="text-emerald-400">✓ Secure Platform</li>
            <li className="text-emerald-400">✓ Data Encryption</li>
            <li className="text-emerald-400">✓ Meta-Compliant</li>
            <li className="text-emerald-400">✓ Role-Based Access</li>
            <li className="text-emerald-400">✓ Business Support</li>
          </ul>
        </div>
      </div>

      {/* Meta API disclaimer & Copyright footer */}
      <div className="max-w-6xl mx-auto mt-12 pt-8 border-t border-[var(--m-border-primary)]/50 space-y-4 relative z-10 text-center">
        {footer.disclaimerText && (
          <p className="text-[10px] leading-relaxed text-[var(--m-text-muted)] max-w-3xl mx-auto">
            &quot;{footer.disclaimerText}&quot;
          </p>
        )}
        <div className="text-[10px] text-[var(--m-text-muted)] pt-2 space-y-1">
          <p>{footer.copyrightText}</p>
          <p className="text-xs font-medium text-[var(--m-text-secondary)]">
            {footer.attributionText}
          </p>
        </div>
      </div>
    </footer>
  );
}
