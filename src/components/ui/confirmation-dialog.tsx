"use client"

import * as React from "react"
import { AlertTriangle, HelpCircle, Loader2, Trash2, X } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ConfirmationDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** One short sentence: what happens. */
  description: string
  /** What the action applies to (patient, date, item name), shown in a highlighted box. */
  details?: React.ReactNode
  /** Extra consequences, one per line (e.g. "The patient is not notified."). */
  notes?: string[]
  confirmText?: string
  cancelText?: string
  onConfirm: () => void | Promise<void>
  variant?: "default" | "destructive"
  /** Destructive icon: a bin for deletes (default), a warning for other risky actions. */
  icon?: "delete" | "warning"
}

/**
 * Shared confirm dialog. Theme tokens only, so it reads correctly in light
 * and dark mode. Layout: icon + title + description, optional details box and
 * notes, then a separated footer with right-aligned actions (stacked on mobile).
 */
export function ConfirmationDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  details,
  notes,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  variant = "default",
  icon = "delete",
}: ConfirmationDialogProps) {
  const [loading, setLoading] = React.useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const destructive = variant === "destructive"
  const Icon = destructive ? (icon === "warning" ? AlertTriangle : Trash2) : HelpCircle

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!loading) onOpenChange(o) }}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden rounded-2xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl sm:max-w-[440px]"
      >
        <div className="relative px-5 pb-4 pt-5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            aria-label="Close"
            className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>

          <div className="flex items-start gap-3 pr-6">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                destructive ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
              )}
            >
              <Icon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <DialogTitle className="text-[15px] font-semibold leading-snug text-foreground">{title}</DialogTitle>
              <DialogDescription className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {description}
              </DialogDescription>
            </div>
          </div>

          {details && (
            <div className="mt-4 rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5 text-[13px] text-foreground">
              {details}
            </div>
          )}

          {notes && notes.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {notes.map((n) => (
                <li key={n} className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
                  <span
                    aria-hidden
                    className={cn("mt-[7px] size-1 shrink-0 rounded-full", destructive ? "bg-destructive/70" : "bg-primary/70")}
                  />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border/70 bg-muted/30 px-5 py-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => onOpenChange(false)} className="sm:min-w-20">
            {cancelText}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading}
            onClick={handleConfirm}
            className={cn(
              "gap-1.5 sm:min-w-24",
              destructive && "bg-destructive text-[#ffffff] hover:bg-destructive/90 focus-visible:ring-destructive/40",
            )}
          >
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            {loading ? "Please wait…" : confirmText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
