'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownRight, ArrowUpRight, CalendarCheck, CalendarDays, Clock, Megaphone, MessageSquare,
  RefreshCw, Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AreaChart, BarList, Donut } from '@/components/dashboard/charts';
import { BookingLinkCard } from '@/components/booking/booking-link-card';
import { useAuth } from '@/hooks/use-auth';
import { useTenantEvents } from '@/hooks/use-tenant-events';

interface Overview {
  segment: 'healthcare' | 'business';
  range: number;
  kpis: {
    contacts: { total: number; new: number; trend: number };
    conversations: { open: number; unread: number };
    messages: { inbound: number; outbound: number };
    bookings: { total: number; trend: number; upcoming: number };
    campaigns: { sent: number; deliveryRate: number; readRate: number; replyRate: number };
  };
  series: { days: string[]; inbound: number[]; outbound: number[]; newContacts: number[]; bookings: number[] };
  bookingsByStatus: Array<{ label: string; value: number }>;
  bookingsByGroup: Array<{ label: string; value: number }>;
  intents: Array<{ label: string; value: number }>;
  upcoming: Array<{ id: string; name: string; date: string; time: string; with: string; token: number | string | null }>;
  recentConversations: Array<{ id: string; name: string; text: string; at: string | null; unread: number }>;
}

const STATUS_COLORS: Record<string, string> = { scheduled: '#3b82f6', confirmed: '#3b82f6', pending: '#f59e0b', completed: '#10b981', cancelled: '#ef4444', no_show: '#64748b' };
const fmtTime = (t: string) => { const [h, m] = t.split(':').map(Number); return Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` : t; };
const ago = (iso: string | null) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

function Card({ title, action, children, className = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-border/70 bg-card p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, trend, icon: Icon, href }: { label: string; value: string; sub?: string; trend?: number; icon: React.ElementType; href?: string }) {
  const body = (
    <div className="h-full rounded-xl border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-primary/40">
      <div className="flex items-center justify-between">
        <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="size-3.5" /></span>
      </div>
      <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{value}</p>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {trend !== undefined && (
          <span className={`inline-flex items-center gap-0.5 font-medium ${trend >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {trend >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(trend)}%
          </span>
        )}
        {sub}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Skeleton() {
  return (
    <div className="space-y-5">
      <div className="h-10 w-72 animate-pulse rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[72px] animate-pulse rounded-xl bg-muted/60" />)}</div>
      <div className="grid gap-5 lg:grid-cols-3"><div className="h-80 animate-pulse rounded-2xl bg-muted/50 lg:col-span-2" /><div className="h-80 animate-pulse rounded-2xl bg-muted/50" /></div>
    </div>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const [range, setRange] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetchTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/analytics/overview?days=${range}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.message || 'Failed to load analytics');
      setData(body.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);
  // Fallback refresh every minute; live events refresh sooner.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);
  useTenantEvents(() => {
    if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
    refetchTimer.current = window.setTimeout(load, 1500);
  });

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <p className="text-sm">{error}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={load}>Retry</Button>
      </div>
    );
  }
  if (!data) return <Skeleton />;

  const k = data.kpis;
  const isClinic = data.segment === 'healthcare';
  const firstName = (profile?.full_name ?? '').split(' ')[0];
  const bookingsHref = isClinic ? '/healthcare/appointments' : `/${(profile as { business_type?: string } | null)?.business_type ?? 'business'}/appointments`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{firstName ? `Welcome back, ${firstName}` : 'Dashboard'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setRange(d)} aria-pressed={range === d} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${range === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>{d}d</button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5"><RefreshCw className="size-3.5" /> Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label={isClinic ? 'Appointments' : 'Bookings'} value={k.bookings.total.toLocaleString()} trend={k.bookings.trend} sub={`${k.bookings.upcoming} upcoming`} icon={CalendarCheck} href={bookingsHref} />
        <Kpi label="New contacts" value={k.contacts.new.toLocaleString()} trend={k.contacts.trend} sub={`${k.contacts.total.toLocaleString()} total`} icon={Users} href="/contacts" />
        <Kpi label="Conversations" value={k.conversations.open.toLocaleString()} sub={`${k.conversations.unread} unread`} icon={MessageSquare} href="/inbox" />
        <Kpi label="Messages sent" value={k.messages.outbound.toLocaleString()} sub={`${k.messages.inbound.toLocaleString()} received`} icon={MessageSquare} />
        <Kpi label="Campaign reach" value={k.campaigns.sent.toLocaleString()} sub={`${k.campaigns.readRate}% read · ${k.campaigns.replyRate}% replied`} icon={Megaphone} href="/campaigns" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Conversations & bookings" className="lg:col-span-2">
          <AreaChart
            labels={data.series.days}
            series={[
              { name: 'Messages in', values: data.series.inbound, color: '#3b82f6' },
              { name: 'Messages out', values: data.series.outbound, color: '#10b981' },
              { name: isClinic ? 'Appointments' : 'Bookings', values: data.series.bookings, color: '#f59e0b' },
              { name: 'New contacts', values: data.series.newContacts, color: '#8b5cf6' },
            ]}
          />
        </Card>
        <Card title={isClinic ? 'Appointment status' : 'Booking status'}>
          <Donut items={data.bookingsByStatus.map((s) => ({ ...s, color: STATUS_COLORS[s.label] }))} center={isClinic ? 'appointments' : 'bookings'} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={isClinic ? 'Upcoming appointments' : 'Upcoming bookings'} action={<Link href={bookingsHref} className="text-xs font-medium text-primary hover:underline">View all</Link>}>
          {data.upcoming.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Nothing scheduled yet. Share your booking link to start receiving bookings.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.upcoming.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <span className="text-[9px] font-semibold uppercase leading-none">{new Date(`${u.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })}</span>
                    <span className="text-sm font-bold leading-tight">{new Date(`${u.date}T00:00:00Z`).getUTCDate()}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{u.name}</span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><Clock className="size-3" /> {fmtTime(u.time)}{u.with ? ` · ${u.with}` : ''}</span>
                  </span>
                  {u.token !== null && <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold">#{u.token}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="What customers ask (AI intents)">
          <BarList items={data.intents} empty="AI conversations will appear here." />
        </Card>
        <Card title="Latest conversations" action={<Link href="/inbox" className="text-xs font-medium text-primary hover:underline">Inbox</Link>}>
          <ul className="divide-y divide-border/60">
            {data.recentConversations.map((c) => (
              <li key={c.id}>
                <Link href="/inbox" className="flex items-center gap-3 py-2 hover:text-primary">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.text || '—'}</span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                    {ago(c.at)}
                    {c.unread > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{c.unread}</span>}
                  </span>
                </Link>
              </li>
            ))}
            {!data.recentConversations.length && <li className="py-6 text-center text-xs text-muted-foreground">No conversations yet.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <BookingLinkCard />
        <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-5">
          <CalendarDays className="size-8 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-semibold">Automatic WhatsApp reminders are on</p>
            <p className="text-muted-foreground">Confirmations with clinic queue numbers, reminders 1 day / 2 hours / 1 hour before, thank-you, no-show, health check and follow-up messages are sent automatically.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
