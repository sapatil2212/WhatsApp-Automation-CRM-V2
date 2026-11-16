"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Wifi, MessageSquare, TrendingUp, Activity,
  ArrowRight, Loader2, Contact, RefreshCw, Zap, Shield,
  Radio, CheckCircle2, AlertTriangle, XCircle, ArrowUpRight,
  Send, ExternalLink, Server, Globe, Mail, Clock, Megaphone,
  Plus, Search, SlidersHorizontal, Lock, LogIn, ChevronRight
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SuperAdminShell } from "./super-admin-shell";

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

const PLAN_COLOR: Record<string, string> = {
  free:       "bg-slate-50 border-slate-200 text-slate-600",
  starter:    "bg-blue-50 border-blue-100 text-blue-600",
  pro:        "bg-violet-50 border-violet-100 text-violet-600",
  enterprise: "bg-amber-50 border-amber-100 text-amber-600",
};

const PLAN_BAR: Record<string, string> = {
  free: "bg-slate-400", starter: "bg-blue-500", pro: "bg-violet-500", enterprise: "bg-amber-500",
};

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
        alert(data.error || "Failed to impersonate tenant");
      }
    } catch {
      alert("Network error trying to impersonate tenant");
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

  return (
    <SuperAdminShell>
      <div className="space-y-4">
        {/* Top Header & Real-time Live Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Super Admin Live Command Center</h1>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Monitoring
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Real-time multi-tenant health, WhatsApp Gateway throughput, and platform infrastructure.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Auto refresh dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 text-[11px]">
              <Clock className="size-3 text-slate-400" />
              <span className="text-slate-500 font-medium">Auto-Refresh:</span>
              <select
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                className="bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer text-[11px]"
              >
                <option value={5}>Every 5s</option>
                <option value={10}>Every 10s</option>
                <option value={30}>Every 30s</option>
                <option value={0}>Paused</option>
              </select>
            </div>

            {/* Manual refresh button */}
            <button
              onClick={() => fetchDashboardData(false)}
              disabled={refreshing}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-semibold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
              title="Refresh now"
            >
              <RefreshCw className={cn("size-3 text-slate-500", refreshing && "animate-spin text-violet-600")} />
              <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
            </button>

            {/* Broadcast In-App Announcement Button */}
            <button
              onClick={() => setQuickAlertOpen(true)}
              className="px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-bold flex items-center gap-1.5 transition active:scale-95"
            >
              <Megaphone className="size-3" />
              <span>Broadcast Alert</span>
            </button>
          </div>
        </div>

        {/* System Infrastructure Health Ribbon */}
        {stats?.systemHealth && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                <Server className="size-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Database Status</p>
                <p className="text-[11px] font-bold text-slate-800 truncate">
                  Operational <span className="text-[9px] text-emerald-600 font-mono">({stats.systemHealth.database.latencyMs}ms)</span>
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-violet-50 text-violet-600">
                <Globe className="size-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Meta Cloud API</p>
                <p className="text-[11px] font-bold text-slate-800 truncate">
                  v21.0 Webhook Ready
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                <Radio className="size-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">WhatsApp Gateway</p>
                <p className="text-[11px] font-bold text-slate-800 truncate">
                  {stats.waConnectionRate}% Connected
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                <Mail className="size-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">SMTP Email Service</p>
                <p className="text-[11px] font-bold text-slate-800 truncate">
                  Active (Gmail Relay)
                </p>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center space-y-2">
              <Loader2 className="size-6 text-violet-600 animate-spin mx-auto" />
              <p className="text-xs text-slate-400">Connecting to live agency database...</p>
            </div>
          </div>
        ) : !stats ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-2">
            <p className="text-xs text-slate-600 font-medium">Unable to load dashboard data.</p>
            <button
              onClick={() => fetchDashboardData(false)}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Primary Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Card 1: Total Tenants */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 relative overflow-hidden group hover:border-slate-300 transition">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Tenants</p>
                  <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center font-bold">
                    <Users className="size-3.5" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {stats.totalUsers.toLocaleString()}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-bold text-emerald-600">{stats.verifiedUsers} verified</span>
                  <span>•</span>
                  <span className="text-slate-400">{stats.unverifiedUsers} pending</span>
                </div>
              </div>

              {/* Card 2: WhatsApp Gateways */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 relative overflow-hidden group hover:border-slate-300 transition">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">WhatsApp Gateways</p>
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                    <Wifi className="size-3.5" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {stats.waConnected.toLocaleString()}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-bold text-emerald-600">{stats.waConnectionRate}% health</span>
                  <span>•</span>
                  <span className="text-slate-400">{stats.waDisconnected} offline</span>
                </div>
              </div>

              {/* Card 3: 24h Message Volume */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 relative overflow-hidden group hover:border-slate-300 transition">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">24h Message Traffic</p>
                  <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                    <MessageSquare className="size-3.5" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {(stats.throughput?.messagesLast24h ?? 0).toLocaleString()}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-bold text-blue-600">{stats.throughput?.inbound24h ?? 0} in</span>
                  <span>•</span>
                  <span className="text-slate-600">{stats.throughput?.outbound24h ?? 0} out</span>
                </div>
              </div>

              {/* Card 4: Total CRM Contacts */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 relative overflow-hidden group hover:border-slate-300 transition">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Managed Contacts</p>
                  <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                    <Contact className="size-3.5" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {stats.totalContacts.toLocaleString()}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-bold text-amber-600">{stats.openConversations} active chats</span>
                  <span>•</span>
                  <span className="text-slate-400">{stats.totalConversations} total</span>
                </div>
              </div>
            </div>

            {/* Realtime Tenant Monitor Grid + Live Event Stream Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Left 2 Cols: Live Tenant Monitor */}
              <div className="lg:col-span-2 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  {/* Table Header Controls */}
                  <div className="p-3 sm:p-3.5 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 bg-slate-50/40">
                    <div>
                      <h3 className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                        <Radio className="size-3.5 text-emerald-500 animate-pulse" />
                        Live Tenant Health & Control
                      </h3>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Direct 1-click tenant workspace impersonation, status, and WhatsApp gateway status.
                      </p>
                    </div>

                    <Link
                      href="/super-admin/users"
                      className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-1 shrink-0"
                    >
                      All Users ({stats.totalUsers}) <ChevronRight className="size-3" />
                    </Link>
                  </div>

                  {/* Search and Filters */}
                  <div className="px-3 py-2 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2">
                    <div className="relative w-full sm:w-56">
                      <Search className="size-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Filter live tenants..."
                        value={tenantSearch}
                        onChange={(e) => setTenantSearch(e.target.value)}
                        className="w-full pl-7 pr-2.5 py-1 text-[11px] rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-violet-500 transition"
                      />
                    </div>

                    <div className="flex items-center gap-1 w-full sm:w-auto overflow-x-auto text-[11px]">
                      {[
                        { id: "all", label: "All" },
                        { id: "connected", label: "WA Online" },
                        { id: "disconnected", label: "WA Offline" },
                        { id: "suspended", label: "Suspended" },
                      ].map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setTenantFilter(f.id as any)}
                          className={cn(
                            "px-2 py-0.5 rounded-md font-medium text-[10px] transition",
                            tenantFilter === f.id
                              ? "bg-violet-600 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          )}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tenants List */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/30 text-slate-400 uppercase tracking-wider text-[9px]">
                          <th className="px-3 py-2 text-left font-bold">Tenant Business</th>
                          <th className="px-2.5 py-2 text-left font-bold">Plan</th>
                          <th className="px-2.5 py-2 text-left font-bold">WhatsApp Gateway</th>
                          <th className="px-2.5 py-2 text-left font-bold">Volume</th>
                          <th className="px-3 py-2 text-right font-bold">Quick Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredTenants.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-slate-400 text-[11px]">
                              No matching tenants found.
                            </td>
                          </tr>
                        ) : (
                          filteredTenants.map((t) => (
                            <tr key={t.id} className="hover:bg-slate-50/60 transition">
                              <td className="px-3 py-2">
                                <div>
                                  <p className="font-bold text-slate-800 text-xs truncate max-w-[150px] sm:max-w-[200px]">
                                    {t.name}
                                  </p>
                                  <p className="text-[10px] text-slate-400 truncate max-w-[150px] sm:max-w-[200px]">
                                    {t.ownerEmail}
                                  </p>
                                </div>
                              </td>

                              <td className="px-2.5 py-2">
                                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded uppercase border", PLAN_COLOR[t.plan] || PLAN_COLOR.free)}>
                                  {t.plan}
                                </span>
                              </td>

                              <td className="px-2.5 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      "w-1.5 h-1.5 rounded-full",
                                      t.waStatus === "connected" ? "bg-emerald-500" : "bg-red-400"
                                    )}
                                  />
                                  <span className={cn("font-medium capitalize text-[10px]", t.waStatus === "connected" ? "text-emerald-700" : "text-slate-500")}>
                                    {t.waStatus}
                                  </span>
                                </div>
                              </td>

                              <td className="px-2.5 py-2 font-mono text-[10px] text-slate-600">
                                <span title="Contacts">{t.contactsCount}c</span> •{" "}
                                <span title="Conversations">{t.conversationsCount} chats</span>
                              </td>

                              <td className="px-3 py-2 text-right">
                                <button
                                  onClick={() => handleImpersonate(t)}
                                  disabled={impersonatingId === t.id}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 hover:bg-violet-100 text-violet-700 font-bold text-[10px] border border-violet-100 transition active:scale-95"
                                  title="Log in directly as this tenant"
                                >
                                  {impersonatingId === t.id ? (
                                    <Loader2 className="size-2.5 animate-spin" />
                                  ) : (
                                    <LogIn className="size-2.5" />
                                  )}
                                  Login
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right Col: Real-time Event Stream */}
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2.5">
                    <h3 className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                      <Zap className="size-3.5 text-amber-500" />
                      Live Activity Ticker
                    </h3>
                    <span className="text-[9px] text-slate-400 font-mono">Real-time</span>
                  </div>

                  <div className="space-y-2 max-h-[420px] overflow-y-auto pr-0.5">
                    {(stats.recentEvents || []).length === 0 ? (
                      <p className="text-[11px] text-slate-400 text-center py-6">Waiting for incoming tenant events...</p>
                    ) : (
                      stats.recentEvents.map((evt) => (
                        <div
                          key={evt.id}
                          className="p-2 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-white hover:border-slate-200 transition space-y-1"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[11px] font-bold text-slate-800 line-clamp-1">{evt.title}</span>
                            <span className={cn("text-[8px] font-bold px-1 py-0.2 rounded capitalize", evt.badgeColor)}>
                              {evt.badge}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-600 leading-normal line-clamp-2">
                            {evt.description}
                          </p>
                          <p className="text-[9px] text-slate-400 font-mono">
                            {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Growth & Plan Distribution Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Monthly signups */}
              <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <TrendingUp className="size-3.5 text-violet-500" /> Monthly Tenant Signups
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Last 12 calendar months</p>
                  </div>
                  <span className="text-[10px] bg-violet-50 border border-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-bold">
                    {stats.totalUsers} Total Accounts
                  </span>
                </div>
                <div className="flex items-end gap-1.5 h-24">
                  {signups.map((m, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className={cn("w-full rounded-sm transition-all duration-200", i === signups.length - 1 ? "bg-violet-600" : "bg-slate-100 hover:bg-slate-200")}
                        style={{ height: `${Math.max((m.count / maxSignup) * 100, 4)}%` }}
                        title={`${m.month}: ${m.count} signups`}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-2 text-[9px] text-slate-400 font-medium">
                  {signups.map((m) => <span key={m.month}>{m.month}</span>)}
                </div>
              </div>

              {/* Plan breakdown */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="text-xs font-semibold text-slate-800 mb-3.5 flex items-center gap-1.5">
                  <Activity className="size-3.5 text-violet-500" /> Subscription Tier Distribution
                </p>
                <div className="space-y-2.5">
                  {(["enterprise", "pro", "starter", "free"] as const).map((plan) => {
                    const count = stats.planBreakdown?.[plan] ?? 0;
                    const total = Object.values(stats.planBreakdown ?? {}).reduce((a, b) => a + b, 0) || 1;
                    return (
                      <div key={plan}>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="flex items-center gap-1.5">
                            <span className={cn("text-[9px] font-bold px-1.5 py-0.2 rounded border", PLAN_COLOR[plan])}>
                              {plan.toUpperCase()}
                            </span>
                          </span>
                          <span className="text-slate-500 font-semibold font-mono text-[10px]">{count} tenants</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all duration-300", PLAN_BAR[plan])}
                            style={{ width: `${Math.min((count / total) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ─── MODAL: Quick In-App Tenant Alert ─── */}
      <AnimatePresence>
        {quickAlertOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <Megaphone className="size-3.5 text-violet-600" />
                  Broadcast Live Alert to Tenants
                </h3>
                <button
                  onClick={() => setQuickAlertOpen(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600"
                >
                  <XCircle className="size-3.5" />
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setQuickAlertSubmitting(true);
                  const fd = new FormData(e.currentTarget);
                  const payload = {
                    title: fd.get("title"),
                    content: fd.get("content"),
                    type: fd.get("type"),
                    priority: "urgent",
                    targetPlan: "all",
                    isActive: true,
                    isDismissible: true,
                  };

                  try {
                    const res = await fetch("/api/super-admin/cms/announcements", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                    });
                    if (res.ok) {
                      setQuickAlertOpen(false);
                      alert("Broadcast banner published to all tenant dashboards!");
                    } else {
                      alert("Failed to publish alert");
                    }
                  } catch {
                    alert("Network error broadcasting alert");
                  } finally {
                    setQuickAlertSubmitting(false);
                  }
                }}
                className="p-4 space-y-3"
              >
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Alert Headline</label>
                  <input
                    name="title"
                    required
                    placeholder="e.g. Scheduled Maintenance Tonight at 2 AM"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Banner Type</label>
                  <select
                    name="type"
                    defaultValue="warning"
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                  >
                    <option value="warning">Warning (Amber)</option>
                    <option value="alert">Critical / Emergency (Red)</option>
                    <option value="info">General Notice (Blue)</option>
                    <option value="maintenance">Maintenance (Indigo)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Alert Message</label>
                  <textarea
                    name="content"
                    required
                    rows={3}
                    placeholder="This alert will appear immediately on the top of all active tenant dashboards..."
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setQuickAlertOpen(false)}
                    className="flex-1 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={quickAlertSubmitting}
                    className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    {quickAlertSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : "Publish Alert"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </SuperAdminShell>
  );
}
