"use client";

import { Check, Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { THEMES, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";

const MODES = [
  { id: "light" as const, label: "Light", desc: "Bright, high-contrast", icon: Sun, iconCls: "bg-amber-500/10 text-amber-600" },
  { id: "dark" as const, label: "Dark", desc: "Easy on the eyes at night", icon: Moon, iconCls: "bg-indigo-500/10 text-indigo-500 dark:text-indigo-300" },
];

function ActiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
      <Check className="size-3" /> Active
    </span>
  );
}

/** Theme mode and accent colour. Both are saved to this device. */
export function AppearancePanel() {
  const { theme, setTheme, mode, setMode } = useTheme();
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border/70 bg-card p-4">
        <h3 className="text-sm font-semibold">Theme</h3>
        <p className="mb-3 text-xs text-muted-foreground">Light or dark dashboard. Saved to this device.</p>
        <div className="grid max-w-xl grid-cols-2 gap-2.5">
          {MODES.map((m) => {
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={on}
                className={cn("flex items-center gap-3 rounded-lg border p-3 text-left transition-colors", on ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "border-border/70 hover:bg-muted/40")}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", m.iconCls)}><m.icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{m.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{m.desc}</span>
                </span>
                {on && <ActiveBadge />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card p-4">
        <h3 className="text-sm font-semibold">Accent colour</h3>
        <p className="mb-3 text-xs text-muted-foreground">Used for buttons, links, active items and badges. Saved to this device.</p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {THEMES.map((t) => (
            <ThemeCard key={t.id} id={t.id} name={t.name} tagline={t.tagline} swatch={t.swatch} isActive={t.id === theme} onPick={() => setTheme(t.id)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ThemeCard({ id, name, tagline, swatch, isActive, onPick }: { id: ThemeId; name: string; tagline: string; swatch: string; isActive: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={`Use ${name} theme`}
      className={cn("flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors", isActive ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "border-border/70 hover:bg-muted/40")}
    >
      <span aria-hidden className="mt-0.5 size-6 shrink-0 rounded-full" style={{ background: swatch, boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.15)" }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-1">
          <span className="truncate text-[13px] font-semibold">{name}</span>
          {isActive && <ActiveBadge />}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">{tagline}</span>
      </span>
      <span className="sr-only">Theme id: {id}</span>
    </button>
  );
}
