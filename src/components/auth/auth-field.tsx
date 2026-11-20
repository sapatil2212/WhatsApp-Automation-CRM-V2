"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared input styling: plain outlined field, placeholder only. */
export const authInputClass =
  "h-11 w-full rounded-lg border border-[var(--m-border-secondary)] bg-transparent px-3 text-[13px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] focus-visible:border-emerald-500 focus-visible:ring-1 focus-visible:ring-emerald-500/30";

interface AuthFieldProps {
  label: string;
  htmlFor?: string;
  /** Kept for API compatibility; icons are no longer rendered. */
  icon?: ReactNode;
  action?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AuthField({ label, htmlFor, action, hint, children, className }: AuthFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {/* Label is screen-reader only; the placeholder carries the visible hint. */}
      <label htmlFor={htmlFor} className="sr-only">
        {label}
      </label>
      <div className="relative">{children}</div>
      {action}
      {hint}
    </div>
  );
}
