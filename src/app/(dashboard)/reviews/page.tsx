'use client';

import Link from 'next/link';
import { ArrowRight, Bot, Building2, CheckCircle2, ExternalLink, Megaphone, MousePointerClick, QrCode, Settings, Sparkles, ThumbsUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, ErrorPanel, PageHead, Pill, Skeleton, Stat, useApi, type ReviewBusiness, type ReviewQr } from '@/components/reviews/shared';
import { cn } from '@/lib/utils';

interface Overview {
  totals: Record<string, number>;
  funnel: Array<{ key: string; label: string; count: number }>;
  note: string;
}
interface Health { online: boolean; lastHeartbeatAt: string | null; pendingJobs: number; runningJobs: number }

export default function ReviewsOverviewPage() {
  const biz = useApi<ReviewBusiness[]>('/api/reviews/businesses');
  const qr = useApi<ReviewQr[]>('/api/reviews/qr');
  const ov = useApi<Overview>('/api/reviews/analytics/overview?days=30');
  const health = useApi<Health>('/api/reviews/automation/health');
  const t = ov.data?.totals;

  const hasBusiness = (biz.data?.length ?? 0) > 0;
  const hasLink = (biz.data ?? []).some((b) => b.googleReviewUrl);
  const hasQr = (qr.data?.length ?? 0) > 0;
  const steps = [
    { done: hasBusiness, title: 'Add your business', body: 'Name, category and the services you offer.', href: '/reviews/businesses?new=1', cta: 'Add business' },
    { done: hasLink, title: 'Paste your Google review link', body: 'Customers are sent here to post their review.', href: '/reviews/businesses', cta: 'Add link' },
    { done: hasQr, title: 'Create a QR code', body: 'Print it for the counter or share it on WhatsApp.', href: '/reviews/qr-codes', cta: 'Create QR' },
  ];
  const setupDone = biz.data && qr.data && steps.every((s) => s.done);

  return (
    <div className="space-y-4">
      <PageHead
        title="Google Reviews"
        subtitle="Help real customers leave honest Google reviews: they scan a QR code, the AI helps them write, and they post on Google."
        actions={
          <>
            <Button size="sm" variant="outline" className="gap-1.5" render={<Link href="/reviews/businesses" />}><Building2 className="size-3.5" /> Businesses</Button>
            <Button size="sm" className="gap-1.5" render={<Link href="/reviews/qr-codes" />}><QrCode className="size-3.5" /> QR codes</Button>
          </>
        }
      />

      {ov.error && <ErrorPanel message={ov.error} onRetry={ov.reload} />}
      {!t && !ov.error ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[68px] animate-pulse rounded-xl bg-muted/60" />)}</div>
      ) : t ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="QR scans (30d)" value={t.qrScans} icon={QrCode} />
          <Stat label="AI drafts approved" value={t.approvedDrafts} icon={Sparkles} />
          <Stat label="Sent to Google" value={t.googleOpens} hint="Opened the Google page" icon={MousePointerClick} />
          <Stat label="Said they posted" value={t.customerReportedDone} hint="Reported by the customer" icon={ThumbsUp} />
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {!setupDone && (biz.data || qr.data) && (
            <Card className="p-4">
              <p className="text-sm font-semibold">Get started</p>
              <p className="text-xs text-muted-foreground">Three steps and you can start collecting reviews.</p>
              <ol className="mt-3 space-y-2">
                {steps.map((s, i) => (
                  <li key={s.title} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', s.done ? 'border-border/60 bg-muted/30' : 'border-border/70')}>
                    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', s.done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-primary/10 text-primary')}>
                      {s.done ? <CheckCircle2 className="size-3.5" /> : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-[13px] font-medium', s.done && 'text-muted-foreground line-through')}>{s.title}</p>
                      {!s.done && <p className="text-[11px] text-muted-foreground">{s.body}</p>}
                    </div>
                    {!s.done && <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-xs" render={<Link href={s.href} />}>{s.cta} <ArrowRight className="size-3" /></Button>}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Customer journey · last 30 days</p>
              <Link href="/reviews/analytics" className="text-xs font-medium text-primary hover:underline">Full analytics</Link>
            </div>
            {!ov.data ? <Skeleton rows={3} /> : (
              <div className="mt-3 space-y-2.5">
                {ov.data.funnel.map((s, i, all) => {
                  const top = Math.max(1, all[0]?.count ?? 1);
                  return (
                    <div key={s.key}>
                      <div className="flex justify-between text-[12px]"><span>{i + 1}. {s.label}</span><span className="font-medium tabular-nums">{s.count}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(s.count / top) * 100}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
            {ov.data?.note && <p className="mt-3 text-[11px] text-muted-foreground">{ov.data.note}</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-sm font-semibold">Your businesses</p>
            {!biz.data ? <Skeleton rows={2} /> : !biz.data.length ? (
              <p className="mt-1 text-xs text-muted-foreground">None yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {biz.data.slice(0, 5).map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {b.googleReviewUrl
                      ? <a href={b.googleReviewUrl} target="_blank" rel="noreferrer" title="Open Google review page" className="text-muted-foreground hover:text-primary"><ExternalLink className="size-3.5" /></a>
                      : <Pill tone="amber">No link</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <p className="text-sm font-semibold">More tools</p>
            <ul className="mt-2 space-y-1 text-[13px]">
              <li><Link className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted" href="/reviews/campaigns"><Megaphone className="size-3.5 text-muted-foreground" /> Campaigns <span className="ml-auto text-[11px] text-muted-foreground">group QR codes</span></Link></li>
              <li>
                <Link className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted" href="/reviews/jobs">
                  <Bot className="size-3.5 text-muted-foreground" /> Automation jobs
                  <span className="ml-auto">{health.data ? (health.data.online ? <Pill tone="green">Online</Pill> : <Pill tone="amber">Offline</Pill>) : null}</span>
                </Link>
              </li>
              <li><Link className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted" href="/reviews/settings"><Settings className="size-3.5 text-muted-foreground" /> Settings <span className="ml-auto text-[11px] text-muted-foreground">link checker</span></Link></li>
            </ul>
            {health.data && !health.data.online && <p className="mt-2 text-[11px] text-muted-foreground">The automation worker is off. Customers can still continue to Google without it.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
