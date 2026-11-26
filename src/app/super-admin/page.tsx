"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronRight, Clock, Contact, Globe, Loader2, LogIn, Mail, Megaphone, MessageSquare,
  Radio, RefreshCw, Search, Send, Server, TrendingUp, UserPlus as UserPlusIcon, Users, Wifi, XCircle, Zap,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { planById } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface SystemHealth {
  database: { status: string; latencyMs: number };
  metaWebhook: { status: string };
  smtp: { status: string };
  lastUpdated: string;
}

interface LiveTenant {
  id: string;
  name: string;
  ownerEmail: string;
  ownerName: string;
  plan: string;
  isActive: boolean;
  waStatus: string;
  phoneNumberId: string | null;
  contactsCount: number;
  conversationsCount: number;
  broadcastsCount: number;
  createdAt: string;
}

interface RecentEvent {
  id: string;
  type: "signup" | "message" | "broadcast";
  title: string;
  description: string;
  timestamp: string;
  badge: string;
  badgeColor: string;
}

interface Stats {
  totalUsers: number;
  verifiedUsers: number;
  unverifiedUsers: number;
  waConnected: number;
  waDisconnected: number;
  waConnectionRate: number;
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  totalContacts: number;
  openConversations: number;
  totalConversations: number;
  planBreakdown: Record<string, number>;
  monthlySignups: { month: string; count: number }[];
  throughput: {
    messagesLast24h: number;
    inbound24h: number;
    outbound24h: number;
    failed24h: number;
  };
  liveTenants: LiveTenant[];
  recentEvents: RecentEvent[];
  systemHealth: SystemHealth;
}

/** Tenant plan ids (including legacy ones) grouped under the current plans. */
const planLabel = (id: string) => planById(id)?.name ?? (id === "free" || !id ? "No plan" : id);
const PLAN_BAR = ["bg-primary", "bg-sky-500", "bg-amber-500", "bg-muted-foreground/40"];

export default function SuperAdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(10); // in seconds, 0 = paused
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Tenant list search & filter
  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState<"all" | "connected" | "disconnected" | "suspended">("all");

  // Impersonation state
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  // Quick announcement modal
  const [quickAlertOpen, setQuickAlertOpen] = useState(false);
  const [quickAlertSubmitting, setQuickAlertSubmitting] = useState(false);

  const fetchDashboardData = useCallback(async (isBackground = false) => {
    if (!isBackground) setRefreshing(true);
    try {
      const res = await fetch("/api/super-admin/stats");
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.totalUsers === "number") {
          setStats(data);
          setLastRefreshedAt(new Date());
        }
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Real-time polling timer
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchDashboardData(true);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshInterval, fetchDashboardData]);

  // Handle Tenant Impersonation (1-Click Login as Tenant)
  const handleImpersonate = async (tenant: LiveTenant) => {
    setImpersonatingId(tenant.id);
    try {
      const res = await fetch("/api/super-admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = data.redirectUrl || "/dashboard";
      } else {
        toast.error(data.error || "Could not open this workspace.");
      }
    } catch {
      toast.error("Network error. Could not open this workspace.");
    } finally {
      setImpersonatingId(null);
    }
  };

  // Filtered live tenants
  const filteredTenants = useMemo(() => {
    const list = stats?.liveTenants || [];
    return list.filter((t) => {
      const matchSearch =
        !tenantSearch ||
        t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
        t.ownerEmail.toLowerCase().includes(tenantSearch.toLowerCase());

      const matchFilter =
        tenantFilter === "all" ? true :
        tenantFilter === "connected" ? t.waStatus === "connected" :
        tenantFilter === "disconnected" ? t.waStatus !== "connected" :
        tenantFilter === "suspended" ? !t.isActive : true;

      return matchSearch && matchFilter;
    });
  }, [stats?.liveTenants, tenantSearch, tenantFilter]);

  const signups = stats?.monthlySignups ?? [];
  const maxSignup = Math.max(...signups.map((m) => m.count), 1);
  const plans = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const [id, n] of Object.entries(stats?.planBreakdown ?? {})) grouped.set(planLabel(id), (grouped.get(planLabel(id)) ?? 0) + n);
    const total = [...grouped.values()].reduce((a, b) => a + b, 0) || 1;
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]).map(([label, count], i) => ({ label, count, pct: Math.round((count / total) * 100), bar: PLAN_BAR[i % PLAN_BAR.length] }));
  }, [stats?.planBreakdown]);

  const health = stats?.systemHealth;
  const healthItems = health
    ? [
        { label: "Database", ok: health.database.status === "healthy", value: health.database.status === "healthy" ? `Healthy · ${health.database.latencyMs} ms` : "Not responding", icon: Server },
        { label: "WhatsApp webhook", ok: health.metaWebhook.status === "ready", value: health.metaWebhook.status === "ready" ? "Verify token set" : "Not configured", icon: Globe },
        { label: "WhatsApp numbers", ok: stats.waConnected > 0, value: `${stats.waConnected} connected · ${stats.waConnectionRate}%`, icon: Radio },
        { label: "Email (SMTP)", ok: health.smtp.status === "ready", value: health.smtp.status === "ready" ? "Configured" : "Not configured", icon: Mail },
      ]
    : [];

  const statCards = stats
    ? [
        { label: "Accounts", value: stats.totalUsers, sub: `${stats.verifiedUsers} approved · ${stats.unverifiedUsers} pending`, icon: Users, href: "/super-admin/users" },
        { label: "WhatsApp connected", value: stats.waConnected, sub: `${stats.waDisconnected} not connected`, icon: Wifi },
        { label: "Messages (24h)", value: stats.throughput?.messagesLast24h ?? 0, sub: `${stats.throughput?.inbound24h ?? 0} in · ${stats.throughput?.outbound24h ?? 0} out${stats.throughput?.failed24h ? ` · ${stats.throughput.failed24h} failed` : ""}`, icon: MessageSquare },
        { label: "Contacts", value: stats.totalContacts, sub: `${stats.openConversations} open chats of ${stats.totalConversations}`, icon: Contact },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              <span className={cn("size-1.5 rounded-full bg-current", autoRefreshInterval > 0 && "animate-pulse")} />
              {autoRefreshInterval > 0 ? "Live" : "Paused"}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Accounts, WhatsApp connections and message traffic across all workspaces. Updated {lastRefreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[12px] text-muted-foreground">
            <Clock className="size-3.5" />
            <span className="sr-only sm:not-sr-only">Refresh</span>
            <select value={autoRefreshInterval} onChange={(e) => setAutoRefreshInterval(Number(e.target.value))} className="bg-transparent text-[12px] font-medium text-foreground outline-none" aria-label="Auto refresh">
              <option value={5}>every 5s</option>
              <option value={10}>every 10s</option>
              <option value={30}>every 30s</option>
              <option value={0}>paused</option>
            </select>
          </label>
          <Button variant="outline" size="icon-sm" onClick={() => fetchDashboardData(false)} disabled={refreshing} aria-label="Refresh now" title="Refresh now">
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setQuickAlertOpen(true)}>
            <Megaphone className="size-3.5" /> Broadcast alert
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[74px] animate-pulse rounded-xl bg-muted/70" />)}</div>
          <div className="h-72 animate-pulse rounded-2xl bg-muted/70" />
        </div>
      ) : !stats ? (
        <div className="rounded-2xl border border-border/70 bg-card px-4 py-14 text-center">
          <AlertTriangle className="mx-auto size-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">Could not load the dashboard</p>
          <p className="mt-1 text-xs text-muted-foreground">Check the database connection, then try again.</p>
          <Button size="sm" className="mt-4" onClick={() => fetchDashboardData(false)}>Retry</Button>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {statCards.map((s) => {
              const body = (
                <>
                  <div className="flex items-center justify-between">
                    <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><s.icon className="size-3.5" /></span>
                  </div>
                  <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{s.value.toLocaleString()}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{s.sub}</p>
                </>
              );
              return s.href ? (
                <Link key={s.label} href={s.href} className="rounded-xl border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-primary/40">{body}</Link>
              ) : (
                <div key={s.label} className="rounded-xl border border-border/70 bg-card px-3 py-2.5">{body}</div>
              );
            })}
          </div>

          {/* System health */}
          {healthItems.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {healthItems.map((h) => (
                <div key={h.label} className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2">
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", h.ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400")}>
                    <h.icon className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{h.label}</p>
                    <p className="flex items-center gap-1 truncate text-[12px] font-medium">
                      {h.ok ? <CheckCircle2 className="size-3 shrink-0 text-emerald-500" /> : <AlertTriangle className="size-3 shrink-0 text-amber-500" />}
                      {h.value}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Workspaces + activity */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-card xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">Workspaces</h2>
                  <p className="text-[11px] text-muted-foreground">Plan, WhatsApp connection and volume. Open any workspace as its owner.</p>
                </div>
                <Link href="/super-admin/users" className="flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">All users ({stats.totalUsers}) <ChevronRight className="size-3.5" /></Link>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2.5">
                <div className="flex rounded-xl border border-border/70 bg-background p-1" role="tablist">
                  {[
                    { id: "all", label: "All" },
                    { id: "connected", label: "WA connected" },
                    { id: "disconnected", label: "Not connected" },
                    { id: "suspended", label: "Suspended" },
                  ].map((f) => (
                    <button key={f.id} role="tab" aria-selected={tenantFilter === f.id} onClick={() => setTenantFilter(f.id as typeof tenantFilter)} className={cn("rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors", tenantFilter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="relative min-w-[180px] flex-1 sm:max-w-[240px]">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)} placeholder="Business or owner email…" className="h-8 pl-8 text-[13px] md:text-[13px]" aria-label="Search workspaces" />
                </div>
                <p className="ml-auto text-[11px] text-muted-foreground">{filteredTenants.length} shown</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] table-fixed text-[13px]">
                  <colgroup><col className="w-[36%]" /><col className="w-[16%]" /><col className="w-[18%]" /><col className="w-[16%]" /><col className="w-[96px]" /></colgroup>
                  <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Workspace</th>
                      <th className="px-3 py-2">Plan</th>
                      <th className="px-3 py-2">WhatsApp</th>
                      <th className="px-3 py-2">Volume</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {filteredTenants.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-12 text-center"><Users className="mx-auto size-8 text-muted-foreground/60" /><p className="mt-2.5 text-sm font-medium">No workspaces match</p><p className="mt-1 text-xs text-muted-foreground">Try a different search or filter.</p></td></tr>
                    ) : (
                      filteredTenants.map((t) => (
                        <tr key={t.id} className="transition-colors hover:bg-muted/50">
                          <td className="px-4 py-2">
                            <p className="flex items-center gap-1.5 truncate font-medium">
                              <span className="truncate">{t.name}</span>
                              {!t.isActive && <span className="shrink-0 rounded-full bg-rose-500/10 px-1.5 py-px text-[10px] font-medium text-rose-700 dark:text-rose-400">Suspended</span>}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">{t.ownerEmail}</p>
                          </td>
                          <td className="px-3 py-2"><span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{planLabel(t.plan)}</span></td>
                          <td className="px-3 py-2">
                            <span className={cn("inline-flex items-center gap-1.5 text-[12px]", t.waStatus === "connected" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                              <span className={cn("size-1.5 rounded-full", t.waStatus === "connected" ? "bg-emerald-500" : "bg-rose-400")} />
                              {t.waStatus === "connected" ? "Connected" : "Not connected"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[12px] tabular-nums text-muted-foreground">{t.contactsCount.toLocaleString()} contacts · {t.conversationsCount.toLocaleString()} chats</td>
                          <td className="px-3 py-2 text-right">
                            <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => handleImpersonate(t)} disabled={impersonatingId === t.id} title="Open this workspace as its owner">
                              {impersonatingId === t.id ? <Loader2 className="size-3 animate-spin" /> : <LogIn className="size-3" />} Open
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Zap className="size-3.5 text-amber-500" /> Recent activity</h2>
                <span className="text-[11px] text-muted-foreground">{(stats.recentEvents ?? []).length} events</span>
              </div>
              <ul className="max-h-[460px] flex-1 divide-y divide-border/70 overflow-y-auto">
                {(stats.recentEvents ?? []).length === 0 ? (
                  <li className="px-4 py-12 text-center text-[12px] text-muted-foreground">No activity yet.</li>
                ) : (
                  stats.recentEvents.map((evt) => {
                    const Icon = evt.type === "signup" ? UserPlusIcon : evt.type === "broadcast" ? Send : MessageSquare;
                    return (
                      <li key={evt.id} className="flex gap-2.5 px-4 py-2.5">
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-3.5" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-[12px] font-medium">{evt.title}</p>
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          <p className="line-clamp-2 text-[11px] text-muted-foreground">{evt.description}</p>
                          <span className="mt-0.5 inline-flex rounded-full bg-muted px-1.5 py-px text-[10px] font-medium capitalize text-muted-foreground">{evt.badge}</span>
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </div>

          {/* Growth + plans */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-card p-4 xl:col-span-2">
              <div className="mb-4 flex items-start justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold"><TrendingUp className="size-3.5 text-primary" /> Signups by month</h2>
                  <p className="text-[11px] text-muted-foreground">Last 12 months</p>
                </div>
                <span className="text-[11px] text-muted-foreground">{signups.reduce((a, m) => a + m.count, 0)} in this period</span>
              </div>
              <div className="flex h-28 items-end gap-1.5">
                {signups.map((m, i) => (
                  <div key={m.month} className="group relative flex h-full flex-1 flex-col justify-end">
                    <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-medium tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">{m.count}</span>
                    <div className={cn("w-full rounded-sm transition-colors", i === signups.length - 1 ? "bg-primary" : "bg-primary/25 group-hover:bg-primary/40")} style={{ height: `${Math.max((m.count / maxSignup) * 100, 4)}%` }} title={`${m.month}: ${m.count}`} />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between gap-1.5 text-[10px] text-muted-foreground">
                {signups.map((m) => <span key={m.month} className="flex-1 truncate text-center">{m.month}</span>)}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card p-4">
              <h2 className="mb-3.5 flex items-center gap-1.5 text-sm font-semibold"><Activity className="size-3.5 text-primary" /> Workspaces by plan</h2>
              {plans.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-muted-foreground">No workspaces yet.</p>
              ) : (
                <div className="space-y-3">
                  {plans.map((pl) => (
                    <div key={pl.label}>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="font-medium">{pl.label}</span>
                        <span className="tabular-nums text-muted-foreground">{pl.count} · {pl.pct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", pl.bar)} style={{ width: `${pl.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Broadcast alert */}
      <AnimatePresence>
        {quickAlertOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Broadcast alert" onMouseDown={(e) => e.target === e.currentTarget && setQuickAlertOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="w-full max-w-md overflow-hidden rounded-t-2xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 sm:rounded-2xl">
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <div>
                  <h2 className="text-[15px] font-semibold">Broadcast alert</h2>
                  <p className="text-[11px] text-muted-foreground">Shown as a banner at the top of every workspace dashboard.</p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => setQuickAlertOpen(false)}><XCircle className="size-4" /></Button>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setQuickAlertSubmitting(true);
                  const fd = new FormData(e.currentTarget);
                  const payload = { title: fd.get("title"), content: fd.get("content"), type: fd.get("type"), priority: "urgent", targetPlan: "all", isActive: true, isDismissible: true };
                  try {
                    const res = await fetch("/api/super-admin/cms/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                    if (res.ok) {
                      setQuickAlertOpen(false);
                      toast.success("Alert published to all workspaces.");
                    } else {
                      toast.error("Could not publish the alert.");
                    }
                  } catch {
                    toast.error("Network error. The alert was not published.");
                  } finally {
                    setQuickAlertSubmitting(false);
                  }
                }}
              >
                <div className="space-y-3 px-5 py-4">
                  <div className="space-y-1"><Label htmlFor="alert-title" className="text-[12px]">Headline *</Label><Input id="alert-title" name="title" required maxLength={120} placeholder="Scheduled maintenance tonight at 2 AM" className="h-8 text-[13px] md:text-[13px]" /></div>
                  <div className="space-y-1">
                    <Label htmlFor="alert-type" className="text-[12px]">Type</Label>
                    <select id="alert-type" name="type" defaultValue="warning" className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                      <option value="warning">Warning (amber)</option>
                      <option value="alert">Critical (red)</option>
                      <option value="info">Notice (blue)</option>
                      <option value="maintenance">Maintenance (indigo)</option>
                    </select>
                  </div>
                  <div className="space-y-1"><Label htmlFor="alert-content" className="text-[12px]">Message *</Label><Textarea id="alert-content" name="content" required rows={3} maxLength={500} placeholder="What workspaces should know" className="text-[13px] md:text-[13px]" /></div>
                </div>
                <div className="flex justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => setQuickAlertOpen(false)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={quickAlertSubmitting} className="gap-1.5">{quickAlertSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : <Megaphone className="size-3.5" />} Publish</Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}