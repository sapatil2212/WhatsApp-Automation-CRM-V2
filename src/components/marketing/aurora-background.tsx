import React from "react";
import { cn } from "@/lib/utils";

interface AuroraBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  showRadialGlows?: boolean;
}

/**
 * Static aurora backdrop. Server component, no JS animation: the glows used to
 * animate forever under heavy blur filters, which kept the GPU busy while scrolling.
 */
export function AuroraBackground({
  children,
  showRadialGlows = true,
  className,
  ...props
}: AuroraBackgroundProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-start min-h-screen overflow-hidden bg-[var(--m-bg-primary)] text-[var(--m-text-primary)]",
        className
      )}
      {...props}
    >
      {showRadialGlows && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0" aria-hidden>
          <div
            className="absolute -top-[20%] -left-[20%] w-[60%] h-[60%] rounded-full bg-[var(--m-glow-emerald)] blur-[100px]"
            style={{ mixBlendMode: "var(--m-spotlight-blend)" as React.CSSProperties["mixBlendMode"] }}
          />
          <div
            className="absolute -bottom-[20%] -right-[20%] w-[70%] h-[70%] rounded-full bg-[var(--m-glow-cyan)] blur-[100px]"
            style={{ mixBlendMode: "var(--m-spotlight-blend)" as React.CSSProperties["mixBlendMode"] }}
          />
        </div>
      )}

      <div className="relative w-full z-20 flex flex-col flex-1">{children}</div>
    </div>
  );
}
