"use client";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  CircleCheck,
  CircleAlert,
  Clock,
  UserPlus,
  PlayCircle,
  PauseCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { unwrap } from "@/lib/flows/client";
import { cn } from "@/lib/utils";

/**
 * Run history viewer.
 *
 * Lists the 50 most recent runs for a flow, newest first. Each row
 * collapses to a one-liner (contact + status + time); expanding shows
 * the full `flow_run_events` timeline for that run — useful for
 * debugging "why didn't my flow advance?" by surfacing the engine's
 * own log.
 */

interface RunRow {
  id: string;
  status:
    | "active"
    | "completed"
    | "handed_off"
    | "timed_out"
    | "paused_by_agent"
    | "failed";
  current_node_key: string | null;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  contact: { id: string; name: string | null; phone: string } | null;
}

/** API shapes (camelCase, standard envelope). */
interface RunDto {
  id: string;
  status: RunRow["status"];
  currentNodeKey: string | null;
  startedAt: string;
  lastAdvancedAt: string;
  endedAt: string | null;
  endReason: string | null;
  vars: Record<string, unknown>;
  repromptCount: number;
  contact: { id: string; name: string | null; phone: string } | null;
}
interface EventDto {
  id: string;
  eventType: string;
  nodeKey: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

const runFromDto = (r: RunDto): RunRow => ({
  id: r.id,
  status: r.status,
  current_node_key: r.currentNodeKey,
  started_at: r.startedAt,
  last_advanced_at: r.lastAdvancedAt,
  ended_at: r.endedAt,
  end_reason: r.endReason,
  vars: r.vars ?? {},
  reprompt_count: r.repromptCount ?? 0,
  contact: r.contact,
});

const eventFromDto = (runId: string, e: EventDto): EventRow => ({
  flow_run_id: runId,
  event_type: e.eventType,
  node_key: e.nodeKey,
  payload: e.payload ?? {},
  created_at: e.createdAt,
});

interface EventRow {
  flow_run_id: string;
  event_type: string;
  node_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const STATUS_META: Record<
  RunRow["status"],
  { label: string; classes: string; icon: typeof Clock }
> = {
  active: {
    label: "Active",
    classes: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: PlayCircle,
  },
  completed: {
    label: "Completed",
    classes: "border-border bg-muted text-foreground/90",
    icon: CircleCheck,
  },
  handed_off: {
    label: "Handed off",
    classes: "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: UserPlus,
  },
  timed_out: {
    label: "Timed out",
    classes: "border-border bg-muted text-muted-foreground",
    icon: Clock,
  },
  paused_by_agent: {
    label: "Paused by agent",
    classes: "border-border bg-muted text-foreground/90",
    icon: PauseCircle,
  },
  failed: {
    label: "Failed",
    classes: "border-red-600/40 bg-red-500/10 text-red-700 dark:text-red-300",
    icon: CircleAlert,
  },
};

export default function FlowRunsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [flow, setFlow] = useState<{ id: string; name: string } | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  // Events load when a run is expanded: null = not loaded, "loading", or the list.
  const [events, setEvents] = useState<Record<string, EventRow[] | "loading" | "error">>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [flowRes, runsRes] = await Promise.all([
          fetch(`/api/flows/${params.id}`),
          fetch(`/api/flows/${params.id}/runs?pageSize=50`),
        ]);
        if (flowRes.status === 404 || runsRes.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!flowRes.ok || !runsRes.ok) throw new Error(`Failed: ${flowRes.status}/${runsRes.status}`);
        const flowDto = unwrap<{ id: string; name: string }>(await flowRes.json());
        const runDtos = unwrap<RunDto[]>(await runsRes.json()) ?? [];
        if (!cancelled) {
          setFlow({ id: flowDto.id, name: flowDto.name });
          setRuns(runDtos.map(runFromDto));
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load runs.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function loadEvents(runId: string) {
    setEvents((prev) => ({ ...prev, [runId]: "loading" }));
    try {
      const res = await fetch(`/api/flows/${params.id}/runs/${runId}/events`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const list = unwrap<EventDto[]>(await res.json()) ?? [];
      // The API returns newest first; a timeline reads oldest first.
      const ordered = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setEvents((prev) => ({ ...prev, [runId]: ordered.map((e) => eventFromDto(runId, e)) }));
    } catch (err) {
      console.error(err);
      setEvents((prev) => ({ ...prev, [runId]: "error" }));
    }
  }

  function toggle(runId: string) {
    const opening = !expanded.has(runId);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
    const current = events[runId];
    if (opening && (current === undefined || current === "error")) void loadEvents(runId);
  }

  if (loading) return <PageSkeleton variant="table" />;
  if (notFound || !flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Flow not found.</p>
        <button
          type="button"
          onClick={() => router.push("/flows")}
          className="text-sm text-primary hover:opacity-80"
        >
          ← Back to flows
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <button
        type="button"
        onClick={() => router.push(`/flows/${flow.id}`)}
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {flow.name}
      </button>
      <h1 className="text-xl font-semibold text-foreground">Runs</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The 50 most recent times this flow ran. Expand a row to see the engine&apos;s
        per-step log.
      </p>

      {runs.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-12 text-center text-sm text-muted-foreground">
          No runs yet. Trigger the flow from a personal WhatsApp number to see
          it appear here.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              events={events[run.id]}
              expanded={expanded.has(run.id)}
              onToggle={() => toggle(run.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({
  run,
  events,
  expanded,
  onToggle,
}: {
  run: RunRow;
  events: EventRow[] | "loading" | "error" | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = STATUS_META[run.status];
  const StatusIcon = meta.icon;
  const contactLabel =
    run.contact?.name?.trim() || run.contact?.phone || "Unknown contact";
  const duration = run.ended_at
    ? formatDistanceToNow(new Date(run.ended_at), {
        addSuffix: false,
      })
    : null;
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {contactLabel}
            </span>
            <Badge variant="outline" className={cn("gap-1", meta.classes)}>
              <StatusIcon className="h-3 w-3" />
              {meta.label}
            </Badge>
            {run.status === "active" && run.current_node_key && (
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                at {run.current_node_key}
              </code>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>Started {format(new Date(run.started_at), "PP p")}</span>
            {run.reprompt_count > 0 && (
              <span>· {run.reprompt_count} re-prompts</span>
            )}
            {duration && <span>· ran for {duration}</span>}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {Object.keys(run.vars).length > 0 && (
            <details className="mb-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Captured vars ({Object.keys(run.vars).length})
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2 text-[11px] text-foreground/90">
                {JSON.stringify(run.vars, null, 2)}
              </pre>
            </details>
          )}
          <div className="flex flex-col gap-1">
            {events === undefined || events === "loading" ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading the step log…
              </p>
            ) : events === "error" ? (
              <p className="text-xs text-destructive">Couldn&apos;t load this run&apos;s log. Collapse and expand to retry.</p>
            ) : events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No events recorded for this run.
              </p>
            ) : (
              events.map((ev, ix) => <EventLine key={ix} ev={ev} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EVENT_COLOR: Record<string, string> = {
  started: "text-emerald-700 dark:text-emerald-300",
  node_entered: "text-foreground/90",
  message_sent: "text-sky-700 dark:text-sky-300",
  reply_received: "text-primary",
  fallback_fired: "text-amber-700 dark:text-amber-300",
  handoff: "text-amber-700 dark:text-amber-300",
  timeout: "text-muted-foreground",
  error: "text-red-700 dark:text-red-300",
  completed: "text-emerald-700 dark:text-emerald-300",
};

function EventLine({ ev }: { ev: EventRow }) {
  const cls = EVENT_COLOR[ev.event_type] ?? "text-muted-foreground";
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1 text-xs">
      <span className="w-32 shrink-0 text-[10px] text-muted-foreground">
        {format(new Date(ev.created_at), "HH:mm:ss")}
      </span>
      <span className={cn("w-32 shrink-0 font-mono text-[10px]", cls)}>
        {ev.event_type}
      </span>
      {ev.node_key && (
        <code className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
          {ev.node_key}
        </code>
      )}
      {Object.keys(ev.payload).length > 0 && (
        <span className="min-w-0 truncate text-[10px] text-muted-foreground">
          {summarizePayload(ev.payload)}
        </span>
      )}
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  // Show the keys that matter most to a human debugger; full JSON is
  // available via the "Captured vars" details panel for the run.
  const keys = ["reply_id", "replyId", "captured_key", "capturedKey", "reason", "detail", "advancing_to", "advancingTo", "nodeType"];
  for (const k of keys) {
    if (k in payload && payload[k] !== null && payload[k] !== undefined) {
      return `${k}=${String(payload[k]).slice(0, 80)}`;
    }
  }
  return "";
}
