import type { BroadcastStatus } from './api';

export const STATUS_STYLE: Record<BroadcastStatus, { label: string; cls: string; dot: string }> = {
  draft: { label: 'Draft', cls: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
  scheduled: { label: 'Scheduled', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20', dot: 'bg-sky-500' },
  sending: { label: 'Sending', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20', dot: 'bg-amber-500 animate-pulse' },
  paused: { label: 'Paused', cls: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20', dot: 'bg-orange-500' },
  sent: { label: 'Completed', cls: 'bg-primary/10 text-primary border-primary/20', dot: 'bg-primary' },
  failed: { label: 'Failed', cls: 'bg-destructive/10 text-destructive border-destructive/20', dot: 'bg-destructive' },
  cancelled: { label: 'Cancelled', cls: 'bg-muted text-muted-foreground border-border line-through decoration-muted-foreground/40', dot: 'bg-muted-foreground/60' },
};
