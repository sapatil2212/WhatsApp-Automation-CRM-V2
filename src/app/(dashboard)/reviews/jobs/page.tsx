'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, Image as ImageIcon, Loader2, RotateCcw, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BusinessPicker, Card, Empty, ErrorPanel, fmtDate, fmtMs, Modal, PageHead, Pill, selectCls, Skeleton, useApi } from '@/components/reviews/shared';
import { api } from '@/lib/campaigns/api';
import { JOB_STATUS_LABEL, JOB_STATUSES, type JobStatus } from '@/lib/reviews/constants';

interface JobRow {
  id: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  durationMs: number | null;
  hasScreenshot: boolean;
  business: { id: string; name: string };
  campaign: { id: string; name: string } | null;
}
interface JobDetail extends JobRow {
  result: Record<string, unknown> | null;
  approval: { rating: number; language: string; createdAt: string } | null;
  logs: Array<{ id: string; level: string; message: string; createdAt: string }>;
}

const tone = (s: JobStatus) => (s === 'failed' ? 'red' : s === 'cancelled' ? 'muted' : s === 'completed' || s === 'awaiting_customer_confirmation' ? 'green' : s === 'pending' || s === 'queued' ? 'amber' : 'sky') as 'red' | 'muted' | 'green' | 'amber' | 'sky';

function JobDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useApi<JobDetail>(`/api/reviews/automation/jobs/${id}`);
  const [shot, setShot] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data || !['pending', 'queued', 'initializing', 'browser_launched', 'navigating', 'preparing_review'].includes(data.status)) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [data, reload]);
  const act = async (kind: 'retry' | 'cancel') => {
    setBusy(true);
    try {
      await api(`/api/reviews/automation/jobs/${id}/${kind}`, { method: 'POST' });
      toast.success(kind === 'retry' ? 'Job queued again.' : 'Cancel requested.');
      await reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Automation job" subtitle={id} onClose={onClose} wide>
      {error ? <ErrorPanel message={error} onRetry={reload} /> : !data ? <Skeleton rows={3} /> : (
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            <p><span className="text-muted-foreground">Status</span><br /><Pill tone={tone(data.status)}>{JOB_STATUS_LABEL[data.status]}</Pill></p>
            <p><span className="text-muted-foreground">Business</span><br />{data.business.name}</p>
            <p><span className="text-muted-foreground">Campaign</span><br />{data.campaign?.name ?? '—'}</p>
            <p><span className="text-muted-foreground">Created</span><br />{fmtDate(data.createdAt)}</p>
            <p><span className="text-muted-foreground">Duration</span><br />{fmtMs(data.durationMs)}</p>
            <p><span className="text-muted-foreground">Attempts</span><br />{data.attempts} / {data.maxAttempts}</p>
          </div>
          {data.lastError && <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-destructive">{data.lastError}</p>}
          {data.result && (
            <div className="rounded-md bg-muted/50 px-2.5 py-2">
              <p className="font-medium">Google page result: {String(data.result.state ?? '—')}</p>
              <p className="text-muted-foreground">Published on Google: never set by ChatNexGen. The customer completes Google&apos;s own steps.</p>
            </div>
          )}
          <div>
            <p className="mb-1 font-medium">Logs</p>
            <ol className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border/70 p-2 font-mono text-[11px]">
              {data.logs.length === 0 ? <li className="text-muted-foreground">No logs yet.</li> : data.logs.map((l) => (
                <li key={l.id} className={l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : ''}>
                  <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleTimeString('en-IN')}</span> {l.message}
                </li>
              ))}
            </ol>
          </div>
          {data.hasScreenshot && (
            <div>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setShot((s) => !s)}><ImageIcon className="size-3.5" /> {shot ? 'Hide' : 'View'} screenshot</Button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {shot && <img src={`/api/reviews/automation/jobs/${id}/screenshot`} alt="Worker screenshot" className="mt-2 max-h-96 rounded-md border" />}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            {['failed', 'cancelled'].includes(data.status) && <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => act('retry')}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Retry</Button>}
            {!['completed', 'cancelled', 'failed'].includes(data.status) && <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => act('cancel')}><XCircle className="size-3.5" /> Cancel job</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function JobsPage() {
  const [status, setStatus] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = new URLSearchParams({ page: String(page), pageSize: '25', ...(status ? { status } : {}), ...(businessId ? { businessId } : {}) });
  const { data, error, loading, reload } = useApi<{ total: number; items: JobRow[] }>(`/api/reviews/automation/jobs?${q}`);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));
  useEffect(() => {
    const t = setInterval(() => void reload(), 10_000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <div className="space-y-4">
      <Link href="/reviews" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Overview</Link>
      <PageHead title="Automation jobs" subtitle="Background checks that the Google review page opens after a customer approves their wording. Nothing is ever posted for them." />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
          <BusinessPicker value={businessId} onChange={(v) => { setBusinessId(v); setPage(1); }} />
          <select aria-label="Status" className={`${selectCls} w-auto`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        {error ? <div className="p-3"><ErrorPanel message={error} onRetry={reload} /></div> : loading && !data ? <Skeleton /> : !data?.items.length ? (
          <Empty title="No jobs yet" body="Jobs appear when customers approve a review draft on your review page." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="border-b border-border bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-2 pl-4 pr-3">Job ID</th><th className="px-3 py-2">Business</th><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Created</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Duration</th><th className="px-3 py-2">Retries</th><th className="px-3 py-2">Error</th><th className="py-2 pl-3 pr-4 text-right">Details</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.items.map((j) => (
                  <tr key={j.id} className="hover:bg-muted/40">
                    <td className="py-2 pl-4 pr-3 font-mono text-[11px]">{j.id.slice(0, 8)}</td>
                    <td className="px-3 py-2">{j.business.name}</td>
                    <td className="px-3 py-2">{j.campaign?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(j.createdAt)}</td>
                    <td className="px-3 py-2"><Pill tone={tone(j.status)}>{JOB_STATUS_LABEL[j.status] ?? j.status}</Pill></td>
                    <td className="px-3 py-2 tabular-nums">{fmtMs(j.durationMs)}</td>
                    <td className="px-3 py-2 tabular-nums">{Math.max(0, j.attempts - 1)}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-destructive" title={j.lastError ?? ''}>{j.lastError ?? ''}</td>
                    <td className="py-2 pl-3 pr-4 text-right"><Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setOpenId(j.id)}><Eye className="size-3.5" /> View</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span>{data?.total ?? 0} jobs</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" className="size-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-3.5" /></Button>
            <span className="px-2 tabular-nums">Page {page} of {totalPages}</span>
            <Button variant="outline" size="icon-sm" className="size-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-3.5" /></Button>
          </div>
        </div>
      </Card>
      {openId && <JobDialog id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}