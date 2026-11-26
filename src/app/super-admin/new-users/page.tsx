"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus, Search, Trash2, CheckCircle,
  Loader2, RefreshCw, AlertCircle, FileText, ArrowRight,
  ExternalLink, MailCheck, ShieldAlert
} from "lucide-react";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  email: string;
  fullName: string;
  businessName: string;
  businessType: string;
  phoneNumber: string;
  role: string;
  isVerified: boolean;
  isEmailVerified: boolean;
  subscriptionExpiresAt: string | null;
  selectedPlan: string;
  paymentProofAttached: boolean;
  paymentProofUrl: string | null;
  createdAt: string;
}

const PLAN_BADGES: Record<string, { bg: string; text: string; border: string }> = {
  starter: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100" },
  growth:  { bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-100" },
  managed: { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-100" },
};

export default function NewUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/users");
      if (!res.ok) throw new Error("Failed to load users list.");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Filter only unverified users who have completed email verification (OTP verified)
  const pendingUsers = useMemo(() => {
    return users.filter(
      (u) =>
        u.isEmailVerified &&
        !u.isVerified &&
        (u.fullName.toLowerCase().includes(q.toLowerCase()) ||
          u.email.toLowerCase().includes(q.toLowerCase()))
    );
  }, [users, q]);

  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try {
      const res = await fetch("/api/super-admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isVerified: true }),
      });
      if (!res.ok) throw new Error("Could not approve user.");
      await fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm("Are you sure you want to reject and delete this registration?")) return;
    setRejectingId(id);
    try {
      const res = await fetch(`/api/super-admin/users?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not reject user.");
      await fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRejectingId(null);
    }
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <UserPlus className="size-5 text-violet-600" />
              New User Approvals
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Review payments and grant workspace access to new registrants.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold active:scale-[0.98] transition-all cursor-pointer"
            >
              <RefreshCw className={cn("size-3", loading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5 bg-white p-3 rounded-xl border border-slate-200">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 focus:bg-white transition-all"
            />
          </div>

          <div className="ml-auto text-[11px] text-slate-500 font-semibold">
            {pendingUsers.length} Pending Approval
          </div>
        </div>

        {/* Display Content */}
        {loading && users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-slate-200">
            <Loader2 className="size-6 text-violet-600 animate-spin" />
            <p className="text-xs text-slate-400 mt-2 font-semibold">Loading applications...</p>
          </div>
        ) : pendingUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 bg-white rounded-xl border border-slate-200 text-center px-4">
            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 mb-2.5">
              <MailCheck className="size-5 text-slate-400" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">All caught up!</h3>
            <p className="text-[11px] text-slate-400 mt-0.5 max-w-xs leading-relaxed">
              No new registration applications are currently pending approval.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden bg-white rounded-xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/75 text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                    <th className="px-3 py-2">Customer Details</th>
                    <th className="px-3 py-2">Business Info</th>
                    <th className="px-3 py-2 text-center">Selected Plan</th>
                    <th className="px-3 py-2">WhatsApp Link</th>
                    <th className="px-3 py-2">Registered Date</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  <AnimatePresence>
                    {pendingUsers.map((u) => {
                      const badge = PLAN_BADGES[u.selectedPlan.toLowerCase()] || PLAN_BADGES.starter;
                      return (
                        <motion.tr
                          key={u.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="hover:bg-slate-50/50 transition-colors"
                        >
                          {/* Name / Email */}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600/10 to-indigo-600/10 border border-violet-500/10 flex items-center justify-center text-violet-600 text-xs font-bold">
                                {u.fullName.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900 text-xs">{u.fullName}</p>
                                <p className="text-[10px] text-slate-500">{u.email}</p>
                              </div>
                            </div>
                          </td>

                          {/* Business */}
                          <td className="px-3 py-2">
                            <p className="font-semibold text-slate-900 text-xs">{u.businessName || "—"}</p>
                            <p className="text-[10px] text-slate-500">{u.businessType || "—"}</p>
                          </td>

                          {/* Selected Plan */}
                          <td className="px-3 py-2 text-center">
                            <span className={cn(
                              "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border capitalize",
                              badge.bg, badge.text, badge.border
                            )}>
                              {u.selectedPlan}
                            </span>
                          </td>

                          {/* Contact Link */}
                          <td className="px-3 py-2">
                            <a
                              href={`https://wa.me/${u.phoneNumber}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-500 font-bold text-xs"
                            >
                              {u.phoneNumber}
                              <ExternalLink className="size-2.5" />
                            </a>
                          </td>

                          {/* Registered At */}
                          <td className="px-3 py-2 text-slate-500 text-[10px]">
                            {new Date(u.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </td>

                          {/* Action Buttons */}
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Approve */}
                              <button
                                onClick={() => handleApprove(u.id)}
                                disabled={approvingId !== null || rejectingId !== null}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
                              >
                                {approvingId === u.id ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <CheckCircle className="size-3" />
                                )}
                                Approve Access
                              </button>

                              {/* Reject */}
                              <button
                                onClick={() => handleReject(u.id)}
                                disabled={approvingId !== null || rejectingId !== null}
                                className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-red-200 hover:border-red-300 text-red-500 hover:bg-red-50 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
                                title="Reject & Delete"
                              >
                                {rejectingId === u.id ? (
                                  <Loader2 className="size-3 animate-spin text-red-500" />
                                ) : (
                                  <Trash2 className="size-3" />
                                )}
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
