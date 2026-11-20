"use client";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
  Copy,
  Zap,
  CalendarClock,
  BedDouble,
  GraduationCap,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RoutingModeCard } from "@/components/flows/routing-mode-card";
import { AiFlowBuilder } from "@/components/flows/ai-flow-builder";
import { apiErrorMessage, flowFromDto, unwrap, type FlowDtoLike } from "@/lib/flows/client";

/**
 * Flows list page.
 *
 * Open to every authenticated user. Lists the account's flows, lets you
 * create from a (business-tailored) template or from scratch, activate /
 * pause a flow inline, and configure how inbound messages are routed
 * between Flows and the AI assistant.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<FlowRow["status"], string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

const STATUS_COLORS: Record<FlowRow["status"], string> = {
  draft: "border-border bg-muted text-foreground/90",
  active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  archived: "border-border bg-muted/60 text-muted-foreground",
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon:
    | "MessageSquare"
    | "HelpCircle"
    | "UserPlus"
    | "CalendarClock"
    | "FileText"
    | "BedDouble"
    | "GraduationCap";
  trigger_type: string;
  node_count: number;
  recommended?: boolean;
  generic?: boolean;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
  CalendarClock,
  FileText,
  BedDouble,
  GraduationCap,
} as const;

export default function FlowsPage() {
  const router = useRouter();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowsRes, tmplRes] = await Promise.all([
          fetch("/api/flows"),
          fetch("/api/flows/templates"),
        ]);
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowDtos = unwrap<FlowDtoLike[]>(await flowsRes.json()) ?? [];
        if (!cancelled) setFlows(flowDtos.map(flowFromDto));
        // Templates endpoint is forward-looking — if it 404s on an
        // older deployment, gracefully fall through.
        if (tmplRes.ok) {
          const gallery = unwrap<{ templates: Array<Record<string, unknown>> }>(await tmplRes.json());
          if (!cancelled) {
            setTemplates(
              (gallery?.templates ?? []).map((t) => ({
                ...(t as unknown as TemplateSummary),
                trigger_type: String(t.triggerType ?? t.trigger_type ?? ''),
                node_count: Number(t.nodeCount ?? t.node_count ?? 0),
              })),
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load flows.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          triggerType: "keyword",
          triggerConfig: { keywords: [] },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, `Create failed: ${res.status}`));
      setCreateOpen(false);
      setNewName("");
      router.push(`/flows/${unwrap<{ id: string }>(json).id}`);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't create flow.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch(`/api/flows?template=${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, `Clone failed: ${res.status}`));
      setCreateOpen(false);
      router.push(`/flows/${unwrap<{ id: string }>(json).id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Clone failed";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDuplicate(flow: FlowRow) {
    try {
      const res = await fetch(`/api/flows/${flow.id}/duplicate`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, `Duplicate failed: ${res.status}`));
      setFlows((prev) => [flowFromDto(unwrap<FlowDtoLike>(json)), ...prev]);
      toast.success("Flow duplicated.");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't duplicate flow.");
    }
  }

  async function handleToggleStatus(flow: FlowRow) {
    const next = flow.status === "active" ? "draft" : "active";
    try {
      const res = await fetch(`/api/flows/${flow.id}/activate`, {
        method: next === "active" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: next === "active" ? undefined : JSON.stringify({ status: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 422 = validation blockers; send the user to the editor to fix them.
        if (res.status === 422) {
          toast.error(
            "This flow has issues to fix before it can go live. Opening the editor…",
          );
          router.push(`/flows/${flow.id}`);
          return;
        }
        throw new Error(apiErrorMessage(json, `Status update failed: ${res.status}`));
      }
      setFlows((prev) =>
        prev.map((f) => (f.id === flow.id ? { ...f, status: next } : f)),
      );
      toast.success(next === "active" ? "Flow activated." : "Flow paused.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status update failed");
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(
      `Delete "${flow.name}"? Any active runs will end immediately.`,
    );
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success("Flow deleted.");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't delete flow.");
    }
  }

  if (loading) return <PageSkeleton variant="cards" />;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Flows</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Design automated, button-driven WhatsApp conversations — welcome
            menus, bookings, FAQs, and lead capture — that guide customers and
            hand off to your team at the right moment.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New flow
        </Button>
        <Button onClick={() => setAiOpen(true)} className="gap-1.5">
          <Sparkles className="h-4 w-4" />
          Build with AI
        </Button>
        </div>
      </header>

      <button
        type="button"
        onClick={() => setAiOpen(true)}
        className="group flex w-full items-center gap-4 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 text-left transition-shadow hover:shadow-md"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">Describe it — AI builds the whole flow</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Menus, questions, branches, tags and hand-offs, checked against WhatsApp limits. You review and approve before it goes live.
          </span>
        </span>
        <span className="hidden shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-transform group-hover:translate-x-0.5 sm:block">Start with AI →</span>
      </button>

      <RoutingModeCard />

      {flows.length > 0 && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Your flows{" "}
            <span className="font-normal text-muted-foreground">({flows.length})</span>
          </h2>
        </div>
      )}

      {flows.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          templates={templates}
          onUseTemplate={handleUseTemplate}
          creating={creating}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => router.push(`/flows/${flow.id}`)}
              onDelete={() => handleDelete(flow)}
              onDuplicate={() => handleDuplicate(flow)}
              onToggleStatus={() => handleToggleStatus(flow)}
            />
          ))}
        </div>
      )}

      <AiFlowBuilder open={aiOpen} onOpenChange={setAiOpen} onCreated={() => setReloadKey((k) => k + 1)} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        <DialogContent className="sm:max-w-4xl bg-card text-foreground/90">
          <DialogHeader>
            <DialogTitle>Create a new flow</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Start from a template or build from scratch.
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {templates.some((t) => t.recommended)
                  ? "Recommended for your business"
                  : "Start from a template"}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.icon] ?? FileText;
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => handleUseTemplate(t.slug)}
                      disabled={creating}
                      className={cn(
                        "relative flex flex-col gap-2.5 rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent disabled:opacity-50",
                        t.recommended
                          ? "border-primary/50 hover:border-primary"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      {t.recommended && (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                          <Sparkles className="h-2.5 w-2.5" />
                          For you
                        </span>
                      )}
                      <Icon className="h-5 w-5 text-primary" />
                      <span className="text-sm font-semibold text-foreground">
                        {t.name}
                      </span>
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {t.description}
                      </span>
                      <span className="mt-auto border-t border-border pt-2 text-[11px] text-muted-foreground">
                        {t.node_count} {t.node_count === 1 ? "node" : "nodes"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Or start blank
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Welcome menu"
              className="bg-muted"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create blank flow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  onCreate,
  templates,
  onUseTemplate,
  creating,
}: {
  onCreate: () => void;
  templates: TemplateSummary[];
  onUseTemplate: (slug: string) => void;
  creating: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Workflow className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-medium text-foreground">
        No flows yet
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Build your first conversation — a welcome menu, an order lookup, an FAQ
        bot. Customers tap buttons; the bot routes them to the right answer (or
        the right agent).
      </p>

      {templates.length > 0 && (
        <div className="mt-6 w-full max-w-2xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Zap className="mr-1 inline h-3 w-3" />
            Quick start from a template
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {templates.map((t) => {
              const Icon = TEMPLATE_ICONS[t.icon] ?? FileText;
              return (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => onUseTemplate(t.slug)}
                  disabled={creating}
                  className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background p-4 text-center transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-50"
                >
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">
                    {t.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t.node_count} nodes
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        <Button onClick={onCreate}>
          <Plus className="h-4 w-4" />
          Create blank flow
        </Button>
      </div>
    </div>
  );
}

function FlowCard({
  flow,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleStatus,
}: {
  flow: FlowRow;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleStatus: () => void;
}) {
  const triggerSummary = describeTrigger(flow);
  const StatusIcon =
    flow.status === "active"
      ? PlayCircle
      : flow.status === "archived"
        ? Archive
        : PauseCircle;
  const isActive = flow.status === "active";
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {flow.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 gap-1 text-[10px]",
            STATUS_COLORS[flow.status],
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {STATUS_LABELS[flow.status]}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {flow.description || triggerSummary}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {flow.execution_count} {flow.execution_count === 1 ? "run" : "runs"}
        </span>
        <span className="inline-flex items-center gap-1 truncate">
          <Zap className="h-3 w-3" />
          <span className="truncate">{triggerSummary}</span>
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        {flow.status !== "archived" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleStatus}
            className={cn(
              "gap-1.5",
              isActive
                ? "border-amber-600/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                : "border-emerald-600/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10",
            )}
          >
            {isActive ? (
              <>
                <PauseCircle className="h-3.5 w-3.5" />
                Pause
              </>
            ) : (
              <>
                <PlayCircle className="h-3.5 w-3.5" />
                Activate
              </>
            )}
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">Archived</span>
        )}

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDuplicate}
            title="Duplicate flow"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            title="Delete flow"
            className="text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function describeTrigger(flow: FlowRow): string {
  if (flow.trigger_type === "keyword") {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return "Triggers on keyword (none set)";
    return `Triggers on: ${keywords.join(", ")}`;
  }
  if (flow.trigger_type === "first_inbound_message") {
    return "Triggers on a contact's first-ever inbound message";
  }
  return "Manual trigger";
}
