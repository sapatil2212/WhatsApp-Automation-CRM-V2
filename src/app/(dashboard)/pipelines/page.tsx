"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { NewPipelineDialog } from "@/components/pipelines/new-pipeline-dialog";
import { formatMoney } from "@/components/pipelines/deal-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Check, ChevronDown, Columns3, GitBranch, List, Plus, Search, Settings, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "won" | "lost">("open");
  const [view, setView] = useState<"board" | "list">("board");
  const [now] = useState(() => Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  // ── API helpers ──────────────────────────────────────────────────────────

  const loadPipelines = useCallback(async (): Promise<Pipeline[]> => {
    try {
      const res = await fetch("/api/pipelines");
      if (!res.ok) {
        console.error("Failed to load pipelines:", res.statusText);
        return [];
      }
      const { pipelines } = await res.json();
      return (pipelines ?? []).map((p: Record<string, unknown>) => ({
        ...p,
        created_at: p.createdAt ?? p.created_at,
        user_id: p.userId ?? p.user_id,
      })) as Pipeline[];
    } catch (err) {
      console.error("Failed to load pipelines:", err);
      return [];
    }
  }, []);

  const loadStages = useCallback(
    async (pipelineId: string): Promise<PipelineStage[]> => {
      try {
        const res = await fetch(`/api/pipelines/${pipelineId}/stages`);
        if (!res.ok) return [];
        const { stages } = await res.json();
        return (stages ?? []).map((s: Record<string, unknown>) => ({
          ...s,
          pipeline_id: s.pipelineId ?? s.pipeline_id,
          created_at: s.createdAt ?? s.created_at,
        })) as PipelineStage[];
      } catch {
        return [];
      }
    },
    [],
  );

  const loadDeals = useCallback(
    async (pipelineId: string): Promise<Deal[]> => {
      try {
        const res = await fetch(`/api/pipelines/${pipelineId}/deals`);
        if (!res.ok) return [];
        const { deals } = await res.json();
        return deals ?? [];
      } catch {
        return [];
      }
    },
    [],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    try {
      const res = await fetch("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Sales Pipeline", withDefaultStages: true }),
      });
      if (!res.ok) return null;
      const { pipeline } = await res.json();
      return pipeline
        ? ({
            ...pipeline,
            created_at: pipeline.createdAt ?? pipeline.created_at,
            user_id: pipeline.userId ?? pipeline.user_id,
          } as Pipeline)
        : null;
    } catch {
      return null;
    }
  }, []);

  // ── Initial load + seed-if-empty ─────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
        setStages([]);
        setDeals([]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline]);

  // ── Load stages + deals whenever selected pipeline changes ───────────────

  useEffect(() => {
    if (!selectedPipelineId) return;
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  // ── Refresh helpers ───────────────────────────────────────────────────────

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) {
      setSelectedPipelineId("");
      setStages([]);
      setDeals([]);
    } else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  // ── Deal handlers ─────────────────────────────────────────────────────────

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      try {
        const res = await fetch(`/api/deals/${dealId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage_id: newStageId }),
        });
        if (!res.ok) {
          toast.error("Failed to move deal");
          refreshDeals();
        }
      } catch {
        toast.error("Failed to move deal");
        refreshDeals();
      }
    },
    [refreshDeals],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  const visibleDeals = deals.filter((d) => {
    const st = d.status ?? "active";
    const isOpen = st !== "won" && st !== "lost";
    if (statusFilter === "open" && !isOpen) return false;
    if (statusFilter === "won" && st !== "won") return false;
    if (statusFilter === "lost" && st !== "lost") return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [d.title, d.contact?.name, d.contact?.phone, d.notes].some((v) => (v ?? "").toLowerCase().includes(q));
  });
  const stageById = new Map(stages.map((s) => [s.id, s]));

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="h-9 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-40 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-[72px] animate-pulse rounded-xl bg-muted/60" />)}
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-96 w-72 shrink-0 animate-pulse rounded-2xl bg-muted/50" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-lg text-2xl font-bold tracking-tight transition-colors hover:text-primary data-[popup-open]:text-primary">
              {selectedPipeline?.name ?? "Select pipeline"}
              <ChevronDown className="size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {pipelines.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => setSelectedPipelineId(p.id)}>
                  <GitBranch className="size-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.id === selectedPipelineId && <Check className="size-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setNewPipelineOpen(true)}><Plus className="size-3.5" /> New pipeline</DropdownMenuItem>
              {selectedPipeline && (
                <DropdownMenuItem onClick={() => setSettingsOpen(true)}><Settings className="size-3.5" /> Edit stages &amp; settings</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="mt-0.5 text-sm text-muted-foreground">Track every deal from first message to won.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedPipeline && (
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} className="gap-1.5"><Settings className="size-3.5" /> Stages</Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setNewPipelineOpen(true)} className="gap-1.5"><Sparkles className="size-3.5 text-primary" /> New pipeline</Button>
          <Button size="sm" onClick={() => handleAddDeal()} disabled={!selectedPipelineId || stages.length === 0} className="gap-1.5"><Plus className="size-3.5" /> Add deal</Button>
        </div>
      </div>

      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10"><GitBranch className="size-5 text-primary" /></span>
          <h3 className="mt-3 text-sm font-semibold">Track every deal from first message to won</h3>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">Pick a professional template or describe your process and AI designs the stages for you.</p>
          <Button size="sm" onClick={() => setNewPipelineOpen(true)} className="mt-4 gap-1.5"><Sparkles className="size-3.5" /> Create your first pipeline</Button>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={deals} />

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search deals or contacts…" className="h-8 pl-8 pr-8 text-[13px]" aria-label="Search deals" />
              {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-4" /></button>}
            </div>
            <div className="flex rounded-xl border border-border/70 bg-card p-1">
              {(["open", "won", "lost", "all"] as const).map((f) => (
                <button key={f} onClick={() => setStatusFilter(f)} aria-pressed={statusFilter === f} className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${statusFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                  {f}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{visibleDeals.length} deal{visibleDeals.length === 1 ? "" : "s"}</p>
            <div className="ml-auto flex rounded-xl border border-border/70 bg-card p-1">
              <button onClick={() => setView("board")} aria-pressed={view === "board"} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium ${view === "board" ? "bg-accent text-foreground" : "text-muted-foreground"}`}><Columns3 className="size-3.5" /> Board</button>
              <button onClick={() => setView("list")} aria-pressed={view === "list"} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium ${view === "list" ? "bg-accent text-foreground" : "text-muted-foreground"}`}><List className="size-3.5" /> List</button>
            </div>
          </div>

          {view === "board" ? (
            <PipelineBoard
              stages={stages}
              deals={visibleDeals}
              onDealMoved={handleDealMoved}
              onAddDeal={handleAddDeal}
              onEditDeal={handleEditDeal}
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[13px]">
                  <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Deal</th>
                      <th className="px-3 py-2">Contact</th>
                      <th className="px-3 py-2">Stage</th>
                      <th className="px-3 py-2 text-right">Value</th>
                      <th className="px-3 py-2">Expected close</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {visibleDeals.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">No deals match these filters.</td></tr>
                    )}
                    {visibleDeals.map((d) => {
                      const st = stageById.get(d.stage_id);
                      const isOpen = !d.status || (d.status !== "won" && d.status !== "lost");
                      const overdue = Boolean(d.expected_close_date && isOpen && new Date(d.expected_close_date).getTime() < now - 86_400_000);
                      return (
                        <tr key={d.id} onClick={() => handleEditDeal(d)} className="cursor-pointer transition-colors hover:bg-muted/50">
                          <td className="px-4 py-2 font-medium">{d.title}</td>
                          <td className="px-3 py-2 text-muted-foreground">{d.contact?.name || (d.contact?.phone ? `+${d.contact.phone}` : "—")}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-px text-[11px]"><span className="size-1.5 rounded-full" style={{ backgroundColor: st?.color }} />{st?.name ?? "—"}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(d.value, d.currency)}</td>
                          <td className={`px-3 py-3 text-xs ${overdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{d.expected_close_date ? new Date(d.expected_close_date).toLocaleDateString() : "—"}{overdue ? " · overdue" : ""}</td>
                          <td className="px-3 py-2 text-[11px] capitalize">{isOpen ? "open" : d.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <NewPipelineDialog
        open={newPipelineOpen}
        onOpenChange={setNewPipelineOpen}
        onCreated={async (id) => { setSelectedPipelineId(id); await refreshPipelines(); }}
      />

      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
