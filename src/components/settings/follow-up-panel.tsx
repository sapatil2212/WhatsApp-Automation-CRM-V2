"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Clock, MessageCircleOff, Moon } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/campaigns/api";

const RULES = [
  { icon: Clock, text: "A friendly nudge after 3, 10 and 21 hours of silence." },
  { icon: Moon, text: "Only inside WhatsApp's 24-hour window, between 9 am and 9 pm." },
  { icon: MessageCircleOff, text: 'Stops when the customer replies, books, or says "stop" / "not interested".' },
];

/** Automatic sales follow-ups for customers who stop replying. */
export function FollowUpPanel() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ enabled: boolean }>("/api/leads/settings")
      .then((r) => setEnabled(r.data.enabled))
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (next: boolean) => {
    const prev = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await api("/api/leads/settings", { method: "PUT", json: { enabled: next } });
      toast.success(next ? "Follow-ups turned on." : "Follow-ups turned off.");
    } catch (e) {
      setEnabled(prev);
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="max-w-3xl rounded-xl border border-border/70 bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BellRing className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Automatic follow-ups</h3>
          <p className="text-xs text-muted-foreground">When a customer stops replying, the AI sales assistant follows up for you.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`text-[12px] font-medium ${enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{loading ? "…" : enabled ? "On" : "Off"}</span>
          <Switch checked={enabled} disabled={loading || saving} onCheckedChange={toggle} aria-label="Automatic follow-ups" />
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 border-t border-border/70 pt-3">
        {RULES.map((r) => (
          <li key={r.text} className="flex items-start gap-2 text-[12px] text-muted-foreground">
            <r.icon className="mt-0.5 size-3.5 shrink-0" /> {r.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
