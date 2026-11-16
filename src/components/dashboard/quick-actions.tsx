"use client"

import Link from 'next/link'
import { UserPlus, Briefcase, Zap } from 'lucide-react'
import type { ComponentType } from 'react'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  tint: string
}

const ACTIONS: Action[] = [
  { label: 'New Contact', href: '/contacts', icon: UserPlus, tint: 'text-primary' },
  { label: 'New Deal', href: '/pipelines', icon: Briefcase, tint: 'text-teal-400' },
  { label: 'New Automation', href: '/automations/new', icon: Zap, tint: 'text-primary' },
]

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-card/60 px-3 py-2 shadow-xs transition-all hover:border-border hover:bg-accent/60"
          >
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/70 ${a.tint}`}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <span className="truncate text-xs font-medium text-foreground">{a.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
