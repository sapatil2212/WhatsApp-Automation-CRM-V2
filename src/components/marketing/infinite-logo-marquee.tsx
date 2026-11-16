"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface LogoMarqueeProps {
  className?: string;
  speed?: "slow" | "medium" | "fast";
}

export function InfiniteLogoMarquee({
  className,
  speed = "medium",
}: LogoMarqueeProps) {
  const integrations = [
    { name: "REST API", tag: "Webhooks" },
    { name: "Shopify", tag: "E-Commerce" },
    { name: "WooCommerce", tag: "Store Sync" },
    { name: "Zapier", tag: "No-Code" },
    { name: "Google Sheets", tag: "Lead Export" },
    { name: "HubSpot", tag: "CRM Sync" },
  ];

  const duration = speed === "fast" ? "15s" : speed === "slow" ? "40s" : "25s";

  return (
    <div className={cn("relative w-full overflow-hidden py-6 select-none", className)}>
      <style>{`
        @keyframes marquee {
          0% {
            transform: translateX(0%);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-marquee {
          display: flex;
          width: max-content;
          animation: marquee ${duration} linear infinite;
        }
      `}</style>

      {/* Fade overlay gradients */}
      <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[var(--m-gradient-fade)] to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[var(--m-gradient-fade)] to-transparent z-10 pointer-events-none" />

      <div className="animate-marquee flex gap-12 items-center">
        {/* First set of integrations */}
        {integrations.map((item, index) => (
          <div
            key={`integ-1-${index}`}
            className="flex items-center gap-2.5 opacity-60 hover:opacity-100 transition-opacity duration-300"
          >
            <div className="w-5 h-5 rounded bg-[var(--m-bg-tertiary)] border border-[var(--m-border-secondary)] flex items-center justify-center font-bold text-[9px] text-emerald-400">
              {item.name[0]}
            </div>
            <span className="text-xs font-bold tracking-tight text-[var(--m-text-secondary)] font-sans">
              {item.name}
            </span>
            <span className="text-[9px] text-[var(--m-text-tertiary)] px-1.5 py-0.5 rounded bg-[var(--m-bg-glass)] border border-[var(--m-border-primary)]">
              {item.tag}
            </span>
          </div>
        ))}

        {/* Duplicated second set of integrations for infinite illusion */}
        {integrations.map((item, index) => (
          <div
            key={`integ-2-${index}`}
            className="flex items-center gap-2.5 opacity-60 hover:opacity-100 transition-opacity duration-300"
          >
            <div className="w-5 h-5 rounded bg-[var(--m-bg-tertiary)] border border-[var(--m-border-secondary)] flex items-center justify-center font-bold text-[9px] text-emerald-400">
              {item.name[0]}
            </div>
            <span className="text-xs font-bold tracking-tight text-[var(--m-text-secondary)] font-sans">
              {item.name}
            </span>
            <span className="text-[9px] text-[var(--m-text-tertiary)] px-1.5 py-0.5 rounded bg-[var(--m-bg-glass)] border border-[var(--m-border-primary)]">
              {item.tag}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
