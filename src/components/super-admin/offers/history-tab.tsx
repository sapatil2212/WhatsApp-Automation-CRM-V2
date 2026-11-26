"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, IndianRupee, Percent, Receipt, Search, TicketCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/campaigns/api";
import { formatPaise, planById } from "@/lib/billing/plans";
import { fmtDateTime, Pill, selectCls, StatCard, useAdminApi } from "./shared";
import type { PromoRow } from "./promo-tab";

interface Row {
  id: string;
  code: string;
  email: string;
  name: string | null;
  business: string | null;
  plan: string;
  originalPaise: number;
  discountPaise: number;
  finalPaise: number;
  status: "pending" | "redeemed" | "released";
  provider: string | null;
  providerPaymentId: string | null;
  createdAt: string;
  redeemedAt: string | null;
}
interface History {
  items: Row[];
  totals: { redeemed: number; discountPaise: number; revenuePaise: number; listPricePaise: number };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const STATUS = {
  redeemed: { tone: "green" as const, text: "Used" },
  pending: { tone: "amber" as const, text: "Payment open" },
  released: { tone: "muted" as const, text: "Not completed" },
};
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function HistoryTab({ promoId, onPromoChange }: { promoId: string; onPromoChange: (id: string) => void }) {
  const promos = useAdminApi<PromoRow[]>("/api/super-admin/promo-codes");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const query = useMemo(() => {
    const q = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (promoId) q.set("promoCodeId", promoId);
    if (status) q.set("status", status);
    if (debounced) q.set("search", debounced);
    return q;
  }, [page, promoId, status, debounced]);
  const { data, error, loading } = useAdminApi<History>(`/api/super-admin/promo-codes/history?${query}`);
  const t = data?.totals;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: Row[] = [];
      for (let p = 1; p <= 40; p++) {
        const q = new URLSearchParams(query);
        q.set("page", String(p));
        q.set("pageSize", "100");
        const res = (await api<History>(`/api/super-admin/promo-codes/history?${q}`)).data;
        all.push(...res.items);
        if (p >= res.pagination.totalPages) break;
      }
      const header = ["Date", "Code", "Email", "Name", "Business", "Plan", "List price (₹)", "Discount (₹)", "Paid (₹)", "Status", "Paid via", "Payment ID", "Used on"];
      const lines = all.map((r) => [r.createdAt, r.code, r.email, r.name, r.business, planById(r.plan)?.name ?? r.plan, r.originalPaise / 100, r.discountPaise / 100, r.finalPaise / 100, STATUS[r.status].text, r.provider, r.providerPaymentId, r.redeemedAt].map(csv).join(","));
      const url = URL.createObjectURL(new Blob(["\ufeff" + [header.map(csv).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `promo-history-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Times used" value={t?.redeemed ?? "—"} icon={TicketCheck} />
        <StatCard label="Discount given" value={t ? formatPaise(t.discountPaise) : "—"} icon={Percent} />
        <StatCard label="Revenue with codes" value={t ? formatPaise(t.revenuePaise) : "—"} icon={IndianRupee} />
        <StatCard label="Average saving" value={t?.redeemed ? `${Math.round((t.discountPaise / Math.max(1, t.listPricePaise)) * 100)}%` : "—"} sub="of the list price" icon={Receipt} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Promo code" className={`${selectCls} w-auto`} value={promoId} onChange={(e) => { onPromoChange(e.target.value); setPage(1); }}>
          <option value="">All promo codes</option>
          {(promos.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
        <div className="flex rounded-xl border border-border/70 bg-card p-1" role="tablist">
          {[{ id: "", label: "All" }, { id: "redeemed", label: "Used" }, { id: "pending", label: "Payment open" }, { id: "released", label: "Not completed" }].map((s) => (
            <button key={s.id || "all"} role="tab" aria-selected={status === s.id} onClick={() => { setStatus(s.id); setPage(1); }} className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${status === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{s.label}</button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Email or code…" className="h-8 pl-8 pr-8 text-[13px] md:text-[13px]" aria-label="Search" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-3.5" /></button>}
        </div>
        <Button variant="outline" size="sm" className="ml-auto gap-1.5" disabled={exporting || !data?.pagination.total} onClick={() => void exportCsv()}><Download className="size-3.5" /> Export CSV</Button>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed text-[13px]">
            <colgroup><col className="w-[15%]" /><col className="w-[24%]" /><col className="w-[13%]" /><col className="w-[18%]" /><col className="w-[12%]" /><col className="w-[18%]" /></colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-2">When</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Code · plan</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Payment</th></tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && !data ? (
                Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-8 animate-pulse rounded-lg bg-muted/70" /></td></tr>)
              ) : !data?.items.length ? (
                <tr><td colSpan={6} className="px-4 py-14 text-center text-[12px] text-muted-foreground">No promo code uses yet.</td></tr>
              ) : (
                data.items.map((r) => (
                  <tr key={r.id} className={r.status === "released" ? "opacity-60" : ""}>
                    <td className="px-4 py-2 text-[12px]">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-3 py-2"><p className="truncate font-medium">{r.name || r.email}</p><p className="truncate text-[11px] text-muted-foreground">{r.name ? r.email : ""}{r.business ? `${r.name ? " · " : ""}${r.business}` : ""}</p></td>
                    <td className="px-3 py-2"><p className="font-mono text-[12px] font-semibold">{r.code}</p><p className="text-[11px] text-muted-foreground">{planById(r.plan)?.name ?? r.plan}</p></td>
                    <td className="px-3 py-2"><p className="font-medium tabular-nums">{formatPaise(r.finalPaise)} <span className="text-[11px] font-normal text-muted-foreground line-through">{formatPaise(r.originalPaise)}</span></p><p className="text-[11px] text-emerald-600 dark:text-emerald-400">−{formatPaise(r.discountPaise)}</p></td>
                    <td className="px-3 py-2"><Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill></td>
                    <td className="px-3 py-2 text-[11px]"><p className="capitalize">{r.provider ?? "—"}</p><p className="truncate font-mono text-muted-foreground">{r.providerPaymentId ?? (r.redeemedAt ? fmtDateTime(r.redeemedAt) : "")}</p></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} totalPages={data?.pagination.totalPages ?? 1} total={data?.pagination.total ?? 0} onPage={setPage} label="uses" />
      </div>
    </div>
  );
}

export function Pager({ page, totalPages, total, onPage, label }: { page: number; totalPages: number; total: number; onPage: (p: number) => void; label: string }) {
  return (
    <div className="flex items-center justify-between border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
      <span>{total.toLocaleString("en-IN")} {label}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-3.5" /></Button>
        <span className="px-2 tabular-nums">Page {page} of {totalPages}</span>
        <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="size-3.5" /></Button>
      </div>
    </div>
  );
}
