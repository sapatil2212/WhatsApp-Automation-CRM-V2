'use client';

import Link from 'next/link';
import { ArrowRight, Building2, QrCode, Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, ErrorPanel, PageHead, Pill, Skeleton, Stat, useApi, type ReviewBusiness } from '@/components/reviews/shared';

interface Overview {
  totals: Record<string, number>;
  funnel: Array<{ key: string; label: string; count: number }>;
  note: string;
}
interface Health { online: boolean; lastHeartbeatAt: string | null; pendingJobs: number; runningJobs: number }

export default function ReviewsOverviewPage() {
  const biz = useApi<ReviewBusiness[]>('/api/reviews/businesses');
  const ov = useApi<Overview>('/api/reviews/analytics/overview?days=30');
  const health = useApi<Health>('/api/reviews/automation/health');
  const t = ov.data?.totals;
  const noBusiness = biz.data && biz.data.length === 0;

  return (
    <div className="space-y-4">
      <PageHead
        title="Google Reviews"
        subtitle="Help real customers share honest Google reviews with QR codes, AI writing help and a guided hand-off to Google."
        actions={<Button size="sm" className="h-8 gap-1.5 text-xs" render={<Link href="/reviews/businesses" />}><Building2 className="size-3.5" /> Manage businesses</Button>}
      />

      {noBusiness && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Start by adding your first business</p>
            <p className="text-xs text-muted-foreground">Add its Google review link, then create a QR code for your counter or invoices.</p>
          </div>
          <Button size="sm" className="h-8 gap-1 text-xs" render={<Link href="/reviews/businesses?new=1" />}>Add business <ArrowRight className="size-3.5" /></Button>
        </Card>
      )}

      {ov.error && <ErrorPanel message={ov.error} onRetry={ov.reload} />}
      {!t && !ov.error ? (
        <Card><Skeleton rows={2} /></Card>
      ) : t ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="QR scans (30d)" value={t.qrScans} />
          <Stat label="Unique visitors" value={t.uniqueVisitors} />
          <Stat label="AI drafts" value={t.draftsGenerated} />
          <Stat label="Approved drafts" value={t.approvedDrafts} />
          <Stat label="Google page opens" value={t.googleOpens} hint="Not the same as published" />
          <Stat label="Customer said done" value={t.customerReportedDone} hint="Self-reported" />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-4">
          <p className="text-[13px] font-semibold">Customer journey (30 days)</p>
          <div className="mt-3 space-y-2">
            {(ov.data?.funnel ?? []).map((s, i, all) => {
              const top = Math.max(1, all[0]?.count ?? 1);
              return (
                <div key={s.key}>
                  <div className="flex justify-between text-[11px]"><span>{i + 1}. {s.label}</span><span className="tabular-nums text-muted-foreground">{s.count}</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(s.count / top) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
          {ov.data?.note && <p className="mt-3 text-[11px] text-muted-foreground">{ov.data.note}</p>}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-[13px] font-semibold">Automation worker</p>
            {health.data ? (
              <div className="mt-2 space-y-1.5 text-xs">
                <p>{health.data.online ? <Pill tone="green">● Online</Pill> : <Pill tone="amber">● Offline</Pill>}</p>
                <p className="text-muted-foreground">{health.data.pendingJobs} waiting · {health.data.runningJobs} running</p>
                {!health.data.online && <p className="text-[11px] text-muted-foreground">Start it with <code className="rounded bg-muted px-1">npm run worker:reviews</code>. Customers can still continue to Google without it.</p>}
              </div>
            ) : health.error ? <p className="mt-2 text-xs text-destructive">{health.error}</p> : <Skeleton rows={1} />}
          </Card>
          <Card className="p-4">
            <p className="text-[13px] font-semibold">Quick links</p>
            <ul className="mt-2 space-y-1.5 text-xs">
              <li><Link className="flex items-center gap-1.5 text-primary hover:underline" href="/reviews/qr-codes"><QrCode className="size-3.5" /> Create a QR code</Link></li>
              <li><Link className="flex items-center gap-1.5 text-primary hover:underline" href="/reviews/analytics"><Star className="size-3.5" /> See analytics</Link></li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}