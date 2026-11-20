"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/campaigns/api";

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
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Automatic follow-ups</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          When a customer stops replying, an AI sales assistant sends a friendly nudge after 3, 10 and 21 hours
          of silence.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
        <div>
          <div className="text-sm font-semibold text-foreground">Follow up with quiet customers</div>
          <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
            <li>Only inside WhatsApp&apos;s 24-hour window, between 9 am and 9 pm.</li>
            <li>Stops when the customer replies, books, or says &quot;stop&quot; / &quot;not interested&quot;.</li>
          </ul>
        </div>
        <Switch checked={enabled} disabled={loading || saving} onCheckedChange={toggle} aria-label="Automatic follow-ups" />
      </div>
    </section>
  );
}
