'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, CalendarClock, CheckCheck, Clock, Download, Eye, Loader2, MessageCircleReply,
  Pause, Rocket, Send, Square, Trash2, XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { api, type BroadcastDto, type RecipientDto } from '@/lib/campaigns/api';
import { STATUS_STYLE } from '@/lib/campaigns/status';
import { CampaignControls } from '@/components/campaigns/campaign-controls';

type RecipientFilter = 'all' | RecipientDto['status'];
const PAGE_SIZE = 50;

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const RECIPIENT_STYLE: Record<RecipientDto['status'], string> = {
  pending: 'text-muted-foreground',
  sent: 'text-sky-600 dark:text-sky-400',
  delivered: 'text-primary',
  read: 'text-primary',
  replied: 'text-violet-600 dark:text-violet-400',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground line-through',
};

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<BroadcastDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientDto[]>([]);
  const [recTotal, setRecTotal] = useState(0);
  const [recPage, setRecPage] = useState(1);
  const [recFilter, setRecFilter] = useState<RecipientFilter>('all');
  const [busy, setBusy] = useState<null | 'start' | 'delete' | 'export'>(null);
  const [driving, setDriving] = useState(false);
  const drivingRef = useRef(false);

  const loadCampaign = useCallback(async () => {
    try {
      const res = await api<BroadcastDto>(`/api/broadcasts/${id}`);
      setCampaign(res.data);
      setError(null);
      return res.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign');
      return null;
    }
  }, [id]);

  const loadRecipients = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(recPage), pageSize: String(PAGE_SIZE) });
      if (recFilter !== 'all') q.set('status', recFilter);
      const res = await api<RecipientDto[]>(`/api/broadcasts/${id}/recipients?${q}`);
      setRecipients(res.data);
      setRecTotal(res.meta?.pagination?.total ?? res.data.length);
    } catch { /* surfaced by campaign load */ }
  }, [id, recPage, recFilter]);

  useEffect(() => { loadCampaign(); }, [loadCampaign]);
  useEffect(() => { loadRecipients(); }, [loadRecipients]);

  // Keep stats fresh while anything is still moving (sending, scheduled,
  // or delivery/read receipts arriving after a recent send).
  const recentlySent = campaign?.status === 'sent' && Date.now() - new Date(campaign.updatedAt).getTime() < 30 * 60_000;
  const live = campaign?.status === 'sending' || campaign?.status === 'scheduled' || campaign?.status === 'paused' || recentlySent;
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadCampaign();
      loadRecipients();
    }, campaign?.status === 'sending' ? 3000 : 10_000);
    return () => window.clearInterval(t);
  }, [live, campaign?.status, loadCampaign, loadRecipients]);

  /**
   * While this page is open and the campaign is sending, drive dispatch
   * directly so sending is fast. The server ticker keeps going if the tab
   * closes; a per-campaign server lock prevents double-sends.
   */
  useEffect(() => {
    if (campaign?.status !== 'sending' || drivingRef.current) return;
    drivingRef.current = true;
    setDriving(true);
    (async () => {
      try {
        for (let i = 0; i < 2000; i++) {
          if (document.visibilityState !== 'visible') { await new Promise((r) => setTimeout(r, 2000)); continue; }
          const res = await api<{ hasMore: boolean; attempted: number; status: string }>(
            `/api/broadcasts/${id}/dispatch`, { method: 'POST', json: { batchSize: 25 } },
          );
          if (!res.data.hasMore || res.data.status !== 'sending') break;
          await new Promise((r) => setTimeout(r, res.data.attempted === 0 ? 1500 : 300));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (!/not dispatching/i.test(msg)) toast.error(`Sending paused: ${msg}`);
      } finally {
        drivingRef.current = false;
        setDriving(false);
        loadCampaign();
        loadRecipients();
      }
    })();
  }, [campaign?.status, id, loadCampaign, loadRecipients]);

  async function start() {
    if (!campaign) return;
    if (!window.confirm(`Send “${campaign.name}” to ${campaign.stats.total.toLocaleString()} contacts now?`)) return;
    setBusy('start');
    try {
      await api(`/api/broadcasts/${id}/start`, { method: 'POST' });
      toast.success('Campaign started');
      await loadCampaign();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start');
    } finally {
      setBusy(null);
    }
  }

  async function unschedule() {
    try {
      await api(`/api/broadcasts/${id}`, { method: 'PATCH', json: { scheduledAt: null } });
      toast.success('Schedule removed — campaign is back to draft');
      loadCampaign();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update');
    }
  }

  async function remove() {
    if (!window.confirm('Delete this campaign? This cannot be undone.')) return;
    setBusy('delete');
    try {
      await api(`/api/broadcasts/${id}`, { method: 'DELETE' });
      toast.success('Campaign deleted');
      router.push('/campaigns');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
      setBusy(null);
    }
  }

  async function exportCsv() {
    setBusy('export');
    try {
      const rows: string[][] = [['Name', 'Phone', 'Status', 'Sent at', 'Delivered at', 'Read at', 'Replied at', 'Error']];
      for (let page = 1; page <= 200; page++) {
        const res = await api<RecipientDto[]>(`/api/broadcasts/${id}/recipients?page=${page}&pageSize=100`);
        for (const r of res.data) {
          rows.push([r.contact?.name ?? '', r.contact?.phone ?? '', r.status, r.sentAt ?? '', r.deliveredAt ?? '', r.readAt ?? '', r.repliedAt ?? '', r.errorMessage ?? '']);
        }
        if (res.data.length < 100) break;
      }
      downloadCsv(`${campaign?.name ?? 'campaign'}-recipients.csv`, rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  if (error && !campaign) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <XCircle className="mx-auto size-8 text-destructive" />
        <p className="text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={() => router.push('/campaigns')}>Back to campaigns</Button>
      </div>
    );
  }
  if (!campaign) return <div className="flex h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;

  const s = campaign.stats;
  const st = STATUS_STYLE[campaign.status];
  const processed = s.total - s.pending;
  const progress = s.total ? Math.round((processed / s.total) * 100) : 0;
  const deliveredAll = s.delivered + s.read + s.replied;
  const readAll = s.read + s.replied;
  const pct = (n: number) => (s.total ? Math.round((n / s.total) * 1000) / 10 : 0);
  const topErrors = Object.entries(
    recipients.filter((r) => r.status === 'failed' && r.errorMessage).reduce<Record<string, number>>((acc, r) => {
      const key = r.errorMessage!.slice(0, 120);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <div>
        <Link href="/campaigns" className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Campaigns
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{campaign.name}</h1>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>
                <span className={`size-1.5 rounded-full ${st.dot}`} /> {st.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Template <span className="font-mono">{campaign.templateName}</span> ({campaign.templateLanguage}) · created {new Date(campaign.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {campaign.status === 'draft' && (
              <Button onClick={start} disabled={busy !== null} className="gap-1.5">
                {busy === 'start' ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />} Launch now
              </Button>
            )}
            {campaign.status === 'scheduled' && (
              <>
                <Button variant="outline" onClick={unschedule} className="gap-1.5"><CalendarClock className="size-4" /> Unschedule</Button>
                <Button onClick={start} disabled={busy !== null} className="gap-1.5"><Rocket className="size-4" /> Send now</Button>
              </>
            )}
            <CampaignControls campaign={campaign} onChanged={(updated) => { setCampaign(updated); loadRecipients(); }} />
            {['sent', 'failed', 'sending', 'paused', 'cancelled'].includes(campaign.status) && (
              <Button variant="outline" onClick={exportCsv} disabled={busy !== null} className="gap-1.5">
                {busy === 'export' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export CSV
              </Button>
            )}
            {campaign.editable && (
              <Button variant="ghost" onClick={remove} disabled={busy !== null} className="gap-1.5 text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {campaign.status === 'scheduled' && campaign.scheduledAt && (
        <div className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm">
          <CalendarClock className="size-4 text-sky-600" />
          Sends automatically on <b>{new Date(campaign.scheduledAt).toLocaleString()}</b> to {s.total.toLocaleString()} contacts.
        </div>
      )}

      {campaign.status === 'sending' && (
        <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-semibold"><Loader2 className="size-4 animate-spin text-amber-600" /> Sending… {processed.toLocaleString()} of {s.total.toLocaleString()}</span>
            <span className="tabular-nums font-semibold">{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} /></div>
          <p className="text-[11px] text-muted-foreground">{driving ? 'Sending from this tab for speed.' : 'Sending in the background.'} You can close this page — the campaign keeps going.</p>
        </div>
      )}

      {campaign.status === 'paused' && (
        <div className="space-y-2 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-semibold"><Pause className="size-4 text-orange-600" /> Paused — {processed.toLocaleString()} of {s.total.toLocaleString()} processed</span>
            <span className="tabular-nums font-semibold">{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-orange-500" style={{ width: `${progress}%` }} /></div>
          <p className="text-[11px] text-muted-foreground">{s.pending.toLocaleString()} recipients are waiting. Resume to continue where it stopped, or cancel to skip them.</p>
        </div>
      )}

      {campaign.status === 'cancelled' && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Square className="size-4" /> Cancelled. {s.total.toLocaleString()} message{s.total === 1 ? ' was' : 's were'} processed before stopping; remaining recipients were skipped (filter “cancelled” below).
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: 'Recipients', value: s.total, sub: s.pending ? `${s.pending} pending` : 'all processed', icon: Send },
          { label: 'Delivered', value: deliveredAll, sub: `${pct(deliveredAll)}%`, icon: CheckCheck },
          { label: 'Read', value: readAll, sub: `${pct(readAll)}%`, icon: Eye },
          { label: 'Replied', value: s.replied, sub: `${pct(s.replied)}%`, icon: MessageCircleReply },
          { label: 'Failed', value: s.failed, sub: `${pct(s.failed)}%`, icon: AlertTriangle },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <k.icon className={`size-4 ${k.label === 'Failed' && k.value ? 'text-destructive' : 'text-primary'}`} />
            <p className="mt-2 text-xl font-bold tabular-nums">{k.value.toLocaleString()}</p>
            <p className="text-[11px] text-muted-foreground"><span className="font-semibold uppercase tracking-wider">{k.label}</span> · {k.sub}</p>
          </div>
        ))}
      </div>

      {s.total > 0 && (
        <div className="rounded-2xl border border-border/70 bg-card p-4">
          <p className="mb-3 text-xs font-semibold text-muted-foreground">Funnel</p>
          {[
            ['Sent', s.total - s.pending - s.failed],
            ['Delivered', deliveredAll],
            ['Read', readAll],
            ['Replied', s.replied],
          ].map(([label, value]) => (
            <div key={label as string} className="mb-2 flex items-center gap-3 text-xs">
              <span className="w-20 text-muted-foreground">{label}</span>
              <div className="h-2 flex-1 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${pct(value as number)}%` }} /></div>
              <span className="w-24 text-right tabular-nums">{(value as number).toLocaleString()} · {pct(value as number)}%</span>
            </div>
          ))}
        </div>
      )}

      {topErrors.length > 0 && (
        <div className="space-y-1.5 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-xs font-semibold text-destructive">Most common failure reasons (this page)</p>
          {topErrors.map(([msg, n]) => <p key={msg} className="text-xs text-muted-foreground"><b>{n}×</b> {msg}</p>)}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">Recipients</p>
          <div className="flex flex-wrap gap-1">
            {(['all', 'pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'cancelled'] as RecipientFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => { setRecFilter(f); setRecPage(1); }}
                aria-pressed={recFilter === f}
                className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize ${recFilter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {recipients.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-muted-foreground">No recipients in this view.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Contact</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Last update</th>
                  <th className="px-4 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {recipients.map((r) => {
                  const last = r.repliedAt ?? r.readAt ?? r.deliveredAt ?? r.sentAt;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{r.contact?.name || '—'}</p>
                        <p className="text-[11px] text-muted-foreground">+{r.contact?.phone}</p>
                      </td>
                      <td className={`px-4 py-2.5 font-semibold capitalize ${RECIPIENT_STYLE[r.status]}`}>
                        {r.status === 'pending' ? <span className="inline-flex items-center gap-1"><Clock className="size-3" /> pending</span> : r.status}
                      </td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{last ? new Date(last).toLocaleString() : '—'}</td>
                      <td className="max-w-[320px] truncate px-4 py-2.5 text-muted-foreground" title={r.errorMessage ?? ''}>{r.errorMessage ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {recTotal > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
            <span>{(recPage - 1) * PAGE_SIZE + 1}–{Math.min(recPage * PAGE_SIZE, recTotal)} of {recTotal.toLocaleString()}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={recPage === 1} onClick={() => setRecPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={recPage * PAGE_SIZE >= recTotal} onClick={() => setRecPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
