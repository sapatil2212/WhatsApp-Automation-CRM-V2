"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CreditCard, IndianRupee, Percent, Plug, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatPaise, planById } from "@/lib/billing/plans";
import { fmtDateTime, Pill, StatCard, useAdminApi } from "./shared";
import { Pager } from "./history-tab";

interface Row {
  id: string;
  email: string;
  plan: string;
  provider: string;
  amountPaise: number;
  originalPaise: number;
  discountPaise: number;
  promoCode: string | null;
  orderId: string | null;
  paymentId: string | null;
  status: "created" | "paid" | "failed";
  method: string | null;
  failureReason: string | null;
  confirmedVia: string | null;
  paidAt: string | null;
  createdAt: string;
}
interface Payments {
  items: Row[];
  totals: { paid: number; revenuePaise: number; discountPaise: number };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  razorpay: { configured: boolean; source: "dashboard" | "env" | null; mode: "live" | "test" | null; webhookSecretSet: boolean; webhookUrl: string; lastWebhook: { event: string; at: string } | null };
}

const STATUS = { paid: { tone: "green" as const, text: "Paid" }, created: { tone: "amber" as const, text: "Not completed" }, failed: { tone: "red" as const, text: "Failed" } };

export function PaymentsTab() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const query = useMemo(() => {
    const q = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (status) q.set("status", status);
    if (debounced) q.set("search", debounced);
    return q;
  }, [page, status, debounced]);
  const { data, error, loading } = useAdminApi<Payments>(`/api/super-admin/payments?${query}`);
  const rz = data?.razorpay;

  return (
    <div className="space-y-4">
      {/* Razorpay setup (keys and webhook are managed in Integrations) */}
      {rz && (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${rz.configured && rz.webhookSecretSet ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
          <div className="flex items-start gap-2.5">
            {rz.configured && rz.webhookSecretSet ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />}
            <div>
              <p className="text-sm font-semibold">
                Razorpay {rz.configured ? `connected · ${rz.mode === "live" ? "Live" : "Test mode"} · keys from ${rz.source === "dashboard" ? "dashboard" : ".env"}` : "not connected"}
                {rz.configured && !rz.webhookSecretSet && " · webhook secret missing"}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {!rz.configured
                  ? "Signups and renewals cannot be paid until Razorpay keys are added."
                  : !rz.webhookSecretSet
                    ? "Payments work, but add a webhook secret so payments are confirmed even if the customer closes the page."
                    : `Signups and renewals pay online and activate automatically. Last webhook: ${rz.lastWebhook ? fmtDateTime(rz.lastWebhook.at) : "none yet"}.`}
              </p>
            </div>
          </div>
          <Link href="/super-admin/integrations" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 text-[12px] font-medium hover:bg-accent">
            <Plug className="size-3.5" /> {rz.configured && rz.webhookSecretSet ? "Manage keys & webhook" : "Set up Razorpay"}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <StatCard label="Paid orders" value={data?.totals.paid ?? "—"} icon={CreditCard} />
        <StatCard label="Revenue collected" value={data ? formatPaise(data.totals.revenuePaise) : "—"} icon={IndianRupee} />
        <StatCard label="Promo discounts" value={data ? formatPaise(data.totals.discountPaise) : "—"} icon={Percent} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border/70 bg-card p-1" role="tablist">
          {[{ id: "", label: "All" }, { id: "paid", label: "Paid" }, { id: "created", label: "Not completed" }, { id: "failed", label: "Failed" }].map((s) => (
            <button key={s.id || "all"} role="tab" aria-selected={status === s.id} onClick={() => { setStatus(s.id); setPage(1); }} className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${status === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{s.label}</button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Email, order or payment ID…" className="h-8 pl-8 pr-8 text-[13px] md:text-[13px]" aria-label="Search payments" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-3.5" /></button>}
        </div>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed text-[13px]">
            <colgroup><col className="w-[15%]" /><col className="w-[22%]" /><col className="w-[16%]" /><col className="w-[12%]" /><col className="w-[35%]" /></colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-2">When</th><th className="px-3 py-2">Customer · plan</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && !data ? (
                Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-8 animate-pulse rounded-lg bg-muted/70" /></td></tr>)
              ) : !data?.items.length ? (
                <tr><td colSpan={5} className="px-4 py-14 text-center text-[12px] text-muted-foreground">No payments yet.</td></tr>
              ) : (
                data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-[12px]">{fmtDateTime(p.paidAt ?? p.createdAt)}</td>
                    <td className="px-3 py-2"><p className="truncate font-medium">{p.email}</p><p className="text-[11px] text-muted-foreground">{planById(p.plan)?.name ?? p.plan}{p.provider === "free" ? " · free with promo" : ""}</p></td>
                    <td className="px-3 py-2"><p className="font-medium tabular-nums">{formatPaise(p.amountPaise)}</p>{p.discountPaise > 0 && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{p.promoCode} −{formatPaise(p.discountPaise)}</p>}</td>
                    <td className="px-3 py-2"><Pill tone={STATUS[p.status].tone}>{STATUS[p.status].text}</Pill></td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">
                      {p.paymentId && <p className="truncate font-mono">{p.paymentId}{p.method ? ` · ${p.method}` : ""}{p.confirmedVia ? ` · via ${p.confirmedVia}` : ""}</p>}
                      {p.orderId && <p className="truncate font-mono">{p.orderId}</p>}
                      {p.failureReason && <p className="truncate text-rose-600 dark:text-rose-400">{p.failureReason}</p>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} totalPages={data?.pagination.totalPages ?? 1} total={data?.pagination.total ?? 0} onPage={setPage} label="payments" />
      </div>
    </div>
  );
}
