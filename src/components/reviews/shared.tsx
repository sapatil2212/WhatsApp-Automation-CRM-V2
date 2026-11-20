'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/campaigns/api';
import { cn } from '@/lib/utils';

// ── types (mirror the review API) ─────────────────────────────────────

export interface ReviewBusiness {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  address: string | null;
  googleReviewUrl: string | null;
  website: string | null;
  phone: string | null;
  logoUrl: string | null;
  services: string[];
  defaultLanguage: string;
  status: 'active' | 'inactive';
  publicToken: string;
  createdAt: string;
  qrCount?: number;
  campaignCount?: number;
}

export interface ReviewCampaign {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused';
  businessId: string;
  business: { id: string; name: string };
  qrCount: number;
  createdAt: string;
}

export interface ReviewQr {
  id: string;
  label: string;
  placement: string | null;
  token: string;
  url: string;
  fgColor: string;
  bgColor: string;
  includeLogo: boolean;
  status: string;
  createdAt: string;
  business: { id: string; name: string; hasLogo: boolean };
  campaign: { id: string; name: string } | null;
  scans: number;
}

// ── data hook ────────────────────────────────────────────────────────

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData((await api<T>(path)).data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

// ── layout bits ──────────────────────────────────────────────────────

export const REVIEW_TABS = [
  { href: '/reviews', label: 'Overview' },
  { href: '/reviews/businesses', label: 'Businesses' },
  { href: '/reviews/campaigns', label: 'Review Campaigns' },
  { href: '/reviews/qr-codes', label: 'QR Codes' },
  { href: '/reviews/jobs', label: 'Automation Jobs' },
  { href: '/reviews/analytics', label: 'Analytics' },
  { href: '/reviews/settings', label: 'Settings' },
];

export function ReviewTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px" aria-label="Reviews">
      {REVIEW_TABS.map((t) => {
        const active = t.href === '/reviews' ? pathname === '/reviews' : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={cn('whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors', active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-border/70 bg-card', className)}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="px-3 py-2.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-none tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-xs text-destructive" role="alert">
      <span>{message}</span>
      {onRetry && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded-md bg-muted/70" />)}
    </div>
  );
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'green' | 'amber' | 'red' | 'sky' }) {
  const cls = {
    muted: 'bg-muted text-muted-foreground',
    green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    red: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
    sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  }[tone];
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium', cls)}>{children}</span>;
}

export function Modal({ title, subtitle, onClose, busy, children, wide }: { title: string; subtitle?: string; onClose: () => void; busy?: boolean; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={cn('w-full rounded-xl bg-popover p-5 shadow-2xl ring-1 ring-foreground/10', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close" className="size-7" onClick={onClose} disabled={busy}><X className="size-4" /></Button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputCls = 'h-8 text-xs md:text-xs';
export const selectCls = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

export function SmallInput(props: React.ComponentProps<typeof Input>) {
  return <Input {...props} className={cn(inputCls, props.className)} />;
}

export function BusinessPicker({ value, onChange, allowAll = true, className }: { value: string; onChange: (id: string) => void; allowAll?: boolean; className?: string }) {
  const { data } = useApi<ReviewBusiness[]>('/api/reviews/businesses');
  return (
    <select aria-label="Business" className={cn(selectCls, 'w-auto min-w-[180px]', className)} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">All businesses</option>}
      {!allowAll && <option value="">Select a business…</option>}
      {(data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtMs = (ms: number | null | undefined) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Tiny dependency-free bar chart. */
export function Bars({ rows, keys, height = 140 }: { rows: Array<Record<string, number | string>>; keys: Array<{ key: string; label: string; cls: string }>; height?: number }) {
  if (!rows.length) return <p className="py-8 text-center text-xs text-muted-foreground">No activity in this period.</p>;
  const max = Math.max(1, ...rows.flatMap((r) => keys.map((k) => Number(r[k.key]) || 0)));
  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height }}>
        {rows.map((r) => (
          <div key={String(r.period)} className="flex min-w-[18px] flex-1 items-end justify-center gap-px" title={`${r.period}: ${keys.map((k) => `${k.label} ${r[k.key]}`).join(', ')}`}>
            {keys.map((k) => (
              <div key={k.key} className={cn('w-full max-w-[10px] rounded-t-sm', k.cls)} style={{ height: `${Math.max(2, ((Number(r[k.key]) || 0) / max) * (height - 8))}px` }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{String(rows[0].period)}</span><span>{String(rows[rows.length - 1].period)}</span></div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        {keys.map((k) => <span key={k.key} className="flex items-center gap-1"><span className={cn('size-2 rounded-sm', k.cls)} /> {k.label}</span>)}
      </div>
    </div>
  );
}