/**
 * Standard page-level loading state. Every dashboard page uses this instead
 * of a centred spinner so loading looks the same everywhere.
 */
export function PageSkeleton({ variant = 'table' }: { variant?: 'table' | 'cards' | 'detail' }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="h-7 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted/70" />
        </div>
        <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
      </div>
      {variant !== 'detail' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/60" />)}
        </div>
      )}
      {variant === 'cards' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted/50" />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          <div className="h-11 animate-pulse bg-muted/60" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-t border-border/60 px-4 py-3">
              <div className="size-8 animate-pulse rounded-full bg-muted" />
              <div className="h-4 flex-1 animate-pulse rounded bg-muted/70" />
              <div className="h-4 w-24 animate-pulse rounded bg-muted/70" />
              <div className="h-4 w-16 animate-pulse rounded bg-muted/50" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
