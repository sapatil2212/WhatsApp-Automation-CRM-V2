"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Bot, Workflow, Check, Loader2, Info } from "lucide-react";

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
      "The AI answers every message. Flows start only on an exact keyword or when the AI declines (AI switched off or not confident).",
    icon: Bot,
    accent: "text-violet-700 dark:text-violet-300",
  },
  {
    id: "flows_first",
    label: "Flows first",
    description:
      "Any matching flow answers first. The AI replies only when no flow matches. Best for guided, multi-step journeys.",
    icon: Workflow,
    accent: "text-emerald-700 dark:text-emerald-300",
  },
  {
    id: "flows_only",
    label: "Flows only",
    description:
      "Only flows and reply automations answer. The AI assistant never replies.",
    icon: Workflow,
    accent: "text-emerald-700 dark:text-emerald-300",
  },
  {
    id: "ai_only",
    label: "AI only",
    description:
      "Only the AI replies. New flows never start; a flow already in progress still finishes.",
    icon: Bot,
    accent: "text-violet-700 dark:text-violet-300",
  },
];

/**
 * "Response handling" control — lets the business choose whether incoming
 * WhatsApp messages are answered by the AI assistant, by Flows, or a
 * priority order between them. Persists via /api/flows/routing.
 */
export function RoutingModeCard({ activeFlowCount = 0 }: { activeFlowCount?: number }) {
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
    <section className="rounded-xl border border-border bg-muted/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Response handling</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose how incoming WhatsApp messages are answered — by your Flows,
            the AI assistant, or a priority between them.
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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
                  : "border-border bg-background hover:border-foreground/20",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  active ? "bg-primary/15" : "bg-card",
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
                  <span className="text-sm font-medium text-foreground">{m.label}</span>
                  {active && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                      <Check className="h-2.5 w-2.5" />
                      Active
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {m.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {mode === "ai_first" && activeFlowCount > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            You have {activeFlowCount} active flow{activeFlowCount === 1 ? "" : "s"}, but the AI answers first. Only
            flows with an <strong>exact</strong> keyword trigger will start reliably. Switch to <strong>Flows first</strong> if
            your flows should lead the conversation.
          </span>
        </div>
      )}

      <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
        <li className="flex items-start gap-1.5"><Info className="mt-0.5 h-3 w-3 shrink-0" /> In every mode, a flow already in progress continues, and exact keyword flows and automations answer before the AI.</li>
        <li className="flex items-start gap-1.5"><Info className="mt-0.5 h-3 w-3 shrink-0" /> Automations without message steps (tags, CRM, webhooks) always run. Message automations run only if nothing else answered, unless set to “Send even if AI replied”.</li>
        <li className="flex items-start gap-1.5"><Info className="mt-0.5 h-3 w-3 shrink-0" /> If the AI fails, it retries once, then tells the customer the team will reply and opens the chat for your team.</li>
      </ul>
    </section>
  );
}
