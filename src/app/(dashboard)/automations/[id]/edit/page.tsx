"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import {
  AutomationBuilder,
  fromServerSteps,
  type BuilderInitial,
  type ServerStepNode,
} from "@/components/automations/automation-builder"
import { getAutomation } from "@/lib/automations/client"
import type { AutomationTriggerType } from "@/types"

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [initial, setInitial] = useState<BuilderInitial | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const a = await getAutomation(id)
        if (cancelled) return
        setInitial({
          id: a.id,
          name: a.name ?? "",
          description: a.description ?? "",
          trigger_type: a.triggerType as AutomationTriggerType,
          trigger_config: a.triggerConfig ?? {},
          is_active: a.isActive,
          steps: fromServerSteps(a.steps as ServerStepNode[]),
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load automation")
      }
    }    load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => router.push("/automations")}
          className="text-sm text-primary hover:text-primary/80"
        >
          Back to Automations
        </button>
      </div>
    )
  }

  if (!initial) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return <AutomationBuilder initial={initial} />
}
