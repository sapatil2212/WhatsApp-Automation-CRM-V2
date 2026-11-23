"use client"

import { use, useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, Loader2, Minus, RefreshCw, X, ChevronDown, ChevronRight, Pause } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/automations/trigger-meta"
import {
  getAutomation,
  listAutomationLogs,
  type AutomationLogEntry,
  type AutomationLogStep,
  type AutomationSummary,
} from "@/lib/automations/client"

const STEP_LABEL: Record<string, string> = {
  send_message: "Send message",
  send_template: "Send template",
  add_tag: "Add tag",
  remove_tag: "Remove tag",
  assign_conversation: "Assign conversation",
  close_conversation: "Close conversation",
  update_contact_field: "Update contact field",
  create_deal: "Create deal",
  send_webhook: "Send webhook",
  wait: "Wait",
  condition: "Condition",
}
const stepLabel = (t: string) => STEP_LABEL[t] ?? t.replace(/_/g, " ")

export default function AutomationLogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [automation, setAutomation] = useState<AutomationSummary | null>(null)
  const [logs, setLogs] = useState<AutomationLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openLogId, setOpenLogId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const [a, l] = await Promise.all([getAutomation(id), listAutomationLogs(id)])
      setAutomation(a)
      setLogs(l)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs")
    } finally {
      setRefreshing(false)
    }
  }, [id])

  useEffect(() => {
    // Initial fetch; state is only set after the requests resolve.
    void load()
  }, [load])

  if (error && !logs) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <p className="text-sm">{error}</p>
        <Button size="sm" variant="outline" onClick={() => router.push("/automations")}>
          Back
        </Button>
      </div>
    )
  }

  if (!automation || logs === null) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/automations")} aria-label="Back to automations">
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{automation.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Execution logs · last 100 runs</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} /> Refresh
        </Button>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm font-semibold">No executions yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Runs appear here once the trigger fires for a contact.</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card divide-y divide-border/60">
          {logs.map((log) => {
            const isOpen = openLogId === log.id
            return (
              <li key={log.id}>
                <button
                  type="button"
                  onClick={() => setOpenLogId(isOpen ? null : log.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
                >
                  {isOpen ? (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  )}
                  <StatusBadge status={log.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {log.contact?.name || (log.contact?.phone ? `+${log.contact.phone}` : "Unknown contact")}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {log.triggerEvent.replace(/_/g, " ")} · {log.stepsExecuted.length} step
                      {log.stepsExecuted.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(log.createdAt)}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-border/60 bg-muted/20 px-4 py-3">
                    {log.errorMessage && (
                      <p className="mb-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                        {log.errorMessage}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {log.stepsExecuted.map((r, i) => (
                        <StepRow key={i} result={r} />
                      ))}
                      {log.stepsExecuted.length === 0 && (
                        <li className="text-[11px] text-muted-foreground">No steps recorded.</li>
                      )}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: AutomationLogEntry["status"] }) {
  const classes =
    status === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "partial"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
  return (
    <span className={cn("inline-flex w-16 shrink-0 items-center justify-center rounded-full border px-2 py-px text-[10px] font-medium capitalize", classes)}>
      {status}
    </span>
  )
}

function StepRow({ result }: { result: AutomationLogStep }) {
  const tone =
    result.status === "success"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : result.status === "failed"
        ? "bg-red-500/15 text-red-600 dark:text-red-400"
        : "bg-muted text-muted-foreground"
  const Icon = result.status === "success" ? Check : result.status === "failed" ? X : result.status === "parked" ? Pause : Minus
  return (
    <li className="flex items-start gap-2 text-[12px]">
      <span className={cn("mt-px flex size-4 shrink-0 items-center justify-center rounded-full", tone)} aria-hidden>
        <Icon className="size-2.5" />
      </span>
      <span className="font-medium">{stepLabel(result.stepType)}</span>
      {result.branchChosen && <span className="text-muted-foreground">→ {result.branchChosen}</span>}
      {result.status === "parked" && <span className="text-muted-foreground">waiting</span>}
      {result.status === "skipped" && <span className="text-muted-foreground">skipped</span>}
      {result.error && <span className="truncate text-destructive">— {result.error}</span>}
    </li>
  )
}
