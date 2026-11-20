"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleStop, Flag, Hand, KeyRound, List, Loader2, MessageSquare,
  MousePointerClick, PenLine, Rocket, Save, Sparkles, Split, Tag, TextCursorInput, Wand2, XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FlowDraft, DraftNode } from "@/lib/ai/flow-generate";

const EXAMPLES = [
  "Welcome new customers with a main menu: browse services, book an appointment, ask a question, or talk to an agent.",
  "Capture leads from our Instagram ad: ask name, city and budget, tag them 'Ad Lead', then hand over to sales.",
  "Order status bot: ask for the order number, tell them we'll check, and let them talk to support.",
  "Restaurant: show menu categories, take table reservation details (name, date, people) and confirm.",
];

const NODE_META: Record<DraftNode["node_type"], { label: string; icon: React.ElementType; tone: string }> = {
  start: { label: "Start", icon: Flag, tone: "text-emerald-600 dark:text-emerald-400" },
  send_message: { label: "Message", icon: MessageSquare, tone: "text-sky-600 dark:text-sky-400" },
  send_buttons: { label: "Buttons", icon: MousePointerClick, tone: "text-violet-600 dark:text-violet-400" },
  send_list: { label: "List menu", icon: List, tone: "text-violet-600 dark:text-violet-400" },
  collect_input: { label: "Ask question", icon: TextCursorInput, tone: "text-amber-600 dark:text-amber-400" },
  condition: { label: "Condition", icon: Split, tone: "text-orange-600 dark:text-orange-400" },
  set_tag: { label: "Tag contact", icon: Tag, tone: "text-pink-600 dark:text-pink-400" },
  handoff: { label: "Hand to agent", icon: Hand, tone: "text-red-600 dark:text-red-400" },
  end: { label: "End", icon: CircleStop, tone: "text-muted-foreground" },
};

/** Breadth-first order from the entry so the preview reads top-down. */
function orderNodes(d: FlowDraft): DraftNode[] {
  const byKey = new Map(d.nodes.map((n) => [n.node_key, n]));
  const out: DraftNode[] = [];
  const seen = new Set<string>();
  const queue = [d.entry_node_key];
  while (queue.length) {
    const k = queue.shift()!;
    const n = byKey.get(k);
    if (!n || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    const c = n.config as Record<string, unknown>;
    for (const f of ["next_node_key", "true_next", "false_next"]) if (typeof c[f] === "string") queue.push(c[f] as string);
    for (const b of (c.buttons as Array<{ next_node_key: string }>) ?? []) queue.push(b.next_node_key);
    for (const s of (c.sections as Array<{ rows: Array<{ next_node_key: string }> }>) ?? []) for (const r of s.rows) queue.push(r.next_node_key);
  }
  return out;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function AiFlowBuilder({ open, onOpenChange, onCreated }: Props) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [feedback, setFeedback] = useState("");
  const [draft, setDraft] = useState<FlowDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState<null | "draft" | "activate" | "edit">(null);

  const ordered = useMemo(() => (draft ? orderNodes(draft) : []), [draft]);
  const stepNo = useMemo(() => new Map(ordered.map((n, i) => [n.node_key, i + 1])), [ordered]);
  const errors = draft?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = draft?.issues.filter((i) => i.severity === "warning") ?? [];

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) setTimeout(() => { setDraft(null); setFeedback(""); }, 200);
  }

  async function generate(withFeedback: boolean) {
    setGenerating(true);
    try {
      const res = await fetch("/api/flows/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          ...(withFeedback && draft ? { feedback, previous: { ...draft, issues: undefined } } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.message || "AI flow generation failed");
      setDraft(body.data.draft);
      setFeedback("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI flow generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function save(kind: "draft" | "activate" | "edit") {
    if (!draft) return;
    setSaving(kind);
    try {
      const res = await fetch("/api/flows/ai-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, activate: kind === "activate" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.message || "Could not save the flow");
      const id = body.data.flow.id as string;
      if (kind === "activate") {
        if (body.data.activated) toast.success(`“${draft.name}” is live — it will answer matching messages now.`);
        else toast.warning(body.message);
      } else {
        toast.success("Flow saved as draft");
      }
      onCreated();
      close(false);
      if (kind === "edit" || (kind === "activate" && !body.data.activated)) router.push(`/flows/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the flow");
    } finally {
      setSaving(null);
    }
  }

  const target = (k?: unknown) => {
    const n = typeof k === "string" ? stepNo.get(k) : undefined;
    return n ? <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground"><ArrowRight className="size-2.5" /> step {n}</span> : null;
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> {draft ? "Review the AI flow" : "Build a flow with AI"}</DialogTitle>
          <DialogDescription>
            {draft ? "Check each step. Ask for changes in plain words, then approve to save or go live." : "Describe what the chatbot should do. AI designs the menu, questions, branches and hand-offs — you approve before anything goes live."}
          </DialogDescription>
        </DialogHeader>

        {!draft ? (
          <div className="space-y-3">
            <Textarea
              rows={5}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value.slice(0, 3000))}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && instruction.trim().length >= 8) generate(false); }}
              placeholder="e.g. When someone says hi, greet them and show a menu: our packages, book a free consultation (ask name and preferred date), or talk to a human."
              aria-label="Flow instruction"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => setInstruction(e)} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
                  {e.length > 64 ? `${e.slice(0, 62)}…` : e}
                </button>
              ))}
            </div>
            <Button onClick={() => generate(false)} disabled={generating || instruction.trim().length < 8} className="gap-1.5">
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {generating ? "Designing your flow… (10–30s)" : "Generate flow"}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-3">
              <div className="rounded-xl border border-border p-3">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 120) })} className="h-9 border-transparent px-1 text-base font-semibold shadow-none hover:border-border" aria-label="Flow name" />
                {draft.summary && <p className="mt-1 px-1 text-xs leading-relaxed text-muted-foreground">{draft.summary}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[11px]">
                  <KeyRound className="size-3 text-muted-foreground" />
                  {draft.trigger_type === "keyword" ? (
                    <>
                      <span className="text-muted-foreground">Starts when a message {String(draft.trigger_config.match_type) === "exact" ? "is exactly" : "contains"}:</span>
                      {((draft.trigger_config.keywords as string[]) ?? []).map((k) => <span key={k} className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">{k}</span>)}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Starts on a customer&apos;s first message</span>
                  )}
                </div>
              </div>

              <ol className="space-y-2">
                {ordered.map((n, i) => {
                  const meta = NODE_META[n.node_type];
                  const c = n.config as Record<string, unknown>;
                  const nodeIssues = draft.issues.filter((x) => x.node_key === n.node_key);
                  return (
                    <li key={n.node_key} className={`rounded-xl border p-3 ${nodeIssues.some((x) => x.severity === "error") ? "border-destructive/50" : "border-border"}`}>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold">{i + 1}</span>
                        <meta.icon className={`size-3.5 ${meta.tone}`} />
                        <span className="font-semibold">{meta.label}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{n.node_key}</span>
                        {n.node_type !== "send_buttons" && n.node_type !== "send_list" && n.node_type !== "condition" && <span className="ml-auto">{target(c.next_node_key)}</span>}
                      </div>
                      {(c.text || c.prompt_text) ? (
                        <p className="mt-1.5 whitespace-pre-line rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed">{String(c.text ?? c.prompt_text)}</p>
                      ) : null}
                      {n.node_type === "collect_input" && <p className="mt-1 text-[11px] text-muted-foreground">Saves answer as <code>{`{{${String(c.var_key)}}}`}</code>{c.validation !== "any" ? ` · must be a valid ${String(c.validation)}` : ""}</p>}
                      {n.node_type === "send_buttons" && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(c.buttons as Array<{ title: string; next_node_key: string }>).map((b) => (
                            <span key={b.title} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] font-medium">{b.title} {target(b.next_node_key)}</span>
                          ))}
                        </div>
                      )}
                      {n.node_type === "send_list" && (
                        <div className="mt-2 space-y-1">
                          {(c.sections as Array<{ title: string; rows: Array<{ title: string; description?: string; next_node_key: string }> }>).flatMap((s) => s.rows).map((r) => (
                            <div key={r.title} className="flex items-center gap-2 text-[11px]"><span className="font-medium">{r.title}</span>{r.description && <span className="truncate text-muted-foreground">{r.description}</span>}<span className="ml-auto">{target(r.next_node_key)}</span></div>
                          ))}
                        </div>
                      )}
                      {n.node_type === "condition" && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          If {String(c.subject)} <b>{String(c.subject_key)}</b> {String(c.operator)} {c.value ? <b>“{String(c.value)}”</b> : ""} → yes {target(c.true_next)} · no {target(c.false_next)}
                        </p>
                      )}
                      {n.node_type === "set_tag" && <p className="mt-1.5 text-[11px] text-muted-foreground">{c.mode === "remove" ? "Removes" : "Adds"} tag <b>{String(c.tag_name)}</b></p>}
                      {n.node_type === "handoff" && <p className="mt-1.5 text-[11px] text-muted-foreground">{String(c.note ?? "")}</p>}
                      {nodeIssues.map((x) => <p key={x.message} className={`mt-1 text-[11px] ${x.severity === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>{x.message}</p>)}
                    </li>
                  );
                })}
              </ol>
            </div>

            <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
              <div className={`rounded-xl border p-3 text-xs ${errors.length ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}>
                <p className="flex items-center gap-1.5 font-semibold">
                  {errors.length ? <XCircle className="size-4 text-destructive" /> : <CheckCircle2 className="size-4 text-primary" />}
                  {errors.length ? `${errors.length} issue${errors.length === 1 ? "" : "s"} to fix` : "Ready to go live"}
                </p>
                <p className="mt-1 text-muted-foreground">{ordered.length} steps · validated against WhatsApp limits</p>
                {errors.filter((e) => !e.node_key).map((e) => <p key={e.message} className="mt-1 text-destructive">{e.message}</p>)}
                {warnings.length > 0 && <p className="mt-1 flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3" /> {warnings.length} suggestion{warnings.length === 1 ? "" : "s"}</p>}
              </div>
              {draft.tag_names.length > 0 && (
                <div className="rounded-xl border border-border p-3 text-xs">
                  <p className="font-semibold">Tags used</p>
                  <p className="mt-1 text-muted-foreground">Missing tags are created when you approve.</p>
                  <div className="mt-2 flex flex-wrap gap-1">{draft.tag_names.map((t) => <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{t}</span>)}</div>
                </div>
              )}
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-xs font-semibold">Ask for changes</p>
                <Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value.slice(0, 1500))} placeholder="e.g. Add an option for pricing, and ask for email before booking." className="text-xs" />
                <Button size="sm" variant="outline" onClick={() => generate(true)} disabled={generating || feedback.trim().length < 3} className="w-full gap-1.5">
                  {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Update flow
                </Button>
              </div>
            </aside>
          </div>
        )}

        {draft && (
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={Boolean(saving)}>Start over</Button>
            <Button variant="outline" onClick={() => save("edit")} disabled={Boolean(saving)} className="gap-1.5">
              {saving === "edit" ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />} Open in editor
            </Button>
            <Button variant="outline" onClick={() => save("draft")} disabled={Boolean(saving) || errors.length > 0} className="gap-1.5">
              {saving === "draft" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save as draft
            </Button>
            <Button onClick={() => save("activate")} disabled={Boolean(saving) || errors.length > 0} className="gap-1.5">
              {saving === "activate" ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />} Approve &amp; activate
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
