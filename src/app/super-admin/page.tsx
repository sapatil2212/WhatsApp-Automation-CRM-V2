"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Users, Wifi, MessageSquare, TrendingUp, Activity,
  ArrowRight, Loader2, Contact,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SuperAdminShell } from "./super-admin-shell";

interface Stats {
  totalUsers: number;
  verifiedUsers: number;
  waConnected: number;
  totalContacts: number;
  openConversations: number;
  totalConversations: number;
  planBreakdown: Record<string, number>;
  monthlySignups: { month: string; count: number }[];
}

interface User {
  id: string;
  email: string;
  fullName: string;
  plan: string;
  isVerified: boolean;
  waConnected: boolean;
  createdAt: string;
  contacts: number;
  conversations: number;
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
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [users,   setUsers]   = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/super-admin/stats").then((r) => r.json()),
      fetch("/api/super-admin/users").then((r) => r.json()),
    ]).then(([s, u]) => {
      setStats(s);
      setUsers((u.users ?? []).slice(0, 8));
    }).finally(() => setLoading(false));
  }, []);

  const signups = stats?.monthlySignups ?? [];
  const maxSignup = Math.max(...signups.map((m) => m.count), 1);

  const STAT_CARDS = stats ? [
    { label: "Total Users",       value: stats.totalUsers,       sub: `${stats.verifiedUsers} verified`,      icon: Users,        color: "from-violet-600 to-indigo-600", shadow: "shadow-violet-200/50" },
    { label: "WA Connected",      value: stats.waConnected,      sub: "active integrations",                  icon: Wifi,         color: "from-emerald-500 to-teal-600",  shadow: "shadow-emerald-200/50" },
    { label: "Total Contacts",    value: stats.totalContacts,    sub: "across all accounts",                  icon: Contact,      color: "from-blue-500 to-cyan-600",     shadow: "shadow-blue-200/50" },
    { label: "Open Conversations",value: stats.openConversations,sub: `${stats.totalConversations} total`,   icon: MessageSquare,color: "from-amber-500 to-orange-600",  shadow: "shadow-amber-200/50" },
  ] : [];

  return (
    <SuperAdminShell>
      <div className="space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
          <p className="mt-1 text-sm text-slate-500">Live agency-wide metrics from your database.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="text-center space-y-3">
              <Loader2 className="size-8 text-violet-600 animate-spin mx-auto" />
              <p className="text-sm text-slate-400">Loading dashboard data...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {STAT_CARDS.map((s, i) => (
                <motion.div key={s.label}
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="rounded-2xl border border-slate-200 bg-white p-5 relative overflow-hidden group hover:border-slate-300 hover:shadow-md hover:shadow-slate-100 transition-all duration-200"
                >
                  <div className={cn("absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl opacity-10 -translate-y-4 translate-x-4 bg-gradient-to-br pointer-events-none", s.color)} />
                  <div className="relative">
                    <div className="flex items-start justify-between mb-4">
                      <p className="text-sm text-slate-500 font-medium">{s.label}</p>
                      <div className={cn("w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md", s.color, s.shadow)}>
                        <s.icon className="size-4 text-white" />
                      </div>
                    </div>
                    <p className="text-3xl font-bold tabular-nums text-slate-900">{s.value.toLocaleString()}</p>
                    <p className="text-xs text-slate-400 mt-1 font-medium">{s.sub}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Signup chart */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
                className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100"
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <TrendingUp className="size-4 text-violet-500" /> Monthly Signups
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">Last 12 months</p>
                  </div>
                  <span className="text-xs bg-violet-50 border border-violet-100 text-violet-600 px-2.5 py-1 rounded-full font-bold">
                    {stats?.totalUsers} total
                  </span>
                </div>
                <div className="flex items-end gap-1.5 h-28">
                  {signups.map((m, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className={cn("w-full rounded-sm transition-all duration-200", i === signups.length - 1 ? "bg-violet-600" : "bg-slate-100 hover:bg-slate-200")}
                        style={{ height: `${Math.max((m.count / maxSignup) * 100, 4)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-2 text-[10px] text-slate-400 font-medium">
                  {signups.map((m) => <span key={m.month}>{m.month}</span>)}
                </div>
              </motion.div>

              {/* Plan breakdown */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42 }}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100"
              >
                <p className="text-sm font-semibold text-slate-800 mb-5 flex items-center gap-2">
                  <Activity className="size-4 text-violet-500" /> Plan Distribution
                </p>
                <div className="space-y-4">
                  {(["enterprise", "pro", "starter", "free"] as const).map((plan) => {
                    const count = stats?.planBreakdown[plan] ?? 0;
                    const total = Object.values(stats?.planBreakdown ?? {}).reduce((a, b) => a + b, 0) || 1;
                    return (
                      <div key={plan}>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="flex items-center gap-2">
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", PLAN_COLOR[plan])}>
                              {plan.toUpperCase()}
                            </span>
                          </span>
                          <span className="text-slate-500 font-semibold font-mono">{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100">
                          <div className={cn("h-full rounded-full transition-all duration-300", PLAN_BAR[plan])}
                            style={{ width: `${Math.min((count / total) * 100, 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            </div>

            {/* Recent users table */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
              className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm shadow-slate-100"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/50">
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <Users className="size-4 text-violet-500" /> Recent Users
                </p>
                <Link href="/super-admin/users"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs text-slate-600 hover:text-slate-800 font-semibold shadow-sm active:scale-[0.98] transition-all duration-200"
                >
                  View all <ArrowRight className="size-3.5" />
                </Link>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/20">
                      {["User", "Email", "Plan", "Status", "Contacts", "Joined"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => (
                      <motion.tr key={u.id}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        transition={{ delay: 0.5 + i * 0.04 }}
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600/10 to-indigo-600/10 border border-violet-500/10 flex items-center justify-center text-violet-600 text-xs font-bold shrink-0">
                              {(u.fullName || u.email).charAt(0).toUpperCase()}
                            </div>
                            <span className="font-semibold text-slate-800 truncate max-w-[120px]">{u.fullName || "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", PLAN_COLOR[u.plan] ?? PLAN_COLOR.free)}>
                            {u.plan.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border",
                            u.isVerified
                              ? "bg-emerald-50 border-emerald-250 text-emerald-700"
                              : "bg-slate-50 border-slate-200 text-slate-500"
                          )}>
                            {u.isVerified ? "Verified" : "Unverified"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 font-mono tabular-nums">{u.contacts}</td>
                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs font-medium">
                          {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                      </motion.tr>
                    ))}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                          No users found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </>
        )}
      </div>
    </SuperAdminShell>
  );
}
