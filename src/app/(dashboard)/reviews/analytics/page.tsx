'use client';

import { useState } from 'react';

import { Bars, BusinessPicker, Card, ErrorPanel, PageHead, selectCls, Skeleton, Stat, useApi } from '@/components/reviews/shared';
import { REVIEW_LANGUAGES } from '@/lib/reviews/constants';

interface Row { period: string; scans: number; drafts: number; approvals: number; googleOpens: number }
interface Overview {
  totals: Record<string, number>;
  daily: Row[];
  weekly: Row[];
  monthly: Row[];
  languages: Array<{ language: string; count: number }>;
  funnel: Array<{ key: string; label: string; count: number }>;
  note: string;
}
interface Perf { id: string; name: string; business?: string; placement?: string | null; scans: number; drafts: number; approvals: number; googleOpens: number; copies?: number }

const KEYS = [
  { key: 'scans', label: 'Scans', cls: 'bg-sky-500' },
  { key: 'approvals', label: 'Approved drafts', cls: 'bg-primary' },
  { key: 'googleOpens', label: 'Google opens', cls: 'bg-amber-500' },
];

function PerfTable({ title, rows, nameLabel }: { title: string; rows: Perf[] | undefined; nameLabel: string }) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.scans));
  return (
    <Card>
      <p className="border-b border-border/70 px-4 py-2.5 text-[13px] font-semibold">{title}</p>
      {!rows ? <Skeleton rows={3} /> : !rows.length ? <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing to compare yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><tr><th className="py-2 pl-4 pr-3">{nameLabel}</th><th className="px-3 py-2">Scans</th><th className="px-3 py-2">Drafts</th><th className="px-3 py-2">Approved</th><th className="px-3 py-2">Google opens</th><th className="py-2 pl-3 pr-4">Approval rate</th></tr></thead>
            <tbody className="divide-y divide-border/60">
              {[...rows].sort((a, b) => b.scans - a.scans).map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pl-4 pr-3"><p className="font-medium">{r.name}</p>{r.business && <p className="text-[10px] text-muted-foreground">{r.business}</p>}<div className="mt-1 h-1 w-full max-w-[160px] rounded-full bg-muted"><div className="h-full rounded-full bg-sky-500" style={{ width: `${(r.scans / max) * 100}%` }} /></div></td>
                  <td className="px-3 py-2 tabular-nums">{r.scans}</td>
                  <td className="px-3 py-2 tabular-nums">{r.drafts}</td>
                  <td className="px-3 py-2 tabular-nums">{r.approvals}</td>
                  <td className="px-3 py-2 tabular-nums">{r.googleOpens}</td>
                  <td className="py-2 pl-3 pr-4 tabular-nums">{r.scans ? `${Math.round((r.approvals / r.scans) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [businessId, setBusinessId] = useState('');
  const [grain, setGrain] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const q = `days=${days}${businessId ? `&businessId=${businessId}` : ''}`;
  const ov = useApi<Overview>(`/api/reviews/analytics/overview?${q}`);
  const camp = useApi<{ campaigns: Perf[]; qrCodes: Perf[] }>(`/api/reviews/analytics/campaigns?${q}`);
  const biz = useApi<{ businesses: Perf[] }>(`/api/reviews/analytics/businesses?days=${days}`);
  const t = ov.data?.totals;
  const langLabel = (c: string) => REVIEW_LANGUAGES.find((l) => l.code === c)?.label ?? c;
  const langTotal = Math.max(1, ...(ov.data?.languages ?? []).map((l) => l.count));

  return (
    <div className="space-y-4">
      <PageHead
        title="Review analytics"
        subtitle="Engagement on your review pages. Google page opens are not published reviews."
        actions={
          <>
            <BusinessPicker value={businessId} onChange={setBusinessId} />
            <select aria-label="Range" className={`${selectCls} w-auto`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option>
            </select>
          </>
        }
      />
      {ov.error && <ErrorPanel message={ov.error} onRetry={ov.reload} />}
      {!t ? !ov.error && <Card><Skeleton rows={2} /></Card> : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="QR scans" value={t.qrScans} />
          <Stat label="Unique visitors" value={t.uniqueVisitors} />
          <Stat label="AI requests" value={t.aiRequests} />
          <Stat label="Drafts generated" value={t.draftsGenerated} />
          <Stat label="Approved drafts" value={t.approvedDrafts} />
          <Stat label="Copy actions" value={t.copyActions} />
          <Stat label="Google page opens" value={t.googleOpens} hint="Not published reviews" />
          <Stat label="Customer said done" value={t.customerReportedDone} hint="Self-reported" />
          <Stat label="Automation jobs" value={t.automationJobs} />
          <Stat label="Page prepared" value={t.prepSuccess} />
          <Stat label="Prep failures" value={t.prepFailures} />
          <Stat label="AI tokens" value={t.aiTokens.toLocaleString('en-IN')} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold">Activity</p>
            <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
              {(['daily', 'weekly', 'monthly'] as const).map((g) => <button key={g} type="button" onClick={() => setGrain(g)} className={`h-6 rounded px-2 text-[11px] font-medium capitalize ${grain === g ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{g}</button>)}
            </div>
          </div>
          {ov.data ? <Bars rows={ov.data[grain] as unknown as Array<Record<string, number | string>>} keys={KEYS} /> : <Skeleton rows={3} />}
        </Card>
        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-[13px] font-semibold">Customer journey funnel</p>
            <div className="mt-2 space-y-1.5">
              {(ov.data?.funnel ?? []).map((s, _i, all) => (
                <div key={s.key}>
                  <div className="flex justify-between text-[11px]"><span>{s.label}</span><span className="tabular-nums text-muted-foreground">{s.count}</span></div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(s.count / Math.max(1, all[0]?.count ?? 1)) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-[13px] font-semibold">Languages</p>
            {!ov.data?.languages.length ? <p className="mt-2 text-xs text-muted-foreground">No AI drafts yet.</p> : (
              <div className="mt-2 space-y-1.5">
                {ov.data.languages.map((l) => (
                  <div key={l.language}><div className="flex justify-between text-[11px]"><span>{langLabel(l.language)}</span><span className="tabular-nums text-muted-foreground">{l.count}</span></div><div className="mt-0.5 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-sky-500" style={{ width: `${(l.count / langTotal) * 100}%` }} /></div></div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <PerfTable title="Campaign comparison" rows={camp.data?.campaigns} nameLabel="Campaign" />
      <PerfTable title="QR code performance" rows={camp.data?.qrCodes} nameLabel="QR code" />
      {!businessId && <PerfTable title="Business comparison" rows={biz.data?.businesses} nameLabel="Business" />}
      {ov.data?.note && <p className="text-[11px] text-muted-foreground">{ov.data.note}</p>}
    </div>
  );
}