"use client";

import { Check, CheckCheck, Clock, AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import { avatarColor, initials, type MessageStatus } from "./types";

export function WaAvatar({
  name,
  seed,
  url,
  size = 38,
  className,
}: {
  name: string;
  seed: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" style={style} className={cn("shrink-0 rounded-full object-cover", className)} />
    );
  }
  return (
    <div
      aria-hidden
      style={{ ...style, backgroundColor: avatarColor(seed) }}
      className={cn("flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white", className)}
    >
      {initials(name)}
    </div>
  );
}

/** WhatsApp delivery ticks. */
export function Ticks({ status, className }: { status: MessageStatus; className?: string }) {
  const base = cn("h-[15px] w-[15px] shrink-0", className);
  switch (status) {
    case "sending":
      return <Clock aria-label="Sending" className={cn(base, "h-3 w-3 text-[var(--wa-text-2)]")} />;
    case "sent":
      return <Check aria-label="Sent" className={cn(base, "text-[var(--wa-text-2)]")} />;
    case "delivered":
      return <CheckCheck aria-label="Delivered" className={cn(base, "text-[var(--wa-text-2)]")} />;
    case "read":
      return <CheckCheck aria-label="Read" className={cn(base, "text-[var(--wa-tick-read)]")} />;
    case "failed":
      return <AlertCircle aria-label="Failed" className={cn(base, "h-3.5 w-3.5 text-red-500")} />;
    default:
      return null;
  }
}

/** The little bubble tail. `side="out"` sits on the top-right. */
export function BubbleTail({ side }: { side: "in" | "out" }) {
  return side === "out" ? (
    <svg
      aria-hidden
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className="absolute -right-2 top-0 text-[var(--wa-out)]"
    >
      <path fill="currentColor" d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
    </svg>
  ) : (
    <svg aria-hidden viewBox="0 0 8 13" width="8" height="13" className="absolute -left-2 top-0 text-[var(--wa-in)]">
      <path fill="currentColor" d="M2.812 1H8v11.193L1.533 3.568C.474 2.156 1.042 1 2.812 1z" />
    </svg>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--wa-border)] bg-[var(--wa-panel-header)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--wa-text-2)]">
      {children}
    </kbd>
  );
}
