"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Eye, FileUp, Package, Pencil, Plus, RefreshCw, Search, Trash2, UserCheck, UserPlus, UserX, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { api } from "@/lib/campaigns/api";
import { getTerminology } from "@/lib/business/terminology";
import { fmtDate, fmtPhone, type GymPackage, type Member } from "@/lib/gym/format";
import { MemberForm } from "@/components/gym/member-form";
import { MemberDetailDialog } from "@/components/gym/member-detail";
import { MemberImportDialog } from "@/components/gym/member-import-dialog";
import { MembershipBadge, PaymentBadge } from "@/components/gym/member-badges";

type Filter = "all" | "active" | "expiring" | "expired" | "no_package" | "frozen";
interface ListData {
  items: Member[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  stats: { total: number; active: number; expiring: number; expired: number; newThisMonth: number };
}

const TABS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "expiring", label: "Expiring soon" },
  { id: "expired", label: "Expired" },
  { id: "no_package", label: "No package" },
  { id: "frozen", label: "Frozen" },
];
const selectCls = "h-8 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
const AVATARS = ["bg-sky-500/15", "bg-emerald-500/15", "bg-violet-500/15", "bg-amber-500/15", "bg-rose-500/15", "bg-teal-500/15"];
const avatarColor = (id: string) => AVATARS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export default function MembersPage() {
  const { businessSegment } = useParams<{ businessSegment: string }>();
  const term = getTerminology(businessSegment);
  const [data, setData] = useState<ListData | null>(null);
  const [packages, setPackages] = useState<GymPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingSetup, setMissingSetup] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [packageId, setPackageId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Array<Pick<Member, "id" | "name" | "memberCode">> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ filter, page: String(page), pageSize: String(pageSize) });
      if (debounced) q.set("search", debounced);
      if (packageId) q.set("packageId", packageId);
      const [list, pk] = await Promise.all([api<ListData>(`/api/gym/members?${q}`), api<{ items: GymPackage[] }>("/api/gym/packages")]);
      setData(list.data);
      setPackages(pk.data.items);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 404) setMissingSetup(true);
      else toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize, debounced, packageId]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.items ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allSelected) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.add(r.id)); return n; });
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const filtersActive = Boolean(debounced || packageId);
  const changeFilter = (f: Filter) => { setFilter(f); setPage(1); setSelected(new Set()); };

  const stats = useMemo(
    () => [
      { label: `Total ${term.clientPluralLabel.toLowerCase()}`, value: data?.stats.total, icon: Users, onClick: () => changeFilter("all") },
      { label: "Active", value: data?.stats.active, icon: UserCheck, onClick: () => changeFilter("active") },
      { label: "Expiring in 7 days", value: data?.stats.expiring, icon: CalendarClock, onClick: () => changeFilter("expiring"), warn: Boolean(data?.stats.expiring) },
      { label: "Expired", value: data?.stats.expired, icon: UserX, onClick: () => changeFilter("expired") },
      { label: "New this month", value: data?.stats.newThisMonth, icon: UserPlus, onClick: () => changeFilter("all") },
    ],
    [data, term.clientPluralLabel],
  );

  if (missingSetup) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <Users className="size-9 text-muted-foreground/60" />
        <h3 className="mt-3 text-sm font-semibold">Finish your business setup first</h3>
        <p className="mt-1 text-xs text-muted-foreground">{term.clientPluralLabel} belong to your business profile.</p>
        <Button size="sm" className="mt-4" render={<Link href={`/${businessSegment}/setup`} />}>Open setup</Button>
      </div>
    );
  }

  const noPackages = !loading && packages.length === 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{term.clientPluralLabel}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Onboard {term.clientPluralLabel.toLowerCase()}, assign packages and track renewals and payments.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => void load()} aria-label="Refresh" title="Refresh"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImporting(true)}><FileUp className="size-3.5" /> Import</Button>
          <Button size="sm" className="gap-1.5" onClick={() => setEditing("new")}><Plus className="size-3.5" /> New {term.clientLabel.toLowerCase()}</Button>
        </div>
      </div>

      {noPackages && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[13px]">
          <p className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0 text-amber-600" /> Add your packages first, so you can assign one while onboarding.</p>
          <Button size="sm" variant="outline" className="gap-1.5" render={<Link href={`/${businessSegment}/packages`} />}><Package className="size-3.5" /> Set up packages</Button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <button key={s.label} type="button" onClick={s.onClick} className={`rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 ${s.warn ? "border-amber-500/40" : "border-border/70"}`}>
            <div className="flex items-center justify-between">
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${s.warn ? "bg-amber-500/10 text-amber-600" : "bg-primary/10 text-primary"}`}><s.icon className="size-3.5" /></span>
            </div>
            <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{s.value === undefined ? "—" : s.value.toLocaleString()}</p>
          </button>
        ))}
      </div>

      {/* Tabs + toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-xl border border-border/70 bg-card p-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={filter === t.id} onClick={() => changeFilter(t.id)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${filter === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{t.label}</button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, phone, member ID…" className="h-8 pl-8 pr-8 text-[13px] md:text-[13px]" aria-label="Search members" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-3.5" /></button>}
        </div>
        {packages.length > 0 && (
          <select aria-label="Filter by package" className={selectCls} value={packageId} onChange={(e) => { setPackageId(e.target.value); setPage(1); }}>
            <option value="">All packages</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {filtersActive && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setSearch(""); setPackageId(""); }}>Clear filters</Button>}
        <p className="ml-auto text-[11px] text-muted-foreground">{(data?.pagination.total ?? 0).toLocaleString()} {filtersActive || filter !== "all" ? "matching" : term.clientPluralLabel.toLowerCase()}</p>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[13px]" role="status">
          <span className="font-medium">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleting(rows.filter((r) => selected.has(r.id)))}><Trash2 className="size-3.5" /> Delete selected</Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] table-fixed text-[13px]">
            <colgroup>
              <col className="w-10" />
              <col className="w-[25%]" />
              <col className="w-[19%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[11%]" />
              <col className="w-[112px]" />
            </colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-2 pl-4"><input type="checkbox" className="size-4 rx-check" aria-label="Select all on this page" checked={allSelected} onChange={toggleAll} disabled={rows.length === 0} /></th>
                <th className="px-4 py-2">{term.clientLabel}</th>
                <th className="px-3 py-2">Package</th>
                <th className="px-3 py-2">Validity</th>
                <th className="px-3 py-2">Payment</th>
                <th className="px-3 py-2">Joined</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && rows.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-9 animate-pulse rounded-lg bg-muted/70" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <Users className="mx-auto size-9 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">{filtersActive || filter !== "all" ? `No ${term.clientPluralLabel.toLowerCase()} match` : `No ${term.clientPluralLabel.toLowerCase()} yet`}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{filtersActive || filter !== "all" ? "Try a different tab, search or package." : "Add them one by one, or import your existing register and let AI fill in the details."}</p>
                    {!filtersActive && filter === "all" && (
                      <div className="mt-4 flex justify-center gap-2">
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImporting(true)}><FileUp className="size-3.5" /> Import</Button>
                        <Button size="sm" className="gap-1.5" onClick={() => setEditing("new")}><Plus className="size-3.5" /> New {term.clientLabel.toLowerCase()}</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((m) => (
                  <tr key={m.id} onClick={() => setViewing(m.id)} className={`group cursor-pointer transition-colors hover:bg-muted/50 ${selected.has(m.id) ? "bg-primary/5" : ""} ${loading ? "opacity-60" : ""}`}>
                    <td className="py-2 pl-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="size-4 rx-check" aria-label={`Select ${m.name}`} checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} /></td>
                    <td className="px-4 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-foreground ${avatarColor(m.id)}`}>{initials(m.name)}</span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium">
                            <span className="truncate">{m.name}</span>
                            {m.status !== "active" && <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium capitalize text-muted-foreground">{m.status}</span>}
                            {m.medicalNotes && <AlertTriangle className="size-3 shrink-0 text-rose-500" aria-label="Has medical notes" />}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground"><span className="font-mono">{m.memberCode}</span> · <span className="font-mono tabular-nums">{fmtPhone(m.phone)}</span></p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {m.current ? (
                        <>
                          <p className="truncate">{m.current.packageName}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{fmtDate(m.current.startDate)} – {fmtDate(m.current.endDate)}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2"><MembershipBadge m={m.current} /></td>
                    <td className="px-3 py-2">{m.current ? <PaymentBadge m={m.current} /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">{fmtDate(m.joinedAt)}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-0.5">
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="View" aria-label={`View ${m.name}`} onClick={() => setViewing(m.id)}><Eye className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete ${m.name}`} onClick={() => setDeleting([m])}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <select aria-label="Rows per page" className={selectCls} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-3.5" /></Button>
            <span className="px-2 tabular-nums">Page {page} of {data?.pagination.totalPages ?? 1}</span>
            <Button variant="outline" size="icon-sm" disabled={page >= (data?.pagination.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-3.5" /></Button>
          </div>
        </div>
      </div>

      {viewing && (
        <MemberDetailDialog
          memberId={viewing}
          packages={packages}
          onClose={() => setViewing(null)}
          onEdit={(m) => { setViewing(null); setEditing(m); }}
          onDelete={(m) => setDeleting([m])}
          onChanged={() => void load()}
        />
      )}
      {editing && (
        <MemberForm
          member={editing === "new" ? null : editing}
          packages={packages}
          clientLabel={term.clientLabel}
          onClose={() => setEditing(null)}
          onSaved={async (id) => { setEditing(null); await load(); setViewing(id); }}
        />
      )}
      {importing && <MemberImportDialog packages={packages} clientPluralLabel={term.clientPluralLabel} onClose={() => setImporting(false)} onDone={() => void load()} />}

      <ConfirmationDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} ${term.clientPluralLabel.toLowerCase()}?` : `Delete this ${term.clientLabel.toLowerCase()}?`}
        description="Their profile, packages, payments and message history are permanently deleted."
        details={
          deleting ? (
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {deleting.slice(0, 5).map((m) => <li key={m.id} className="flex items-center justify-between gap-3"><span className="truncate font-medium">{m.name}</span><span className="shrink-0 font-mono text-[11px] text-muted-foreground">{m.memberCode}</span></li>)}
              {deleting.length > 5 && <li className="text-[11px] text-muted-foreground">and {deleting.length - 5} more</li>}
            </ul>
          ) : null
        }
        notes={["The WhatsApp contact and chat history stay in the Inbox.", "This cannot be undone. To keep the record, set the status to Inactive instead."]}
        confirmText={deleting && deleting.length > 1 ? `Delete ${deleting.length}` : "Delete"}
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            const res = await api<{ deleted: string[] }>("/api/gym/members/bulk-delete", { method: "POST", json: { ids: deleting.map((m) => m.id) } });
            toast.success(`${res.data.deleted.length} deleted.`);
            if (viewing && res.data.deleted.includes(viewing)) setViewing(null);
            setSelected(new Set());
            setDeleting(null);
            await load();
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }}
      />
    </div>
  );
}
