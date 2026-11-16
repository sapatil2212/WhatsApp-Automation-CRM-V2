"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Workflow, Check, Loader2, Info } from "lucide-react";

import { cn } from "@/lib/utils";

type Mode = "ai_first" | "flows_first" | "flows_only" | "ai_only";

const MODES: {
  id: Mode;
  label: string;
  description: string;
  icon: typeof Bot;
  accent: string;
}[] = [
  {
    id: "ai_first",
    label: "AI first",
    description:
      "The AI assistant answers automatically. A flow runs only if the AI can't handle the message.",
    icon: Bot,
    accent: "text-violet-300",
  },
  {
    id: "flows_first",
    label: "Flows first",
    description:
      "Your flows drive the conversation. The AI steps in only when no flow matches. Best for guided, multi-step journeys.",
    icon: Workflow,
    accent: "text-emerald-300",
  },
  {
    id: "flows_only",
    label: "Flows only",
    description:
      "Only your flows reply to customers. The AI assistant stays off.",
    icon: Workflow,
    accent: "text-emerald-300",
  },
  {
    id: "ai_only",
    label: "AI only",
    description:
      "Only the AI assistant replies. Flows are paused for incoming messages.",
    icon: Bot,
    accent: "text-violet-300",
  },
];

/**
 * "Response handling" control — lets the business choose whether incoming
 * WhatsApp messages are answered by the AI assistant, by Flows, or a
 * priority order between them. Persists via /api/flows/routing.
 */
export function RoutingModeCard() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [saving, setSaving] = useState<Mode | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/flows/routing");
        if (res.ok) {
          const json = (await res.json()) as { mode: Mode };
          if (!cancelled) setMode(json.mode);
        }
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(next: Mode) {
    if (next === mode || saving) return;
    setSaving(next);
    const prev = mode;
    setMode(next); // optimistic
    try {
      const res = await fetch("/api/flows/routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Couldn't update response handling.");
      }
      toast.success("Response handling updated.");
    } catch (err) {
      setMode(prev); // revert
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Response handling</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Choose how incoming WhatsApp messages are answered — by your Flows,
            the AI assistant, or a priority between them.
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODES.map((m) => {
          const active = mode === m.id;
          const isSaving = saving === m.id;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => choose(m.id)}
              disabled={loading || !!saving}
              className={cn(
                "relative flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors disabled:opacity-60",
                active
                  ? "border-primary bg-primary/5"
                  : "border-slate-800 bg-slate-950 hover:border-slate-700",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  active ? "bg-primary/15" : "bg-slate-900",
                )}
              >
                {isSaving ? (
                  <Loader2 className={cn("h-4 w-4 animate-spin", m.accent)} />
                ) : (
                  <Icon className={cn("h-4 w-4", m.accent)} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{m.label}</span>
                  {active && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                      <Check className="h-2.5 w-2.5" />
                      Active
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {m.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        A flow already in progress with a customer always continues, regardless
        of this setting. If nothing handles a message, your automations still run.
      </p>
    </section>
  );
}
