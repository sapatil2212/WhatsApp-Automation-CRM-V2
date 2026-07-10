"use client";

import React from "react";

export function ReferenceDashboard() {
  return (
    <div className="relative w-full max-w-5xl mx-auto mt-0 px-4 md:px-0">
      {/* Background Glow Effect behind Dashboard */}
      <div
        className="absolute -top-12 left-1/2 -translate-x-1/2 w-[85%] h-[280px] rounded-full pointer-events-none z-0 animate-pulse bg-[var(--m-glow-emerald)] blur-[100px]"
        style={{ animationDuration: "8s" }}
      />

      {/* The Dashboard Image Container */}
      <div
        className="relative z-10 w-full rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-surface)] shadow-[var(--m-shadow-card)] backdrop-blur-xl transition-all duration-300 overflow-hidden flex flex-col"
      >
        <img
          src="/images/hero-dashboard.png"
          alt="ChatNexGen Dashboard Mockup"
          className="w-full h-auto object-cover rounded-2xl"
        />
      </div>
    </div>
  );
}
