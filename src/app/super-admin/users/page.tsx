"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Search, MoreVertical, Trash2, CheckCircle, XCircle,
  X, Loader2, ChevronUp, ChevronDown, RefreshCw, Plus,
  Wifi, WifiOff, ShieldCheck, ShieldOff, Eye, EyeOff,
  Edit2, MessageSquare, Radio, Zap, Crown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SuperAdminShell } from "../super-admin-shell";

interface User {
  id: string;
  email: string;
  fullName: string;
  businessName: string;
  businessType: string;
  phoneNumber: string;
  role: string;
  isVerified: boolean;
  plan: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantActive: boolean;
  waStatus: string;
  waConnected: boolean;
  contacts: number;
  conversations: number;
  broadcasts: number;
  automations: number;
  createdAt: string;
  updatedAt: string;
}

type SortKey = "fullName" | "email" | "plan" | "contacts" | "conversations" | "createdAt";
type FilterStatus = "all" | "verified" | "unverified" | "wa_connected";
type FilterPlan = "all" | "free" | "starter" | "pro" | "enterprise";

const PLAN_COLOR: Record<string, string> = {
  free:       "bg-slate-50 border-slate-255 text-slate-600",
  starter:    "bg-blue-50 border-blue-100 text-blue-600",
  pro:        "bg-violet-50 border-violet-100 text-violet-600",
  enterprise: "bg-amber-50 border-amber-100 text-amber-600",
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Avatar({ name, email }: { name: string; email: string }) {
  return (
    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600/10 to-indigo-600/10 border border-violet-500/10 flex items-center justify-center text-violet-600 text-sm font-bold shrink-0">
      {(name || email).charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Add / Edit User Modal ───────────────────────────────────────────────────
function UserModal({
  user,
  onSave,
  onClose,
}: {
  user?: User | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const isEdit = !!user;
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [showPass, setShowPass] = useState(false);

  const [form, setForm] = useState({
    email:        user?.email        ?? "",
    password:     "",
    fullName:     user?.fullName     ?? "",
    businessName: user?.businessName ?? "",
    businessType: user?.businessType ?? "",
    phoneNumber:  user?.phoneNumber  ?? "",
    plan:         user?.plan         ?? "free",
    role:         user?.role         ?? "tenant_admin",
    isVerified:   user?.isVerified   ?? true,
  });

  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      let res: Response;
      if (isEdit) {
        res = await fetch("/api/super-admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: user!.id, ...form }),
        });
      } else {
        res = await fetch("/api/super-admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
      } else {
        onSave();
        onClose();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 transition-all";
  const labelCls = "block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            {isEdit ? <Edit2 className="size-4 text-violet-500" /> : <Plus className="size-4 text-violet-500" />}
            {isEdit ? "Edit User" : "Add New User"}
          </h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Full Name *</label>
              <input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required placeholder="Jane Doe" className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Email Address *</label>
              <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required disabled={isEdit} placeholder="jane@example.com" className={cn(inputCls, isEdit && "opacity-50 cursor-not-allowed bg-slate-50")} />
            </div>
            {!isEdit && (
              <div className="col-span-2">
                <label className={labelCls}>Password *</label>
                <div className="relative">
                  <input type={showPass ? "text" : "password"} value={form.password} onChange={(e) => set("password", e.target.value)} required placeholder="••••••••" className={cn(inputCls, "pr-10")} />
                  <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                    {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className={labelCls}>Business Name</label>
              <input value={form.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="Acme Inc." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone Number</label>
              <input value={form.phoneNumber} onChange={(e) => set("phoneNumber", e.target.value)} placeholder="+1 555 0000" className={inputCls} />
            </div>
          </div>

          {/* Subscription */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
              <Crown className="size-3.5 text-amber-500" /> Subscription & Access
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Plan</label>
                <select value={form.plan} onChange={(e) => set("plan", e.target.value)} className={cn(inputCls, "cursor-pointer bg-white")}>
                  <option value="free">Free</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Role</label>
                <select value={form.role} onChange={(e) => set("role", e.target.value)} className={cn(inputCls, "cursor-pointer bg-white")}>
                  <option value="tenant_admin">Tenant Admin</option>
                  <option value="staff">Staff</option>
                  <option value="user">User</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800">Dashboard Access</p>
                <p className="text-xs text-slate-500 mt-0.5">Allow this user to log in and use their dashboard</p>
              </div>
              <button
                type="button"
                onClick={() => set("isVerified", !form.isVerified)}
                className={cn("relative w-11 h-6 rounded-full transition-colors duration-200", form.isVerified ? "bg-violet-600" : "bg-slate-200")}
              >
                <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200", form.isVerified ? "translate-x-5" : "translate-x-0")} />
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-150 px-4 py-3">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-500 hover:bg-slate-50 hover:border-slate-350 hover:text-slate-700 shadow-sm active:scale-[0.98] transition-all duration-200">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white text-sm font-bold shadow-md shadow-violet-500/20 hover:shadow-lg hover:shadow-violet-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="size-4 animate-spin" /> : (isEdit ? <CheckCircle className="size-4" /> : <Plus className="size-4" />)}
              {loading ? "Saving..." : (isEdit ? "Save Changes" : "Create User")}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SuperAdminUsersPage() {
  const [users,    setUsers]    = useState<User[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [statusF,  setStatusF]  = useState<FilterStatus>("all");
  const [planF,    setPlanF]    = useState<FilterPlan>("all");
  const [sortKey,  setSortKey]  = useState<SortKey>("createdAt");
  const [sortDir,  setSortDir]  = useState<"asc" | "desc">("desc");
  const [detail,   setDetail]   = useState<User | null>(null);
  const [delId,    setDelId]    = useState<string | null>(null);
  const [editUser, setEditUser] = useState<User | null | "new">(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos,  setMenuPos]  = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/super-admin/users")
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let r = users.filter((u) => {
      const q = search.toLowerCase();
      const matchQ = !q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.businessName.toLowerCase().includes(q);
      const matchS =
        statusF === "all"         ? true :
        statusF === "verified"    ? u.isVerified :
        statusF === "unverified"  ? !u.isVerified :
        statusF === "wa_connected"? u.waConnected : true;
      const matchP = planF === "all" ? true : u.plan === planF;
      return matchQ && matchS && matchP;
    });
    return [...r].sort((a, b) => {
      const av = a[sortKey] ?? "", bv = b[sortKey] ?? "";
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [users, search, statusF, planF, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const SI = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortDir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />) : null;

  const toggleAccess = async (u: User) => {
    setToggling(u.id);
    await fetch("/api/super-admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, isVerified: !u.isVerified }),
    });
    setUsers((p) => p.map((x) => x.id === u.id ? { ...x, isVerified: !u.isVerified } : x));
    if (detail?.id === u.id) setDetail((prev) => prev ? { ...prev, isVerified: !u.isVerified } : null);
    setToggling(null);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/super-admin/users?id=${id}`, { method: "DELETE" });
    setUsers((p) => p.filter((u) => u.id !== id));
    setDelId(null);
    if (detail?.id === id) setDetail(null);
  };

  return (
    <SuperAdminShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Users className="size-6 text-violet-500" /> Users
            </h1>
            <p className="mt-1 text-sm text-slate-500 font-medium">
              {users.length} registered · {users.filter((u) => u.isVerified).length} verified · {users.filter((u) => u.waConnected).length} WA connected
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-800 hover:bg-slate-50 hover:border-slate-350 shadow-sm text-xs font-semibold active:scale-[0.97] transition-all duration-200">
              <RefreshCw className="size-3.5" /> Refresh
            </button>
            <button
              onClick={() => setEditUser("new")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-violet-500/20 hover:shadow-lg hover:shadow-violet-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
            >
              <Plus className="size-3.5" /> Add User
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, or business..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/10 transition-all" />
          </div>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value as FilterStatus)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:border-violet-500/60 transition-all">
            <option value="all">All Status</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
            <option value="wa_connected">WA Connected</option>
          </select>
          <select value={planF} onChange={(e) => setPlanF(e.target.value as FilterPlan)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:border-violet-500/60 transition-all">
            <option value="all">All Plans</option>
            <option value="free">Free</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm shadow-slate-100">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="size-7 text-violet-600 animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-visible">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/40">
                    {([
                      ["fullName",      "User",          true],
                      ["email",         "Email",         true],
                      ["plan",          "Plan",          true],
                      ["status",        "Access",        false],
                      ["wa",            "WhatsApp",      false],
                      ["contacts",      "Contacts",      true],
                      ["conversations", "Convos",        true],
                      ["createdAt",     "Joined",        true],
                    ] as [SortKey | string, string, boolean][]).map(([k, label, sortable]) => (
                      <th key={k} className="px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                        {sortable
                          ? <button onClick={() => toggleSort(k as SortKey)} className="flex items-center gap-1 hover:text-slate-600 transition-colors">{label}<SI k={k as SortKey} /></button>
                          : label}
                      </th>
                    ))}
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-14 text-center text-sm text-slate-400 font-medium">
                          No users found.
                        </td>
                      </tr>
                    ) : filtered.map((u, i) => (
                      <motion.tr key={u.id}
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ delay: i * 0.02 }}
                        className={cn("border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors cursor-pointer", !u.isVerified && "opacity-75")}
                        onClick={() => setDetail(u)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={u.fullName} email={u.email} />
                            <div>
                              <p className="font-semibold text-slate-800">{u.fullName || "—"}</p>
                              {u.businessName && <p className="text-[10px] text-slate-400 font-medium">{u.businessName}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", PLAN_COLOR[u.plan] ?? PLAN_COLOR.free)}>
                            {u.plan.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {u.isVerified
                            ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-100 text-emerald-600"><CheckCircle className="size-2.5" />Active</span>
                            : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-50 border-red-100 text-red-600"><XCircle className="size-2.5" />Blocked</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          {u.waConnected
                            ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-100 text-emerald-600"><Wifi className="size-2.5" />Connected</span>
                            : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 border-slate-100 text-slate-400"><WifiOff className="size-2.5" />None</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-slate-600 font-mono tabular-nums">{u.contacts}</td>
                        <td className="px-4 py-3 text-slate-600 font-mono tabular-nums">{u.conversations}</td>
                        <td className="px-4 py-3 text-slate-400 font-medium whitespace-nowrap">{fmt(u.createdAt)}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
                              setOpenMenu(openMenu === u.id ? null : u.id);
                            }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                          >
                            <MoreVertical className="size-4" />
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/20 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Showing {filtered.length} of {users.length} users</span>
            <button onClick={() => { setSearch(""); setStatusF("all"); setPlanF("all"); }} className="flex items-center gap-1 hover:text-slate-800 transition-colors">
              <RefreshCw className="size-3" /> Reset filters
            </button>
          </div>
        </div>

        {/* Dropdown context menu */}
        {openMenu && typeof document !== "undefined" && createPortal(
          <>
            <div className="fixed inset-0 z-[99]" onClick={() => setOpenMenu(null)} />
            <AnimatePresence>
              {(() => {
                const u = filtered.find((x) => x.id === openMenu);
                if (!u) return null;
                return (
                  <motion.div key="menu"
                    initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                    style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 100 }}
                    className="w-44 rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button onClick={() => { setEditUser(u); setOpenMenu(null); }}
                      className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all duration-200 first:rounded-t-xl">
                      <Edit2 className="size-3.5" /> Edit User
                    </button>
                    <button onClick={() => { toggleAccess(u); setOpenMenu(null); }}
                      className={cn("flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-semibold transition-all duration-200",
                        u.isVerified ? "text-amber-600 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50")}>
                      {toggling === u.id ? <Loader2 className="size-3.5 animate-spin" /> : u.isVerified ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                      {u.isVerified ? "Block Access" : "Grant Access"}
                    </button>
                    <button onClick={() => { setDelId(u.id); setOpenMenu(null); }}
                      className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-semibold text-red-500 hover:bg-red-50 transition-all duration-200 last:rounded-b-xl">
                      <Trash2 className="size-3.5" /> Delete
                    </button>
                  </motion.div>
                );
              })()}
            </AnimatePresence>
          </>,
          document.body
        )}

        {/* Detail drawer */}
        <AnimatePresence>
          {detail && (
            <div className="fixed inset-0 z-50 flex justify-end">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDetail(null)} />
              <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                className="relative w-full max-w-sm h-full overflow-y-auto bg-white border-l border-slate-200 shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Drawer header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/50 sticky top-0 z-10">
                  <h3 className="font-bold text-slate-800">User Profile</h3>
                  <button onClick={() => setDetail(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                    <X className="size-4" />
                  </button>
                </div>

                <div className="p-5 space-y-5 flex-1">
                  {/* Avatar + name */}
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600/10 to-indigo-600/10 border border-violet-500/10 flex items-center justify-center text-violet-600 text-2xl font-bold">
                      {(detail.fullName || detail.email).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-slate-900">{detail.fullName || "—"}</h4>
                      <p className="text-sm text-slate-500">{detail.email}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", PLAN_COLOR[detail.plan] ?? PLAN_COLOR.free)}>
                          {detail.plan.toUpperCase()}
                        </span>
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border",
                          detail.isVerified ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-red-50 border-red-100 text-red-600"
                        )}>
                          {detail.isVerified ? "Active" : "Blocked"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Contacts",    value: detail.contacts,      icon: Users },
                      { label: "Convos",      value: detail.conversations, icon: MessageSquare },
                      { label: "Broadcasts",  value: detail.broadcasts,    icon: Radio },
                      { label: "Automations", value: detail.automations,   icon: Zap },
                    ].map((m) => (
                      <div key={m.label} className="rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-center">
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">{m.label}</p>
                        <p className="text-lg font-bold text-slate-800 mt-0.5">{m.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Account info */}
                  <div className="space-y-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Account</p>
                    {[
                      { label: "Business",   value: detail.businessName || "—" },
                      { label: "Role",       value: detail.role },
                      { label: "Access",     value: detail.isVerified ? "✓ Granted" : "✗ Blocked" },
                      { label: "Joined",     value: fmt(detail.createdAt) },
                      { label: "Updated",    value: fmt(detail.updatedAt) },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium">{r.label}</span>
                        <span className="font-semibold text-slate-800">{r.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* WhatsApp info */}
                  <div className="space-y-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">WhatsApp</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Status</span>
                      <span className={cn("font-semibold", detail.waConnected ? "text-emerald-600" : "text-slate-400")}>
                        {detail.waStatus}
                      </span>
                    </div>
                  </div>

                  {/* Tenant / Subscription */}
                  {detail.tenantName && (
                    <div className="space-y-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Subscription</p>
                      {[
                        { label: "Tenant",  value: detail.tenantName },
                        { label: "Plan",    value: detail.plan.toUpperCase() },
                        { label: "Active",  value: detail.tenantActive ? "Yes" : "No" },
                      ].map((r) => (
                        <div key={r.label} className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">{r.label}</span>
                          <span className="font-semibold text-slate-800">{r.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-2 pt-2">
                    <button onClick={() => { setEditUser(detail); setDetail(null); }}
                      className="w-full py-2.5 rounded-xl bg-violet-50 hover:bg-violet-100 hover:border-violet-200 border border-violet-100 text-violet-600 text-xs font-bold shadow-sm active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2">
                      <Edit2 className="size-3.5" /> Edit User & Subscription
                    </button>
                    <button onClick={() => toggleAccess(detail)} disabled={toggling === detail.id}
                      className={cn("w-full py-2.5 rounded-xl border text-xs font-bold shadow-sm active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2",
                        detail.isVerified
                          ? "bg-amber-55 border-amber-100 text-amber-700 hover:bg-amber-100"
                          : "bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100"
                      )}>
                      {toggling === detail.id ? <Loader2 className="size-3.5 animate-spin" /> : detail.isVerified ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                      {detail.isVerified ? "Block Dashboard Access" : "Grant Dashboard Access"}
                    </button>
                    <button onClick={() => { setDelId(detail.id); setDetail(null); }}
                      className="w-full py-2.5 rounded-xl bg-red-50 hover:bg-red-100 hover:border-red-200 border border-red-150 text-red-600 text-xs font-bold shadow-sm active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2">
                      <Trash2 className="size-3.5" /> Delete User
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {/* Delete confirm */}
          {delId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDelId(null)} />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto">
                  <Trash2 className="size-6 text-red-500" />
                </div>
                <div className="text-center">
                  <h3 className="font-bold text-slate-800">Delete User?</h3>
                  <p className="text-sm text-slate-500 mt-1">Permanently removes this user and all their data. This cannot be undone.</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setDelId(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-500 hover:bg-slate-50 hover:border-slate-300 shadow-sm active:scale-[0.98] transition-all duration-200">Cancel</button>
                  <button onClick={() => handleDelete(delId)} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-md shadow-red-500/20 active:scale-[0.98] hover:scale-[1.02] transition-all duration-200">Delete</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Add/Edit User Modal */}
        <AnimatePresence>
          {editUser !== null && (
            <UserModal
              user={editUser === "new" ? null : editUser}
              onSave={load}
              onClose={() => setEditUser(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </SuperAdminShell>
  );
}
