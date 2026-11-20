"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, LayoutGrid, Loader2, PenLine, Sparkles, Trash2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PIPELINE_TEMPLATES } from "@/lib/pipelines/templates";

type Stage = { name: string; color: string; hint?: string };
type Mode = "templates" | "ai" | "blank";

const BLANK: Stage[] = [
  { name: "New Lead", color: "#64748b" },
  { name: "In Progress", color: "#3b82f6" },
  { name: "Won", color: "#22c55e" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (pipelineId: string) => void;
}

export function NewPipelineDialog({ open, onOpenChange, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("templates");
  const [draft, setDraft] = useState<{ name: string; stages: Stage[]; tips?: string[] } | null>(null);
  const [aiText, setAiText] = useState("");
  const [designing, setDesigning] = useState(false);
  const [creating, setCreating] = useState(false);

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) setTimeout(() => { setDraft(null); setMode("templates"); setAiText(""); }, 200);
  }

  async function design() {
    setDesigning(true);
    try {
      const res = await fetch("/api/pipelines/ai-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiText }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.message || "AI design failed");
      setDraft(body.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI design failed");
    } finally {
      setDesigning(false);
    }
  }

  async function create() {
    if (!draft) return;
    const stages = draft.stages.filter((s) => s.name.trim());
    if (!draft.name.trim() || stages.length < 2) {
      toast.error("Give the pipeline a name and at least two stages.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), stages: stages.map(({ name, color }) => ({ name: name.trim(), color })) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Failed to create pipeline");
      toast.success(`“${draft.name}” created`);
      onCreated(body.pipeline.id);
      close(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create pipeline");
    } finally {
      setCreating(false);
    }
  }

  const updateStage = (i: number, patch: Partial<Stage>) =>
    setDraft((d) => (d ? { ...d, stages: d.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{draft ? "Review your pipeline" : "Create a pipeline"}</DialogTitle>
          <DialogDescription>
            {draft ? "Rename, recolour, reorder or remove stages before creating it." : "Start from a proven template, let AI design one for your business, or build from scratch."}
          </DialogDescription>
        </DialogHeader>

        {!draft && (
          <>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/40 p-1" role="tablist">
              {([
                ["templates", "Templates", LayoutGrid],
                ["ai", "Design with AI", Sparkles],
                ["blank", "Blank", PenLine],
              ] as const).map(([m, label, Icon]) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => (m === "blank" ? setDraft({ name: "", stages: BLANK }) : setMode(m))}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className={`size-3.5 ${m === "ai" ? "text-primary" : ""}`} /> {label}
                </button>
              ))}
            </div>

            {mode === "templates" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {PIPELINE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setDraft({ name: t.name, stages: t.stages.map((s) => ({ ...s })) })}
                    className="group rounded-xl border border-border p-4 text-left transition-all hover:border-primary/50 hover:shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{t.emoji}</span>
                      <p className="text-sm font-semibold">{t.name}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                    <div className="mt-3 flex gap-0.5">
                      {t.stages.map((s) => (
                        <span key={s.name} title={s.name} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: s.color }} />
                      ))}
                    </div>
                    <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{t.stages.map((s) => s.name).join(" → ")}</p>
                  </button>
                ))}
              </div>
            )}

            {mode === "ai" && (
              <div className="space-y-3">
                <Label htmlFor="ai-pipe">Describe your business and how you sell</Label>
                <Textarea
                  id="ai-pipe"
                  rows={4}
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value.slice(0, 1000))}
                  placeholder="e.g. We run a dental clinic. Patients message us from Instagram ads, we book a consultation, share a treatment plan and collect a deposit before starting treatment."
                />
                <Button onClick={design} disabled={designing || aiText.trim().length < 5} className="gap-1.5">
                  {designing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {designing ? "Designing…" : "Design my pipeline"}
                </Button>
              </div>
            )}
          </>
        )}

        {draft && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pipe-name">Pipeline name</Label>
              <Input id="pipe-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 80) })} placeholder="e.g. Enterprise Sales" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Stages <span className="font-normal text-muted-foreground">(left → right on the board)</span></Label>
              <div className="flex gap-0.5">
                {draft.stages.map((s, i) => <span key={i} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: s.color }} />)}
              </div>
              <ol className="space-y-1.5">
                {draft.stages.map((s, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <input type="color" value={s.color} onChange={(e) => updateStage(i, { color: e.target.value })} className="size-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5" aria-label={`Colour for ${s.name}`} />
                    <div className="min-w-0 flex-1">
                      <Input value={s.name} onChange={(e) => updateStage(i, { name: e.target.value.slice(0, 60) })} className="h-8 text-sm" />
                      {s.hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{s.hint}</p>}
                    </div>
                    <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => setDraft({ ...draft, stages: draft.stages.map((x, j, arr) => (j === i - 1 ? arr[i] : j === i ? arr[i - 1] : x)) })} aria-label="Move up">↑</Button>
                    <Button variant="ghost" size="icon-sm" disabled={draft.stages.length <= 2} onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, j) => j !== i) })} aria-label="Remove stage" className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></Button>
                  </li>
                ))}
              </ol>
              {draft.stages.length < 12 && (
                <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, stages: [...draft.stages.slice(0, -1), { name: "New stage", color: "#6366f1" }, draft.stages[draft.stages.length - 1]] })} className="gap-1.5">
                  <Plus className="size-3.5" /> Add stage
                </Button>
              )}
            </div>
            {draft.tips && draft.tips.length > 0 && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
                <p className="mb-1 flex items-center gap-1.5 font-medium"><Sparkles className="size-3.5 text-primary" /> AI tips</p>
                {draft.tips.map((t) => <p key={t} className="text-muted-foreground">• {t}</p>)}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {draft ? (
            <>
              <Button variant="outline" onClick={() => setDraft(null)} className="gap-1.5"><ArrowLeft className="size-4" /> Back</Button>
              <Button onClick={create} disabled={creating} className="gap-1.5">
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Create pipeline
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
