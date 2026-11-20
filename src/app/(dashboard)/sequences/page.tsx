"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pause, Play, Plus, Trash2, UserPlus, Workflow, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/campaigns/api";

type Step =
  | { kind: "template"; delayHours: number; templateName: string; language: string; params: string[] }
  | { kind: "text"; delayHours: number; text: string };

interface Sequence {
  id: string;
  name: string;
  status: "active" | "paused";
  stopOnReply: boolean;
  steps: Step[];
  active: number;
  completed: number;
  stopped: number;
}
interface TagRow {
  id: string;
  name: string;
}

const blankStep = (): Step => ({ kind: "template", delayHours: 0, templateName: "", language: "en_US", params: [] });

export default function SequencesPage() {
  const [items, setItems] = useState<Sequence[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [enrollFor, setEnrollFor] = useState<Sequence | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api<Sequence[]>("/api/sequences"), api<TagRow[]>("/api/tags").catch(() => null)]);
      setItems(s.data);
      if (t && Array.isArray(t.data)) setTags(t.data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (s: Sequence) => {
    try {
      await api(`/api/sequences/${s.id}`, { method: "PATCH", json: { status: s.status === "active" ? "paused" : "active" } });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const remove = async (s: Sequence) => {
    if (!window.confirm(`Delete "${s.name}"? Everyone enrolled will stop receiving it.`)) return;
    try {
      await api(`/api/sequences/${s.id}`, { method: "DELETE" });
      toast.success("Sequence deleted.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Drip sequences</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Send a timed series of WhatsApp messages. Stops automatically when the customer replies or opts out.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1 size-4" /> New sequence
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Workflow className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">No sequences yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create one to nurture leads or onboard patients automatically.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">{s.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.status === "active" ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}`}>
                    {s.status === "active" ? "Active" : "Paused"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.steps.length} step{s.steps.length === 1 ? "" : "s"} · {s.active} in progress · {s.completed} completed · {s.stopped} stopped
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setEnrollFor(s)}>
                  <UserPlus className="mr-1 size-4" /> Enrol
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggle(s)}>
                  {s.status === "active" ? <Pause className="mr-1 size-4" /> : <Play className="mr-1 size-4" />}
                  {s.status === "active" ? "Pause" : "Resume"}
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => remove(s)}>
                  <Trash2 className="size-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateDialog open={creating} onClose={() => setCreating(false)} onSaved={load} />
      <EnrollDialog sequence={enrollFor} tags={tags} onClose={() => setEnrollFor(null)} onDone={load} />
    </div>
  );
}

function CreateDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [stopOnReply, setStopOnReply] = useState(true);
  const [steps, setSteps] = useState<Step[]>([blankStep()]);
  const [saving, setSaving] = useState(false);

  const patch = (i: number, next: Step) => setSteps((s) => s.map((x, j) => (j === i ? next : x)));

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/sequences", { method: "POST", json: { name, stopOnReply, steps } });
      toast.success("Sequence created.");
      setName("");
      setSteps([blankStep()]);
      onClose();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New drip sequence</DialogTitle>
          <DialogDescription>
            Template steps work any time. Text steps are only sent inside WhatsApp&apos;s 24-hour window. Use {"{{name}}"} for the first name.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New lead welcome" />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label className="text-sm">Stop when the customer replies</Label>
            <Switch checked={stopOnReply} onCheckedChange={setStopOnReply} />
          </div>
          {steps.map((s, i) => (
            <div key={i} className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Step {i + 1}</span>
                {steps.length > 1 && (
                  <Button size="icon" variant="ghost" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Type</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={s.kind}
                    onChange={(e) =>
                      patch(i, e.target.value === "text" ? { kind: "text", delayHours: s.delayHours, text: "" } : { kind: "template", delayHours: s.delayHours, templateName: "", language: "en_US", params: [] })
                    }
                  >
                    <option value="template">Approved template</option>
                    <option value="text">Text (24h window)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{i === 0 ? "Send after (hours)" : "Wait after previous (hours)"}</Label>
                  <Input type="number" min={0} value={s.delayHours} onChange={(e) => patch(i, { ...s, delayHours: Math.max(0, Number(e.target.value) || 0) })} />
                </div>
              </div>
              {s.kind === "template" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Template name</Label>
                    <Input value={s.templateName} onChange={(e) => patch(i, { ...s, templateName: e.target.value })} placeholder="welcome_offer" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Variables (comma separated)</Label>
                    <Input value={s.params.join(", ")} onChange={(e) => patch(i, { ...s, params: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) })} placeholder="{{name}}" />
                  </div>
                </div>
              ) : (
                <Textarea rows={3} value={s.text} onChange={(e) => patch(i, { ...s, text: e.target.value })} placeholder="Hi {{name}}, just checking in..." />
              )}
            </div>
          ))}
          {steps.length < 15 && (
            <Button variant="outline" size="sm" onClick={() => setSteps((s) => [...s, { ...blankStep(), delayHours: 24 }])}>
              <Plus className="mr-1 size-4" /> Add step
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1 size-4 animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EnrollDialog({ sequence, tags, onClose, onDone }: { sequence: Sequence | null; tags: TagRow[]; onClose: () => void; onDone: () => void }) {
  const [tagId, setTagId] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!sequence || !tagId) return;
    setBusy(true);
    try {
      const r = await api<{ enrolled: number; skipped: number }>(`/api/sequences/${sequence.id}/enroll`, { method: "POST", json: { tagId } });
      toast.success(`${r.data.enrolled} enrolled, ${r.data.skipped} already in the sequence.`);
      onClose();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!sequence} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Enrol contacts</DialogTitle>
          <DialogDescription>
            Add everyone with a tag to &quot;{sequence?.name}&quot;. Only enrol people who agreed to receive WhatsApp messages.
          </DialogDescription>
        </DialogHeader>
        <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={tagId} onChange={(e) => setTagId(e.target.value)}>
          <option value="">Choose a tag...</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} disabled={busy || !tagId}>
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />} Enrol
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
