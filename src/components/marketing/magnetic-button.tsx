import React from "react";
import { cn } from "@/lib/utils";

interface MagneticButtonProps {
  children: React.ReactNode;
  /** Kept for API compatibility; the magnetic effect was removed for performance. */
  range?: number;
  strength?: number;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export function MagneticButton({ children, className, onClick }: MagneticButtonProps) {
  return (
    <div
      onClick={onClick}
      className={cn("relative inline-flex items-center justify-center", className)}
    >
      {children}
    </div>
  );
}
