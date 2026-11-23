"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Zap,
  Plus,
  Copy,
  Pencil,
  Trash2,
  FileText,
  MessageCircle,
  Clock,
  Users,
  PhoneCall,
  Loader2,
  Calendar,
  ChevronDown,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AUTOMATION_TEMPLATES, type TemplateSlug } from "@/lib/automations/templates"
import { triggerMeta, formatRelative } from "@/lib/automations/trigger-meta"
import {
  deleteAutomation,
  duplicateAutomation,
  firstIssue,
  listAutomations,
  setAutomationActive,
  type AutomationSummary,
} from "@/lib/automations/client"
import { cn } from "@/lib/utils"

const TEMPLATE_ORDER: TemplateSlug[] = [
  "welcome_message",
  "appointment_booking",
  "out_of_office",
  "lead_qualifier",
  "follow_up_reminder",
]

const TEMPLATE_ICON: Record<TemplateSlug, typeof Zap> = {
  welcome_message: MessageCircle,
  appointment_booking: Calendar,
  out_of_office: Clock,
  lead_qualifier: Users,
  follow_up_reminder: PhoneCall,
}

export default function AutomationsPage() {
  const router = useRouter()
  const [automations, setAutomations] = useState<AutomationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AutomationSummary | null>(null)

  const load = useCallback(async () => {
    try {
      setAutomations(await listAutomations())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations")
    }
  }, [])

  useEffect(() => {
    // Initial fetch; load() only sets state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function toggleActive(a: AutomationSummary, next: boolean) {
    // Optimistic flip so the switch feels instant; the server decides.
    setAutomations((prev) => prev?.map((x) => (x.id === a.id ? { ...x, isActive: next } : x)) ?? prev)
    try {
      await setAutomationActive(a.id, next)
      toast.success(next ? "Automation activated" : "Automation paused")
    } catch (err) {
      setAutomations((prev) => prev?.map((x) => (x.id === a.id ? { ...x, isActive: !next } : x)) ?? prev)
      const issue = firstIssue(err)
      toast.error(issue?.message ?? (err instanceof Error ? err.message : "Failed to update"), {
        description: issue?.path ? `at ${issue.path}` : undefined,
      })
    }
  }

  async function duplicate(a: AutomationSummary) {
    try {
      await duplicateAutomation(a.id)
      toast.success("Automation duplicated")
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate")
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    try {
      await deleteAutomation(pendingDelete.id)
      toast.success("Automation deleted")
      setAutomations((prev) => prev?.filter((x) => x.id !== pendingDelete.id) ?? prev)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete")
      throw err
    }
  }

  if (error && automations === null) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <XCircle className="size-6 text-destructive" />
        <p className="text-sm">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    )
  }

  if (automations === null) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  const activeCount = automations.filter((a) => a.isActive).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Automations</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Workflows that react to WhatsApp events automatically.
            {automations.length > 0 && (
              <span className="ml-1.5 text-[11px]">
                · {activeCount} active of {automations.length}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
              Start from template <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              {TEMPLATE_ORDER.map((slug) => {
                const t = AUTOMATION_TEMPLATES[slug]
                if (!t) return null
                const Icon = TEMPLATE_ICON[slug] || Zap
                return (
                  <DropdownMenuItem
                    key={slug}
                    onClick={() => router.push(`/automations/new?template=${slug}`)}
                    className="items-start gap-2.5"
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{t.name}</span>
                      <span className="line-clamp-2 block text-[11px] text-muted-foreground">{t.description}</span>
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => router.push("/automations/new")} className="gap-1.5">
            <Plus className="size-3.5" /> New automation
          </Button>
        </div>
      </div>

      {automations.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
            <Zap className="size-5 text-primary" />
          </span>
          <p className="mt-3 text-sm font-semibold">No automations yet</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Start from a ready-made template or build one from scratch.
          </p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => router.push("/automations/new")} className="gap-1.5">
              <Plus className="size-3.5" /> New automation
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push("/automations/new?template=welcome_message")}
            >
              Use welcome template
            </Button>
          </div>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card divide-y divide-border/60">
          {automations.map((a) => (
            <AutomationRow
              key={a.id}
              automation={a}
              onToggle={(next) => void toggleActive(a, next)}
              onEdit={() => router.push(`/automations/${a.id}/edit`)}
              onDuplicate={() => void duplicate(a)}
              onLogs={() => router.push(`/automations/${a.id}/logs`)}
              onDelete={() => setPendingDelete(a)}
            />
          ))}
        </ul>
      )}

      <ConfirmationDialog
        isOpen={Boolean(pendingDelete)}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null)
        }}
        title={`Delete “${pendingDelete?.name ?? ""}”?`}
        description="This permanently removes the automation and its execution history. Contacts waiting in a delay step will not continue. This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function AutomationRow({
  automation,
  onToggle,
  onEdit,
  onDuplicate,
  onLogs,
  onDelete,
}: {
  automation: AutomationSummary
  onToggle: (next: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onLogs: () => void
  onDelete: () => void
}) {
  const meta = triggerMeta(automation.triggerType)
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          automation.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        <Zap className="size-4" />
      </span>

      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] font-semibold">{automation.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className={cn("inline-flex items-center rounded-full border px-2 py-px text-[10px] font-medium", meta.pillClass)}>
            {meta.label}
          </span>
          <span>
            {automation.stepCount} step{automation.stepCount === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {automation.executionCount} run{automation.executionCount === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <span>last {formatRelative(automation.lastExecutedAt)}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <Switch
          checked={automation.isActive}
          onCheckedChange={(v) => onToggle(!!v)}
          aria-label={automation.isActive ? "Pause automation" : "Activate automation"}
        />
        <Button variant="ghost" size="icon-sm" className="ml-1 text-muted-foreground hover:text-primary" title="Edit" aria-label={`Edit ${automation.name}`} onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Execution logs" aria-label={`Logs for ${automation.name}`} onClick={onLogs}>
          <FileText className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Duplicate" aria-label={`Duplicate ${automation.name}`} onClick={onDuplicate}>
          <Copy className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete ${automation.name}`} onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  )
}
