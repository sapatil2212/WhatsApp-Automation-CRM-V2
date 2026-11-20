'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, PlayCircle, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BusinessPicker, Card, ErrorPanel, fmtDate, PageHead, Pill, Skeleton, SmallInput, useApi } from '@/components/reviews/shared';
import { api } from '@/lib/campaigns/api';
import { GOOGLE_LINK_STEPS } from '@/lib/reviews/google-url';

interface Health { online: boolean; lastHeartbeatAt: string | null; pid: number | null; concurrency: number | null; processed: number; failures: number; pendingJobs: number; runningJobs: number }

export default function ReviewSettingsPage() {
  const health = useApi<Health>('/api/reviews/automation/health');
  const [url, setUrl] = useState('');
  const [check, setCheck] = useState<{ valid: boolean; reason?: string; kind?: string; normalized?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [testBiz, setTestBiz] = useState('');
  const [testing, setTesting] = useState(false);

  const validate = async () => {
    setChecking(true);
    try {
      setCheck((await api<{ valid: boolean; reason?: string; kind?: string; normalized?: string }>('/api/reviews/businesses/validate-url', { method: 'POST', json: { url } })).data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const testLink = async () => {
    if (!testBiz) return toast.error('Choose a business.');
    setTesting(true);
    try {
      await api('/api/reviews/automation/prepare', { method: 'POST', json: { businessId: testBiz } });
      toast.success('Link check queued. See Automation Jobs for the result and screenshot.');
      void health.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHead title="Review settings" subtitle="Google link help, automation worker status and the fairness rules this module follows." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold">Automation worker</p>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void health.reload()}><RefreshCw className="size-3.5" /> Refresh</Button>
          </div>
          {health.error ? <ErrorPanel message={health.error} onRetry={health.reload} /> : !health.data ? <Skeleton rows={2} /> : (
            <div className="mt-2 space-y-1.5 text-xs">
              <p>{health.data.online ? <Pill tone="green">● Online</Pill> : <Pill tone="amber">● Offline</Pill>} <span className="ml-2 text-muted-foreground">Last heartbeat {fmtDate(health.data.lastHeartbeatAt)}</span></p>
              <p className="text-muted-foreground">Concurrency {health.data.concurrency ?? '—'} · processed {health.data.processed} · failures {health.data.failures}</p>
              <p className="text-muted-foreground">{health.data.pendingJobs} waiting · {health.data.runningJobs} running</p>
              {!health.data.online && <p className="text-[11px] text-muted-foreground">Run <code className="rounded bg-muted px-1">npm run worker:reviews</code> (or the PM2 file <code className="rounded bg-muted px-1">ecosystem.reviews.config.cjs</code>). Jobs wait in the queue until it starts.</p>}
            </div>
          )}
          <div className="mt-4 border-t border-border/70 pt-3">
            <p className="text-xs font-medium">Test a business&apos;s Google link</p>
            <p className="text-[11px] text-muted-foreground">The worker opens the link in an isolated browser and saves a screenshot. Nothing is posted.</p>
            <div className="mt-2 flex flex-wrap gap-2"><BusinessPicker value={testBiz} onChange={setTestBiz} allowAll={false} /><Button size="sm" className="h-8 gap-1.5 text-xs" disabled={testing} onClick={testLink}>{testing ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />} Run check</Button></div>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[13px] font-semibold">Find and check your Google review link</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">{GOOGLE_LINK_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
          <div className="mt-3 flex gap-2"><SmallInput value={url} onChange={(e) => { setUrl(e.target.value); setCheck(null); }} placeholder="Paste the link to check it" /><Button size="sm" variant="outline" className="h-8 text-xs" disabled={checking || !url.trim()} onClick={validate}>{checking ? <Loader2 className="size-3.5 animate-spin" /> : 'Check'}</Button></div>
          {check && (check.valid ? <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="size-3.5" /> Valid ({check.kind?.replace('_', ' ')}). Saved as: <span className="break-all">{check.normalized}</span></p> : <p className="mt-2 flex items-center gap-1 text-xs text-destructive"><XCircle className="size-3.5" /> {check.reason}</p>)}
        </Card>
      </div>

      <Card className="p-4">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold"><ShieldCheck className="size-4 text-primary" /> How this module keeps reviews honest</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Every rating from 1 to 5 gets the same page and the same Google link. Low ratings are never hidden or redirected elsewhere.</li>
          <li>The AI only rewrites what the customer said. It never invents experiences, and low ratings stay critical.</li>
          <li>The customer reads, edits and confirms the wording, then publishes it on Google themselves.</li>
          <li>The browser worker never signs in, never solves CAPTCHAs, never uses stealth tricks and never presses Publish. If Google asks for verification it stops.</li>
          <li>Opening Google is not counted as a published review. &ldquo;Customer said done&rdquo; is self-reported and cannot be verified by ChatNexGen.</li>
        </ul>
      </Card>
    </div>
  );
}