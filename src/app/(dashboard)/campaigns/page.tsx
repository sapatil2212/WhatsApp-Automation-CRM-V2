'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarClock, CheckCheck, Eye, Loader2, Megaphone, Plus, RefreshCw, Search, Send, Sparkles, XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type BroadcastDto, type BroadcastStatus } from '@/lib/campaigns/api';
import { STATUS_STYLE } from '@/lib/campaigns/status';
import { CampaignControls } from '@/components/campaigns/campaign-controls';

const POLL_MS = 5_000;


type Filter = 'all' | BroadcastStatus;

function Rate({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-[72px]">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value}%</span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-muted">
        <div className="h-1 rounded-full bg-primary" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const router = useRouter();
  const [items, setItems] = useState<BroadcastDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api<BroadcastDto[]>('/api/broadcasts?pageSize=100');
      setItems(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const live = items.some((b) => b.status === 'sending' || b.status === 'scheduled');
  const replaceItem = (updated: BroadcastDto) => setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [live, load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: items.length, draft: 0, scheduled: 0, sending: 0, paused: 0, sent: 0, failed: 0, cancelled: 0 };
    for (const b of items) c[b.status] += 1;
    return c;
  }, [items]);

  const totals = useMemo(() => {
    const done = items.filter((b) => ['sent', 'sending', 'paused', 'cancelled'].includes(b.status));
    const total = done.reduce((s, b) => s + b.stats.total, 0);
    const delivered = done.reduce((s, b) => s + b.stats.delivered + b.stats.read + b.stats.replied, 0);
    const read = done.reduce((s, b) => s + b.stats.read + b.stats.replied, 0);
    const replied = done.reduce((s, b) => s + b.stats.replied, 0);
    const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
    return { total, delivery: pct(delivered), read: pct(read), reply: pct(replied) };
  }, [items]);

  const visible = items.filter((b) =>
    (filter === 'all' || b.status === filter) &&
    (!search.trim() || `${b.name} ${b.templateName}`.toLowerCase().includes(search.trim().toLowerCase())),
  );

  async function remove(b: BroadcastDto) {
    if (!window.confirm(`Delete “${b.name}”? This cannot be undone.`)) return;
    try {
      await api(`/api/broadcasts/${b.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((x) => x.id !== b.id));
      toast.success('Campaign deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const FILTERS: Array<[Filter, string]> = [
    ['all', 'All'], ['sending', 'Sending'], ['paused', 'Paused'], ['scheduled', 'Scheduled'], ['draft', 'Drafts'], ['sent', 'Completed'], ['cancelled', 'Cancelled'], ['failed', 'Failed'],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Megaphone className="size-6 text-primary" /> Campaigns
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Broadcast approved WhatsApp templates to segments of your contacts.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5"><RefreshCw className="size-3.5" /> Refresh</Button>
          <Button onClick={() => router.push('/campaigns/new')} className="gap-1.5"><Plus className="size-4" /> New campaign</Button>
        </div>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Messages sent', value: totals.total.toLocaleString(), icon: Send },
            { label: 'Delivery rate', value: `${totals.delivery}%`, icon: CheckCheck },
            { label: 'Read rate', value: `${totals.read}%`, icon: Eye },
            { label: 'Reply rate', value: `${totals.reply}%`, icon: Sparkles },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border/70 bg-card p-4">
              <s.icon className="size-4 text-primary" />
              <p className="mt-2 text-xl font-bold tabular-nums">{s.value}</p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-border/70 bg-card p-1">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
            >
              {label} <span className="ml-0.5 opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns…" className="h-9 w-60 pl-8 text-xs" />
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <XCircle className="size-6 text-destructive" />
          <p className="text-sm">{error}</p>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10"><Sparkles className="size-6 text-primary" /></span>
          <p className="mt-3 text-sm font-semibold">Launch your first campaign</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">Describe what you want to say and to whom — AI picks the template, audience, personalization and send time for you to review.</p>
          <Button onClick={() => router.push('/campaigns/new')} className="mt-4 gap-1.5"><Sparkles className="size-4" /> Create with AI</Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No campaigns match these filters.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          <div className="divide-y divide-border/60">
            {visible.map((b) => {
              const st = STATUS_STYLE[b.status];
              const progress = b.stats.total ? Math.round(((b.stats.total - b.stats.pending) / b.stats.total) * 100) : 0;
              return (
                <div key={b.id} className="group flex flex-wrap items-center gap-4 px-4 py-3.5 transition-colors hover:bg-accent/40">
                  <Link href={`/campaigns/${b.id}`} className="min-w-[200px] flex-1">
                    <p className="truncate text-sm font-semibold">{b.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      <span className="font-mono">{b.templateName}</span> · {b.stats.total.toLocaleString()} recipients ·{' '}
                      {b.status === 'scheduled' && b.scheduledAt ? (
                        <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" />{new Date(b.scheduledAt).toLocaleString()}</span>
                      ) : new Date(b.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                  {b.status === 'sending' || b.status === 'paused' ? (
                    <div className="w-40">
                      <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">{b.status === 'paused' ? 'Paused at' : 'Sending'}</span><span className="font-semibold tabular-nums">{progress}%</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted"><div className={`h-1.5 rounded-full transition-all ${b.status === 'paused' ? 'bg-orange-500' : 'bg-amber-500'}`} style={{ width: `${progress}%` }} /></div>
                    </div>
                  ) : (b.status === 'sent' || b.status === 'failed' || b.status === 'cancelled') ? (
                    <div className="hidden gap-4 md:flex">
                      <Rate label="Delivered" value={b.stats.deliveryRate} />
                      <Rate label="Read" value={b.stats.readRate} />
                    </div>
                  ) : null}
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>
                    <span className={`size-1.5 rounded-full ${st.dot}`} /> {st.label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <CampaignControls campaign={b} onChanged={replaceItem} compact />
                  </div>
                  {b.editable && (
                    <button onClick={() => remove(b)} className="text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100">
                      Delete
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
