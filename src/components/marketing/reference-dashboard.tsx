import React from "react";
import Image from "next/image";

export function ReferenceDashboard() {
  return (
    <div className="relative w-full max-w-5xl mx-auto mt-0 px-4 md:px-0">
      <div className="relative z-10 w-full rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-surface)] shadow-[var(--m-shadow-card)] overflow-hidden flex flex-col">
        {/* next/image serves a resized WebP/AVIF instead of the 1.1 MB PNG */}
        <Image
          src="/images/hero-dashboard.png"
          alt="ChatNexGen Dashboard Mockup"
          width={1684}
          height={934}
          priority
          sizes="(min-width: 1024px) 1024px, 100vw"
          quality={75}
          className="w-full h-auto object-cover rounded-2xl"
        />
      </div>
    </div>
  );
}
