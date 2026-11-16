import { cn } from '@/lib/utils'

/**
 * Shared skeleton primitive — a pulsing slate block sized to whatever
 * container it's dropped into. Used by every dashboard widget while
 * its data fetches.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border/70 bg-card/60 p-4 shadow-xs', className)}>
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="mt-3 h-7 w-20" />
      <Skeleton className="mt-2 h-2.5 w-16" />
    </div>
  )
}
