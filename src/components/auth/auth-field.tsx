"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared auth input styling. 16px text on phones (stops iOS zoom-on-focus),
 * compact 13px from sm up.
 */
export const authInputClass =
  "h-10 w-full rounded-lg border border-[var(--m-border-secondary)] bg-transparent px-3 text-base text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20 disabled:opacity-60 sm:h-9 sm:text-[13px]";

/** Primary action button used across login, signup and password reset. */
export const authPrimaryButton =
  "flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#00DF82] text-[13px] font-semibold text-slate-950 transition-colors hover:bg-[#00c673] disabled:cursor-not-allowed disabled:opacity-60";

/** Secondary (outlined) button. */
export const authSecondaryButton =
  "flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--m-border-secondary)] bg-transparent text-[13px] font-medium text-[var(--m-text-secondary)] transition-colors hover:bg-[var(--m-bg-secondary)] disabled:cursor-not-allowed disabled:opacity-60";

interface AuthFieldProps {
  label: string;
  htmlFor?: string;
  /** Kept for API compatibility; icons are not rendered. */
  icon?: ReactNode;
  /** Right-aligned element on the label row (e.g. "Forgot password?"). */
  action?: ReactNode;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}

export function AuthField({ label, htmlFor, action, hint, optional, children, className }: AuthFieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[11px] font-medium text-[var(--m-text-secondary)]">
          {label} {optional && <span className="font-normal text-[var(--m-text-muted)]">(optional)</span>}
        </label>
        {action}
      </div>
      <div className="relative">{children}</div>
      {hint}
    </div>
  );
}

/** Error / success / info message box, readable in both marketing themes. */
export function AuthNotice({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2 text-[12px] leading-relaxed",
        tone === "error" && "border-rose-500/30 bg-rose-500/10 text-rose-500",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
        tone === "info" && "border-[var(--m-border-secondary)] bg-[var(--m-bg-secondary)] text-[var(--m-text-secondary)]"
      )}
    >
      {children}
    </div>
  );
}
