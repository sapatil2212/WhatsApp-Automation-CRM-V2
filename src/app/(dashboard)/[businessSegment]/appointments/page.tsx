"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Ban, CalendarCheck, CalendarClock, CalendarDays, CalendarX, Check, CheckCircle2, Clock, Eye, Globe, Hourglass,
  LayoutDashboard, Link2, Loader2, MessageCircle, Pencil, Plus, RefreshCw, Search, Trash2, X,
} from "lucide-react";

import { BookingLinkCard } from "@/components/booking/booking-link-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getTerminology } from "@/lib/business/terminology";
import { api } from "@/lib/campaigns/api";

type Status = "pending" | "confirmed" | "completed" | "cancelled";
type Tab = "upcoming" | "today" | "past" | "cancelled" | "all";
interface Booking {
  id: string;
  contactId: string | null;
  name: string | null;
  phone: string | null;
  service: string | null;
  date: string | null;
  time: string | null;
  notes: string | null;
  status: Status;
  source: string | null;
  createdAt: string | null;
}
interface Contact { id: string; name: string | null; phone: string | null }
interface Service { id: string; name: string }

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  confirmed: { label: "Confirmed", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
};
const SOURCE_META: Record<string, { label: string; icon: typeof Globe }> = {
  booking_link: { label: "Booking link", icon: Globe },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  dashboard: { label: "Front desk", icon: LayoutDashboard },
};
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "upcoming", label: "Upcoming" },
  { id: "today", label: "Today" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];
const selectCls = "h-8 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
const inputCls = "h-8 text-[13px] md:text-[13px]";
const AVATARS = ["bg-sky-500/15", "bg-emerald-500/15", "bg-violet-500/15", "bg-amber-500/15", "bg-rose-500/15", "bg-teal-500/15"];
const avatarColor = (id: string) => AVATARS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];
const initials = (n?: string | null) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const dateOnly = (d?: string | null) => (d ? String(d).slice(0, 10) : "");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const fmtTime = (t?: string | null) => {
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
};
const fmtPhone = (p?: string | null) => {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : d ? `+${d}` : p;
};
function relDay(d: string, today: string): string | null {
  if (!d) return null;
  const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return null;
}

export default function BookingsManagement() {
  const params = useParams();
  const businessSegment = params.businessSegment as string;
  const term = getTerminology(businessSegment);
  const [loading, setLoading] = useState(true);
  const [hasBusiness, setHasBusiness] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [search, setSearch] = useState("");
  const [onDate, setOnDate] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | "new" | null>(null);
  const [deleting, setDeleting] = useState<Booking[] | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const today = localToday();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ items: Booking[]; services: Service[]; contacts: Contact[] }>("/api/business/bookings");
      setHasBusiness(true);
      setBookings(res.data.items);
      setContacts(res.data.contacts);
      setServices(res.data.services);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 404) setHasBusiness(false);
      else toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, businessSegment]);

  const stats = useMemo(() => {
    const active = bookings.filter((b) => b.status !== "cancelled");
    return {
      today: active.filter((b) => dateOnly(b.date) === today).length,
      upcoming: active.filter((b) => b.status !== "completed" && dateOnly(b.date) >= today).length,
      pending: bookings.filter((b) => b.status === "pending").length,
      completed: bookings.filter((b) => b.status === "completed").length,
      cancelled: bookings.filter((b) => b.status === "cancelled").length,
    };
  }, [bookings, today]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = bookings.filter((b) => {
      const d = dateOnly(b.date);
      if (tab === "upcoming" && !(b.status !== "cancelled" && b.status !== "completed" && d >= today)) return false;
      if (tab === "today" && d !== today) return false;
      if (tab === "past" && !(b.status !== "cancelled" && (d < today || b.status === "completed"))) return false;
      if (tab === "cancelled" && b.status !== "cancelled") return false;
      if (onDate && d !== onDate) return false;
      if (q && ![b.name, b.phone, b.service, b.notes].some((v) => v?.toLowerCase().includes(q))) return false;
      return true;
    });
    const asc = tab === "upcoming" || tab === "today";
    return list.sort((a, b) => {
      const ka = `${dateOnly(a.date)} ${a.time ?? ""}`;
      const kb = `${dateOnly(b.date)} ${b.time ?? ""}`;
      return asc ? ka.localeCompare(kb) : kb.localeCompare(ka);
    });
  }, [bookings, tab, search, onDate, today]);

  const filtersActive = Boolean(search.trim() || onDate);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) rows.forEach((r) => n.delete(r.id));
      else rows.forEach((r) => n.add(r.id));
      return n;
    });
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const setStatus = async (b: Booking, status: Status) => {
    setBusy(b.id);
    try {
      await api(`/api/business/bookings/${b.id}`, { method: "PATCH", json: { status } });
      toast.success(`${b.name || "Booking"}: ${STATUS_META[status].label.toLowerCase()}.`);
      await load();
      if (viewing?.id === b.id) setViewing({ ...b, status });
    } catch (e) {
      toast.error((e as Error).message || "Could not update the booking.");
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const deleteRows = async (list: Booking[]) => {
    const ids = list.map((b) => b.id);
    const res = await api<{ deleted: string[]; blocked: Array<{ id: string; reason: string }> }>("/api/business/bookings/bulk-delete", { method: "POST", json: { ids } });
    const { deleted, blocked } = res.data;
    if (deleted.length) toast.success(`${deleted.length} booking${deleted.length === 1 ? "" : "s"} deleted.`);
    if (blocked.length) toast.error(`${blocked.length} could not be deleted: ${blocked[0].reason}`);
    if (viewing && ids.includes(viewing.id)) setViewing(null);
    setSelected(new Set());
    await load();
  };

  if (!loading && !hasBusiness) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <CalendarDays className="size-9 text-muted-foreground/60" />
        <h3 className="mt-3 text-sm font-semibold">Finish your {term.businessSetupLabel.toLowerCase()} first</h3>
        <p className="mt-1 text-xs text-muted-foreground">Add your business details, services and hours to start taking bookings.</p>
        <Button size="sm" className="mt-4" render={<Link href={`/${businessSegment}/setup`} />}>Open {term.businessSetupLabel}</Button>
      </div>
    );
  }

  const statCards = [
    { label: "Today", value: stats.today, icon: CalendarDays, onClick: () => setTab("today") },
    { label: "Upcoming", value: stats.upcoming, icon: CalendarClock, onClick: () => setTab("upcoming") },
    { label: "Pending", value: stats.pending, icon: Hourglass, onClick: () => setTab("upcoming") },
    { label: "Completed", value: stats.completed, icon: CalendarCheck, onClick: () => setTab("past") },
    { label: "Cancelled", value: stats.cancelled, icon: CalendarX, onClick: () => setTab("cancelled") },
  ];

  const actionsFor = (b: Booking) => (
    <div className="inline-flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="View details" aria-label={`View ${b.name || "booking"}`} onClick={() => setViewing(b)}><Eye className="size-3.5" /></Button>
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit" aria-label={`Edit ${b.name || "booking"}`} onClick={() => setEditing(b)}><Pencil className="size-3.5" /></Button>
      {b.status === "pending" || b.status === "confirmed" ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Change status" aria-label="Change status" disabled={busy === b.id} />}>
            {busy === b.id ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarClock className="size-3.5" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {b.status === "pending" && <DropdownMenuItem onClick={() => setStatus(b, "confirmed").catch(() => {})}><Check className="size-4" /> Confirm</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => setStatus(b, "completed").catch(() => {})}><CheckCircle2 className="size-4" /> Mark completed</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setCancelling(b)}><Ban className="size-4" /> Cancel booking</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="size-7" aria-hidden />
      )}
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete ${b.name || "booking"}`} onClick={() => setDeleting([b])}><Trash2 className="size-3.5" /></Button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{term.bookingPluralLabel}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Bookings from WhatsApp, your booking link and the front desk.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowLink((v) => !v)} className="gap-1.5"><Link2 className="size-3.5" /> Booking link</Button>
          <Button variant="outline" size="icon-sm" onClick={() => void load()} aria-label="Refresh" title="Refresh"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
          <Button size="sm" onClick={() => setEditing("new")} className="gap-1.5"><Plus className="size-3.5" /> New booking</Button>
        </div>
      </div>

      {showLink && <BookingLinkCard />}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((s) => (
          <button key={s.label} type="button" onClick={s.onClick} className="rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40">
            <div className="flex items-center justify-between">
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><s.icon className="size-3.5" /></span>
            </div>
            <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{loading && !bookings.length ? "—" : s.value.toLocaleString()}</p>
          </button>
        ))}
      </div>

      {/* Tabs + toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border/70 bg-card p-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${term.clientLabel.toLowerCase()}, phone, service…`} className={`${inputCls} pl-8 pr-8`} aria-label="Search bookings" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-3.5" /></button>}
        </div>
        <Input type="date" aria-label="Filter by date" value={onDate} onChange={(e) => setOnDate(e.target.value)} className={`${inputCls} w-[150px]`} />
        {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setOnDate(""); }} className="text-muted-foreground">Clear filters</Button>}
        <p className="ml-auto text-[11px] text-muted-foreground">{rows.length.toLocaleString()} {filtersActive ? "matching" : "bookings"}</p>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[13px]" role="status">
          <span className="font-medium">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleting(bookings.filter((b) => selected.has(b.id)))}><Trash2 className="size-3.5" /> Delete selected</Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed text-[13px]">
            <colgroup>
              <col className="w-10" />
              <col className="w-[24%]" />
              <col className="w-[16%]" />
              <col className="w-[14%]" />
              <col className="w-[20%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[132px]" />
            </colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-2 pl-4"><input type="checkbox" className="size-4 rx-check" aria-label="Select all bookings" checked={allSelected} onChange={toggleAll} disabled={rows.length === 0} /></th>
                <th className="px-4 py-2">{term.clientLabel}</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Date &amp; time</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && bookings.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-9 animate-pulse rounded-lg bg-muted/70" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <CalendarDays className="mx-auto size-9 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">{filtersActive ? "No bookings match these filters" : tab === "upcoming" ? "No upcoming bookings" : "Nothing here yet"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{filtersActive ? "Try a different search or date." : `Share your booking link, or add a booking for a walk-in ${term.clientLabel.toLowerCase()}.`}</p>
                    {!filtersActive && <Button size="sm" className="mt-4 gap-1.5" onClick={() => setEditing("new")}><Plus className="size-3.5" /> New booking</Button>}
                  </td>
                </tr>
              ) : (
                rows.map((b) => {
                  const d = dateOnly(b.date);
                  const rel = relDay(d, today);
                  const src = SOURCE_META[b.source ?? ""] ?? { label: b.source || "—", icon: Globe };
                  return (
                    <tr key={b.id} onClick={() => setViewing(b)} className={`group cursor-pointer transition-colors hover:bg-muted/50 ${selected.has(b.id) ? "bg-primary/5" : ""} ${loading ? "opacity-60" : ""}`}>
                      <td className="py-2 pl-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="size-4 rx-check" aria-label={`Select ${b.name || "booking"}`} checked={selected.has(b.id)} onChange={() => toggleOne(b.id)} />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-foreground ${avatarColor(b.contactId || b.id)}`}>{initials(b.name)}</span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{b.name || `Unnamed ${term.clientLabel.toLowerCase()}`}</p>
                            <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">{fmtPhone(b.phone)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2"><p className="truncate">{b.service || "—"}</p></td>
                      <td className="px-3 py-2">
                        <p className="truncate">{rel ? <span className="font-medium text-primary">{rel}</span> : fmtDate(d)}</p>
                        <p className="text-[11px] text-muted-foreground">{fmtTime(b.time)}</p>
                      </td>
                      <td className="px-3 py-2"><p className="line-clamp-2 text-[11px] text-foreground/80">{b.notes || <span className="text-muted-foreground">—</span>}</p></td>
                      <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><src.icon className="size-3.5" /> {src.label}</span></td>
                      <td className="px-3 py-2"><StatusBadge status={b.status} /></td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>{actionsFor(b)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details */}
      {viewing && (
        <Modal
          title={viewing.name || "Booking"}
          onClose={() => setViewing(null)}
          footer={
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { const b = viewing; setViewing(null); setEditing(b); }}><Pencil className="size-3.5" /> Edit</Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleting([viewing])}><Trash2 className="size-3.5" /> Delete</Button>
            </>
          }
        >
          <div className="space-y-3 text-[13px]">
            <div className="flex items-center gap-2"><StatusBadge status={viewing.status} /><span className="font-mono text-[11px] text-muted-foreground">#{viewing.id.slice(0, 8).toUpperCase()}</span></div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-border/70 p-3.5">
              <Detail label={term.clientLabel} value={viewing.name || "—"} />
              <Detail label="Phone" value={fmtPhone(viewing.phone) || "—"} mono />
              <Detail label="Service" value={viewing.service || "—"} />
              <Detail label="Source" value={(SOURCE_META[viewing.source ?? ""]?.label) ?? (viewing.source || "—")} />
              <Detail label="Date" value={fmtDate(dateOnly(viewing.date))} />
              <Detail label="Time" value={fmtTime(viewing.time) || "—"} />
            </dl>
            {viewing.notes && <p className="whitespace-pre-wrap rounded-xl border border-border/70 p-3.5 text-[13px] text-foreground/90">{viewing.notes}</p>}
            {(viewing.status === "pending" || viewing.status === "confirmed") && (
              <div className="flex flex-wrap gap-2">
                {viewing.status === "pending" && <Button size="sm" className="gap-1.5" disabled={busy === viewing.id} onClick={() => setStatus(viewing, "confirmed").catch(() => {})}><Check className="size-3.5" /> Confirm</Button>}
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy === viewing.id} onClick={() => setStatus(viewing, "completed").catch(() => {})}><CheckCircle2 className="size-3.5" /> Mark completed</Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setCancelling(viewing)}><Ban className="size-3.5" /> Cancel</Button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {editing && (
        <BookingForm
          booking={editing === "new" ? null : editing}
          contacts={contacts}
          services={services}
          clientLabel={term.clientLabel}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); setViewing(null); await load(); }}
        />
      )}

      <ConfirmationDialog
        isOpen={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this booking?"
        description="The slot is released so someone else can book it."
        details={cancelling ? <BookingSummary b={cancelling} /> : null}
        confirmText="Cancel booking"
        cancelText="Keep it"
        variant="destructive"
        icon="warning"
        onConfirm={async () => {
          if (!cancelling) return;
          await setStatus(cancelling, "cancelled");
          setCancelling(null);
        }}
      />

      <ConfirmationDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} bookings?` : "Delete this booking?"}
        description={deleting && deleting.length > 1 ? "They will be permanently removed." : "It will be permanently removed."}
        details={
          deleting && deleting.length === 1 ? (
            <BookingSummary b={deleting[0]} />
          ) : deleting ? (
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {deleting.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{b.name || "Booking"}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{fmtDate(dateOnly(b.date))} · {fmtTime(b.time)}</span>
                </li>
              ))}
              {deleting.length > 5 && <li className="text-[11px] text-muted-foreground">and {deleting.length - 5} more</li>}
            </ul>
          ) : null
        }
        notes={["This cannot be undone.", `The ${term.clientLabel.toLowerCase()} is not notified. To free the slot and keep a record, cancel instead.`]}
        confirmText={deleting && deleting.length > 1 ? `Delete ${deleting.length}` : "Delete"}
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteRows(deleting);
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>;
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate ${mono ? "font-mono text-[12px] tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}

function BookingSummary({ b }: { b: Booking }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-semibold">{b.name || "Booking"}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{fmtPhone(b.phone)}</span>
      </div>
      <p className="text-[12px] text-muted-foreground">
        {fmtDate(dateOnly(b.date))} · {fmtTime(b.time)}{b.service ? ` · ${b.service}` : ""}
      </p>
    </div>
  );
}

function BookingForm({ booking, contacts, services, clientLabel, today, onClose, onSaved }: {
  booking: Booking | null;
  contacts: Contact[];
  services: Service[];
  clientLabel: string;
  today: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [f, setF] = useState({
    contact_id: booking?.contactId ?? "",
    contact_name: booking?.name ?? "",
    contact_phone: booking?.phone ?? "",
    enquiry_type: booking?.service ?? "",
    preferred_date: dateOnly(booking?.date) || today,
    preferred_time: booking?.time?.slice(0, 5) ?? "10:00",
    status: booking?.status ?? "confirmed",
    notes: booking?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const picked = contacts.find((c) => c.id === f.contact_id);

  const save = async () => {
    const name = (picked ? picked.name ?? "" : f.contact_name).trim();
    const phone = (picked ? picked.phone ?? "" : f.contact_phone).trim();
    if (name.length < 2) return toast.error(`Enter the ${clientLabel.toLowerCase()}'s name.`);
    if (!picked && !phone) return toast.error("Enter a WhatsApp number.");
    if (!f.preferred_date || !f.preferred_time) return toast.error("Choose a date and time.");
    setSaving(true);
    try {
      const payload = {
        contactId: f.contact_id || null,
        name,
        phone,
        service: f.enquiry_type || null,
        date: f.preferred_date,
        time: f.preferred_time,
        status: f.status,
        notes: f.notes.trim() || null,
      };
      if (booking) await api(`/api/business/bookings/${booking.id}`, { method: "PATCH", json: payload });
      else await api("/api/business/bookings", { method: "POST", json: payload });
      toast.success(booking ? "Booking updated." : "Booking added.");
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message || "Could not save the booking.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={booking ? "Edit booking" : "New booking"}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={() => void save()} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {booking ? "Save changes" : "Add booking"}</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-[12px]">Existing {clientLabel.toLowerCase()}</Label>
          <select className={`${selectCls} w-full`} value={f.contact_id} onChange={set("contact_id")}>
            <option value="">New {clientLabel.toLowerCase()} (enter details below)</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name || "Unnamed"}{c.phone ? ` (${fmtPhone(c.phone)})` : ""}</option>)}
          </select>
        </div>
        {!f.contact_id && (
          <>
            <div className="space-y-1"><Label className="text-[12px]">Name *</Label><Input className={inputCls} value={f.contact_name} onChange={set("contact_name")} maxLength={120} placeholder="Full name" /></div>
            <div className="space-y-1"><Label className="text-[12px]">WhatsApp number *</Label><Input className={inputCls} value={f.contact_phone} onChange={set("contact_phone")} inputMode="tel" placeholder="+91 98765 43210" /></div>
          </>
        )}
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-[12px]">Service</Label>
          <select className={`${selectCls} w-full`} value={f.enquiry_type} onChange={set("enquiry_type")}>
            <option value="">General booking</option>
            {services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            {f.enquiry_type && !services.some((s) => s.name === f.enquiry_type) && <option value={f.enquiry_type}>{f.enquiry_type}</option>}
          </select>
        </div>
        <div className="space-y-1"><Label className="text-[12px]">Date *</Label><Input type="date" className={inputCls} value={f.preferred_date} onChange={set("preferred_date")} /></div>
        <div className="space-y-1"><Label className="text-[12px]">Time *</Label><Input type="time" className={inputCls} value={f.preferred_time} onChange={set("preferred_time")} /></div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-[12px]">Status</Label>
          <select className={`${selectCls} w-full`} value={f.status} onChange={set("status")}>
            {(Object.keys(STATUS_META) as Status[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2"><Label className="text-[12px]">Notes</Label><Textarea rows={3} className="text-[13px] md:text-[13px]" value={f.notes} onChange={set("notes")} maxLength={1000} placeholder="Anything the team should know" /></div>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground sm:col-span-2"><Clock className="size-3.5" /> Bookings added here are not sent on WhatsApp.</p>
      </div>
    </Modal>
  );
}

/** Lightweight modal shell (matches the healthcare dashboard). */
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><X className="size-4" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
