'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Ban, Bell, CalendarCheck, CalendarClock, CalendarDays, CalendarX, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Eye, Globe,
  LayoutDashboard, Link2, Loader2, Mail, MessageCircle, Pencil, Phone, Plus, RefreshCw, Search, Stethoscope, Trash2, UserRound, UserX, X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { BookingLinkCard } from '@/components/booking/booking-link-card';
import { api } from '@/lib/campaigns/api';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/hooks/use-auth';

// ── types ────────────────────────────────────────────────────────────

type Status = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
type Tab = 'upcoming' | 'today' | 'past' | 'cancelled' | 'all';

interface Row {
  id: string;
  ref: string;
  token: number | null;
  date: string;
  time: string;
  status: Status;
  patient: { contactId: string; name: string | null; age: string | null; gender: string | null; phone: string | null; email: string | null };
  doctor: { id: string; name: string; specialization: string | null } | null;
  department: string | null;
  complaint: string | null;
  source: string;
  whatsappConsent: boolean;
  canMessage: boolean;
  messages: string[];
  rescheduledFrom: string | null;
  createdAt: string;
}
interface Detail extends Row {
  log: Record<string, unknown>;
  conversationId: string | null;
  history: Row[];
  intakes: Array<{ id: string; symptoms: string | null; allergies: string | null; medications: string | null; history: string | null; urgency: string | null; createdAt: string }>;
  feedback: Array<{ id: string; rating: number; text: string | null; createdAt: string }>;
}
interface Board {
  items: Row[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  stats: { today: number; upcoming: number; completed: number; cancelled: number; noShow: number; total: number };
  doctors: Array<{ id: string; name: string; specialization: string | null }>;
  today: string;
}

// ── helpers ──────────────────────────────────────────────────────────

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'today', label: 'Today' },
  { id: 'past', label: 'Past' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];
const STATUS_META: Record<Status, { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  completed: { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  cancelled: { label: 'Cancelled', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
  no_show: { label: 'No-show', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};
const SOURCE_META: Record<string, { label: string; icon: typeof Globe }> = {
  booking_link: { label: 'Online', icon: Globe },
  whatsapp_ai: { label: 'WhatsApp', icon: MessageCircle },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  dashboard: { label: 'Dashboard', icon: LayoutDashboard },
};
const MESSAGE_LABEL: Record<string, string> = {
  confirmation: 'Confirmation',
  r_1d: '1-day reminder',
  r_2h: '2-hour reminder',
  r_1h: '1-hour reminder',
  manual_reminder: 'Manual reminder',
  completed: 'Thank-you & feedback',
  no_show: 'No-show follow-up',
  followup_3d: '3-day follow-up',
  health_2d: 'Health check-in',
};
const GENDER: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other', prefer_not_to_say: '—' };

const drName = (n?: string | null) => (n ? (/^dr\.?\s/i.test(n) ? n : `Dr. ${n}`) : '—');
const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` : t;
};
const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
const fmtPhone = (p?: string | null) => {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
};
const initials = (n?: string | null) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const AVATARS = ['bg-sky-500/15', 'bg-emerald-500/15', 'bg-violet-500/15', 'bg-amber-500/15', 'bg-rose-500/15', 'bg-teal-500/15'];
const avatarColor = (id: string) => AVATARS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];

function relDay(d: string, today: string): string | null {
  const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return null;
}

function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status] ?? STATUS_META.scheduled;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>;
}

function SourceBadge({ source, consent }: { source: string; consent: boolean }) {
  const m = SOURCE_META[source] ?? { label: source, icon: Globe };
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={consent ? 'Agreed to WhatsApp updates' : 'No WhatsApp updates'}>
      <m.icon className="size-3.5" /> {m.label}
      {!consent && <span className="rounded bg-muted px-1 text-[10px]">no WA</span>}
    </span>
  );
}

/** Lightweight modal shell (matches the rest of the dashboard). */
function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex max-h-[92dvh] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} flex-col overflow-hidden rounded-t-2xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 sm:rounded-2xl`}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><X className="size-4" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const selectCls = 'h-8 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/40';

/** Doctor + date + free slots, shared by "New appointment" and "Reschedule". */
function SlotPicker({ doctors, doctorId, setDoctorId, date, setDate, time, setTime, today }: {
  doctors: Board['doctors']; doctorId: string; setDoctorId: (v: string) => void; date: string; setDate: (v: string) => void; time: string; setTime: (v: string) => void; today: string;
}) {
  // Results are keyed by doctor+date, so a stale response never shows for a new pick.
  const key = doctorId && date ? `${doctorId}|${date}` : '';
  const [fetched, setFetched] = useState<{ key: string; slots: string[]; reason: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    api<{ days: Array<{ date: string; slots: string[]; closedReason: string | null }> }>(`/api/appointments/availability?doctorId=${doctorId}&from=${date}&days=1`)
      .then((r) => {
        const d = r.data.days.find((x) => x.date === date);
        if (live) setFetched({ key, slots: d?.slots ?? [], reason: d?.closedReason ?? null });
      })
      .catch((e: Error) => live && setFetched({ key, slots: [], reason: e.message }));
    return () => {
      live = false;
    };
  }, [key, doctorId, date]);
  const slots = fetched?.key === key ? fetched.slots : null;
  const reason = fetched?.key === key ? fetched.reason : null;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Doctor *</Label>
          <select className={`${selectCls} w-full`} value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setTime(''); }}>
            <option value="">Choose a doctor</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{drName(d.name)}{d.specialization ? ` — ${d.specialization}` : ''}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Date *</Label>
          <Input type="date" min={today} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
        </div>
      </div>
      {doctorId && date && (
        <div className="space-y-1.5">
          <Label>Available time *</Label>
          {slots === null ? (
            <div className="grid grid-cols-4 gap-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : slots.length === 0 ? (
            <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{reason ?? 'No free slots on this day.'}</p>
          ) : (
            <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {slots.map((t) => (
                <button key={t} type="button" onClick={() => setTime(t)} className={`rounded-lg border px-2 py-1 text-[13px] transition-colors ${time === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/60'}`}>{fmtTime(t)}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────

export default function AppointmentsPage() {
  const { profile } = useAuth();
  const tenantId = (profile as { tenant_id?: string; tenantId?: string } | null)?.tenant_id ?? (profile as { tenantId?: string } | null)?.tenantId;

  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [onDate, setOnDate] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showLink, setShowLink] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: Row; status: Status } | null>(null);
  const [resched, setResched] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Row[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [tab, debounced, doctorId, onDate, pageSize]);
  // A selection only makes sense for the rows currently on screen.
  useEffect(() => setSelected(new Set()), [tab, debounced, doctorId, onDate, pageSize, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) });
      if (debounced) q.set('search', debounced);
      if (doctorId) q.set('doctorId', doctorId);
      if (onDate) {
        q.set('from', onDate);
        q.set('to', onDate);
      }
      const res = await api<Board>(`/api/healthcare/appointments/board?${q}`);
      setBoard(res.data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab, page, pageSize, debounced, doctorId, onDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail((await api<Detail>(`/api/healthcare/appointments/board/${id}`)).data);
    } catch (e) {
      toast.error((e as Error).message);
      setDetailId(null);
    }
  }, []);
  useEffect(() => {
    setDetail(null);
    if (detailId) void loadDetail(detailId);
  }, [detailId, loadDetail]);

  // Live updates: bookings, cancellations and reschedules from WhatsApp, the booking page or other staff.
  useEffect(() => {
    if (!tenantId) return;
    const socket = getSocket();
    const join = () => socket.emit('join-tenant', tenantId);
    const refresh = () => {
      void load();
      if (detailId) void loadDetail(detailId);
    };
    const onNotification = (e: { type?: string }) => e?.type === 'booking' && refresh();
    if (!socket.connected) socket.connect();
    else join();
    socket.on('connect', join);
    socket.on('appointments:changed', refresh);
    socket.on('notification', onNotification);
    const poll = setInterval(refresh, 60_000);
    return () => {
      socket.off('connect', join);
      socket.off('appointments:changed', refresh);
      socket.off('notification', onNotification);
      clearInterval(poll);
    };
  }, [tenantId, load, loadDetail, detailId]);

  const act = async (row: Row, body: Record<string, unknown>, success: string) => {
    setBusy(row.id);
    try {
      const res = await api<{ messaged: boolean }>(`/api/healthcare/appointments/board/${row.id}`, { method: 'PATCH', json: body });
      toast.success(`${success}${res.data.messaged ? ' Patient notified on WhatsApp.' : ''}`);
      await load();
      if (detailId === row.id) await loadDetail(row.id);
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const rows = board?.items ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteRows = async (list: Row[]) => {
    const res = await api<{ deleted: string[]; blocked: Array<{ id: string; reason: string }> }>('/api/healthcare/appointments/board/bulk-delete', { method: 'POST', json: { ids: list.map((r) => r.id) } });
    const { deleted, blocked } = res.data;
    if (deleted.length) toast.success(`${deleted.length} appointment${deleted.length === 1 ? '' : 's'} deleted.`);
    if (blocked.length) toast.error(`${blocked.length} could not be deleted: ${blocked[0].reason}`);
    if (detailId && deleted.includes(detailId)) setDetailId(null);
    setSelected(new Set());
    await load();
  };
  const today = board?.today ?? new Date().toISOString().slice(0, 10);
  const total = board?.pagination.total ?? 0;
  const totalPages = board?.pagination.totalPages ?? 1;
  const filtersActive = Boolean(debounced || doctorId || onDate);

  const stats = useMemo(
    () => [
      { label: 'Today', value: board?.stats.today, icon: CalendarDays, onClick: () => setTab('today') },
      { label: 'Upcoming', value: board?.stats.upcoming, icon: CalendarClock, onClick: () => setTab('upcoming') },
      { label: 'Completed', value: board?.stats.completed, icon: CalendarCheck, onClick: () => setTab('past') },
      { label: 'Cancelled', value: board?.stats.cancelled, icon: CalendarX, onClick: () => setTab('cancelled') },
      { label: 'No-shows', value: board?.stats.noShow, icon: UserX, onClick: () => setTab('past') },
    ],
    [board],
  );

  const actionsFor = (r: Row) => (
    <div className="inline-flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="View details" aria-label={`View ${r.patient.name || 'appointment'}`} onClick={() => setDetailId(r.id)}><Eye className="size-3.5" /></Button>
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit details" aria-label={`Edit ${r.patient.name || 'appointment'}`} onClick={() => setEditing(r)}><Pencil className="size-3.5" /></Button>
      {r.status === 'scheduled' ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Status & reschedule" aria-label="Status and reschedule" disabled={busy === r.id} />}>
            {busy === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarClock className="size-3.5" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setResched(r)}><CalendarClock className="size-4" /> Reschedule</DropdownMenuItem>
            {r.canMessage && <DropdownMenuItem onClick={() => act(r, { action: 'remind' }, 'Reminder sent.').catch(() => {})}><Bell className="size-4" /> Send reminder</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => act(r, { action: 'status', status: 'completed' }, 'Marked as completed.').catch(() => {})}><CheckCircle2 className="size-4" /> Mark completed</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirm({ row: r, status: 'no_show' })}><UserX className="size-4" /> Mark no-show</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ row: r, status: 'cancelled' })}><Ban className="size-4" /> Cancel appointment</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="size-7" aria-hidden />
      )}
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete ${r.patient.name || 'appointment'}`} onClick={() => setDeleting([r])}><Trash2 className="size-3.5" /></Button>
    </div>
  );  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Appointments</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Bookings from WhatsApp, your booking link and the front desk — updated live.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowLink((v) => !v)} className="gap-1.5"><Link2 className="size-3.5" /> Booking link</Button>
          <Button variant="outline" size="icon-sm" onClick={() => void load()} aria-label="Refresh" title="Refresh"><RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5"><Plus className="size-3.5" /> New appointment</Button>
        </div>
      </div>

      {showLink && <BookingLinkCard />}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <button key={s.label} type="button" onClick={s.onClick} className="rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40">
            <div className="flex items-center justify-between">
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><s.icon className="size-3.5" /></span>
            </div>
            <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{s.value === undefined ? '—' : s.value.toLocaleString()}</p>
          </button>
        ))}
      </div>

      {/* Tabs + toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border/70 bg-card p-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, phone, ID…" className="h-8 pl-8 pr-8 text-[13px]" aria-label="Search appointments" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-4" /></button>}
        </div>
        <select aria-label="Filter by doctor" className={selectCls} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">All doctors</option>
          {board?.doctors.map((d) => <option key={d.id} value={d.id}>{drName(d.name)}</option>)}
        </select>
        <Input type="date" aria-label="Filter by date" value={onDate} onChange={(e) => setOnDate(e.target.value)} className="h-8 w-[150px] text-[13px]" />
        {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setDoctorId(''); setOnDate(''); }} className="text-muted-foreground">Clear filters</Button>}
        <p className="ml-auto text-[11px] text-muted-foreground">{total.toLocaleString()} {filtersActive ? 'matching' : 'appointments'}</p>
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
          <table className="w-full min-w-[1060px] table-fixed text-[13px]">
            <colgroup>
              <col className="w-10" />
              <col className="w-[22%]" />
              <col className="w-[13%]" />
              <col className="w-[16%]" />
              <col className="w-[13%]" />
              <col className="w-[15%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[132px]" />
            </colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-2 pl-4"><input type="checkbox" className="size-4 rx-check" aria-label="Select all appointments on this page" checked={allSelected} onChange={toggleAll} disabled={rows.length === 0} /></th>
                <th className="px-4 py-2">Patient</th>
                <th className="px-3 py-2">Appointment</th>
                <th className="px-3 py-2">Doctor</th>
                <th className="px-3 py-2">Date &amp; time</th>
                <th className="px-3 py-2">Complaint</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && rows.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={9} className="px-4 py-3"><div className="h-9 animate-pulse rounded-lg bg-muted/70" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <CalendarDays className="mx-auto size-9 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">{filtersActive ? 'No appointments match these filters' : tab === 'upcoming' ? 'No upcoming appointments' : 'Nothing here yet'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{filtersActive ? 'Try a different search, doctor or date.' : 'Share your booking link, or add an appointment for a walk-in patient.'}</p>
                    {!filtersActive && <Button size="sm" className="mt-4 gap-1.5" onClick={() => setCreating(true)}><Plus className="size-3.5" /> New appointment</Button>}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const rel = relDay(r.date, today);
                  return (
                    <tr key={r.id} onClick={() => setDetailId(r.id)} className={`group cursor-pointer transition-colors hover:bg-muted/50 ${selected.has(r.id) ? 'bg-primary/5' : ''} ${loading ? 'opacity-60' : ''}`}>
                      <td className="py-2 pl-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="size-4 rx-check" aria-label={`Select ${r.patient.name || 'appointment'}`} checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-foreground ${avatarColor(r.patient.contactId)}`}>{initials(r.patient.name)}</span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{r.patient.name || 'Unnamed patient'}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {[r.patient.age && `${r.patient.age} yrs`, r.patient.gender && GENDER[r.patient.gender]].filter(Boolean).join(' · ') || ''}
                              {(r.patient.age || r.patient.gender) && r.patient.phone ? ' · ' : ''}
                              <span className="font-mono tabular-nums">{r.patient.phone ? fmtPhone(r.patient.phone) : ''}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <p className="truncate font-mono text-[11px]">{r.ref}</p>
                        {r.token !== null && <p className="text-[11px] text-muted-foreground">Queue #{r.token}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <p className="truncate">{drName(r.doctor?.name)}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{r.department || '—'}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="truncate">{rel ? <span className="font-medium text-primary">{rel}</span> : fmtDate(r.date, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <p className="text-[11px] text-muted-foreground">{fmtTime(r.time)}{r.rescheduledFrom ? ' · moved' : ''}</p>
                      </td>
                      <td className="px-3 py-2"><p className="line-clamp-2 text-[11px] text-foreground/80">{r.complaint || <span className="text-muted-foreground">—</span>}</p></td>
                      <td className="px-3 py-2"><SourceBadge source={r.source} consent={r.whatsappConsent} /></td>
                      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>{actionsFor(r)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <select aria-label="Rows per page" className={`${selectCls} h-8`} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <span>{total === 0 ? '0' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
            <span className="px-2">Page {page} of {totalPages}</span>
            <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {detailId && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && setDetailId(null)}>
          <aside className="flex h-full w-full max-w-md flex-col bg-background shadow-2xl ring-1 ring-foreground/10" aria-label="Appointment details">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{detail?.patient.name || 'Appointment'}</p>
                <p className="font-mono text-xs text-muted-foreground">{detail?.ref}</p>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => setDetailId(null)}><X className="size-4" /></Button>
            </div>
            {!detail ? (
              <div className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />)}</div>
            ) : (
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={detail.status} />
                  <SourceBadge source={detail.source} consent={detail.whatsappConsent} />
                  {detail.token !== null && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">Queue #{detail.token}</span>}
                </div>

                <section className="rounded-xl border border-border/70 p-3.5">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Patient</h3>
                  <dl className="grid grid-cols-[96px_1fr] gap-y-1.5 text-[13px]">
                    <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{detail.patient.name || '—'}</dd>
                    <dt className="text-muted-foreground">Age</dt><dd>{detail.patient.age ? `${detail.patient.age} yrs` : '—'}</dd>
                    <dt className="text-muted-foreground">Gender</dt><dd>{detail.patient.gender ? GENDER[detail.patient.gender] : '—'}</dd>
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd className="flex items-center gap-2 font-mono text-xs">
                      {fmtPhone(detail.patient.phone)}
                      {detail.patient.phone && (
                        <>
                          <a href={`tel:+${detail.patient.phone.replace(/\D/g, '')}`} className="text-primary" aria-label="Call"><Phone className="size-3.5" /></a>
                          {detail.conversationId && <a href={`/inbox?c=${detail.conversationId}`} className="text-primary" aria-label="Open WhatsApp chat"><MessageCircle className="size-3.5" /></a>}
                        </>
                      )}
                    </dd>
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="truncate">{detail.patient.email ? <a className="inline-flex items-center gap-1 text-primary" href={`mailto:${detail.patient.email}`}><Mail className="size-3.5" />{detail.patient.email}</a> : '—'}</dd>
                    <dt className="text-muted-foreground">WhatsApp</dt><dd>{detail.whatsappConsent ? 'Agreed to updates' : 'No WhatsApp updates'}</dd>
                  </dl>
                </section>

                <section className="rounded-xl border border-border/70 p-3.5">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Appointment</h3>
                  <dl className="grid grid-cols-[96px_1fr] gap-y-1.5 text-[13px]">
                    <dt className="text-muted-foreground">Doctor</dt><dd className="font-medium">{drName(detail.doctor?.name)}</dd>
                    <dt className="text-muted-foreground">Department</dt><dd>{detail.department || '—'}</dd>
                    <dt className="text-muted-foreground">When</dt><dd>{fmtDate(detail.date)} · {fmtTime(detail.time)}</dd>
                    {detail.rescheduledFrom && (<><dt className="text-muted-foreground">Moved from</dt><dd>{fmtDate(detail.rescheduledFrom.slice(0, 10))} · {fmtTime(detail.rescheduledFrom.slice(11))}</dd></>)}
                    <dt className="text-muted-foreground">Complaint</dt><dd className="whitespace-pre-wrap">{detail.complaint || '—'}</dd>
                    <dt className="text-muted-foreground">Booked</dt><dd>{new Date(detail.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
                  </dl>
                </section>

                <section className="rounded-xl border border-border/70 p-3.5">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">WhatsApp messages</h3>
                  {detail.messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{detail.canMessage ? 'None sent yet.' : 'The patient did not agree to WhatsApp updates.'}</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {detail.messages.map((k) => (
                        <li key={k} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5"><Check className="size-3.5 text-emerald-600" /> {MESSAGE_LABEL[k] ?? k.replace(/_/g, ' ')}</span>
                          <span className="text-xs text-muted-foreground">{typeof detail.log[k] === 'string' && !Number.isNaN(Date.parse(detail.log[k] as string)) ? new Date(detail.log[k] as string).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {(detail.intakes.length > 0 || detail.feedback.length > 0) && (
                  <section className="rounded-xl border border-border/70 p-3.5">
                    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Intake &amp; feedback</h3>
                    {detail.intakes.map((i) => (
                      <div key={i.id} className="mb-3 space-y-1 text-sm">
                        {i.urgency && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] capitalize text-amber-700 dark:text-amber-400">{i.urgency.replace(/_/g, ' ')}</span>}
                        {i.symptoms && <p><span className="text-muted-foreground">Symptoms:</span> {i.symptoms}</p>}
                        {i.allergies && <p><span className="text-muted-foreground">Allergies:</span> {i.allergies}</p>}
                        {i.medications && <p><span className="text-muted-foreground">Medications:</span> {i.medications}</p>}
                        {i.history && <p><span className="text-muted-foreground">History:</span> {i.history}</p>}
                      </div>
                    ))}
                    {detail.feedback.map((f) => (
                      <p key={f.id} className="text-sm"><span className="text-amber-500">{'★'.repeat(f.rating)}{'☆'.repeat(Math.max(0, 5 - f.rating))}</span> {f.text}</p>
                    ))}
                  </section>
                )}

                <section className="rounded-xl border border-border/70 p-3.5">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Other visits</h3>
                  {detail.history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">First visit.</p>
                  ) : (
                    <ul className="divide-y divide-border/70">
                      {detail.history.map((h) => (
                        <li key={h.id}>
                          <button type="button" onClick={() => setDetailId(h.id)} className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-primary">
                            <span className="min-w-0"><span className="block truncate">{fmtDate(h.date, { day: 'numeric', month: 'short', year: 'numeric' })} · {fmtTime(h.time)}</span><span className="block truncate text-xs text-muted-foreground">{drName(h.doctor?.name)}</span></span>
                            <StatusBadge status={h.status} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
            {detail && (
              <div className="flex gap-2 border-t border-border bg-muted/40 px-4 pt-4">
                <Button variant="outline" className="flex-1 gap-1.5" onClick={() => setEditing(detail)}><Pencil className="size-4" /> Edit</Button>
                <Button variant="outline" className="flex-1 gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleting([detail])}><Trash2 className="size-4" /> Delete</Button>
              </div>
            )}
            {detail?.status === 'scheduled' && (
              <div className="grid grid-cols-2 gap-2 border-t border-border bg-muted/40 p-4">
                <Button variant="outline" onClick={() => setResched(detail)} className="gap-1.5"><CalendarClock className="size-4" /> Reschedule</Button>
                <Button variant="outline" disabled={!detail.canMessage || busy === detail.id} onClick={() => act(detail, { action: 'remind' }, 'Reminder sent.').catch(() => {})} className="gap-1.5"><Bell className="size-4" /> Remind</Button>
                <Button disabled={busy === detail.id} onClick={() => act(detail, { action: 'status', status: 'completed' }, 'Marked as completed.').catch(() => {})} className="gap-1.5"><CheckCircle2 className="size-4" /> Completed</Button>
                <Button variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirm({ row: detail, status: 'cancelled' })}><Ban className="size-4" /> Cancel</Button>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Cancel / no-show confirmation */}
      <ConfirmationDialog
        isOpen={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.status === 'cancelled' ? 'Cancel this appointment?' : 'Mark as no-show?'}
        description={confirm?.status === 'cancelled' ? 'The slot is released so someone else can book it.' : 'The appointment is closed as missed.'}
        details={confirm ? <ApptSummary row={confirm.row} /> : null}
        notes={confirm ? [confirm.row.canMessage ? 'The patient will be told on WhatsApp.' : 'The patient has not agreed to WhatsApp messages, so they will not be notified.'] : []}
        confirmText={confirm?.status === 'cancelled' ? 'Cancel appointment' : 'Mark no-show'}
        cancelText="Keep it"
        variant="destructive"
        icon="warning"
        onConfirm={async () => {
          if (!confirm) return;
          await act(confirm.row, { action: 'status', status: confirm.status }, confirm.status === 'cancelled' ? 'Appointment cancelled.' : 'Marked as no-show.');
          setConfirm(null);
        }}
      />

      <ConfirmationDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} appointments?` : 'Delete this appointment?'}
        description={deleting && deleting.length > 1 ? 'They will be permanently removed.' : 'It will be permanently removed.'}
        details={
          deleting && deleting.length === 1 ? (
            <ApptSummary row={deleting[0]} />
          ) : deleting ? (
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {deleting.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{r.patient.name || 'Patient'}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{fmtDate(r.date)} · {fmtTime(r.time)}</span>
                </li>
              ))}
              {deleting.length > 5 && <li className="text-[11px] text-muted-foreground">and {deleting.length - 5} more</li>}
            </ul>
          ) : null
        }
        notes={[
          'This cannot be undone.',
          deleting && deleting.length > 1 ? 'Patients are not notified. To tell them, cancel instead.' : 'The patient is not notified. To tell them, cancel instead.',
          'Any consultation, prescription and dictation for the visit is deleted too.',
        ]}
        confirmText={deleting && deleting.length > 1 ? `Delete ${deleting.length}` : 'Delete'}
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
      {editing && <EditAppointmentModal row={editing} onClose={() => setEditing(null)} onDone={async () => { const id = editing.id; setEditing(null); await load(); if (detailId === id) await loadDetail(id); }} />}
      {resched && board && <RescheduleModal row={resched} doctors={board.doctors} today={today} onClose={() => setResched(null)} onDone={async () => { setResched(null); await load(); if (detailId) await loadDetail(detailId); }} />}
      {creating && board && <NewAppointmentModal doctors={board.doctors} today={today} onClose={() => setCreating(false)} onDone={async (id) => { setCreating(false); await load(); setDetailId(id); }} />}
    </div>
  );
}

/** Compact "who / when / with whom" block for confirm dialogs. */
function ApptSummary({ row }: { row: Row }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-semibold">{row.patient.name || 'Patient'}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{row.ref}</span>
      </div>
      <p className="text-[12px] text-muted-foreground">
        {fmtDate(row.date)} · {fmtTime(row.time)} · {drName(row.doctor?.name)}
      </p>
    </div>
  );
}
function RescheduleModal({ row, doctors, today, onClose, onDone }: { row: Row; doctors: Board['doctors']; today: string; onClose: () => void; onDone: () => void }) {
  const [doctorId, setDoctorId] = useState(row.doctor?.id ?? '');
  const [date, setDate] = useState(row.date >= today ? row.date : today);
  const [time, setTime] = useState('');
  const [notify, setNotify] = useState(row.canMessage);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const res = await api<{ messaged: boolean }>(`/api/healthcare/appointments/board/${row.id}`, { method: 'PATCH', json: { action: 'reschedule', date, time, doctorId: doctorId !== row.doctor?.id ? doctorId : undefined, notify } });
      toast.success(`Appointment moved.${res.data.messaged ? ' Patient notified on WhatsApp.' : ''}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title={`Reschedule · ${row.patient.name || 'Patient'}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!doctorId || !date || !time || saving} onClick={save} className="gap-1.5">{saving ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />} Move appointment</Button>
        </>
      }
    >
      <p className="mb-4 rounded-lg bg-muted/60 p-3 text-sm">Currently <strong>{fmtDate(row.date)} · {fmtTime(row.time)}</strong> with {drName(row.doctor?.name)}.</p>
      <SlotPicker doctors={doctors} doctorId={doctorId} setDoctorId={setDoctorId} date={date} setDate={setDate} time={time} setTime={setTime} today={today} />
      <label className={`mt-4 flex items-center gap-2 text-sm ${row.canMessage ? '' : 'text-muted-foreground'}`}>
        <input type="checkbox" className="size-4 rx-check" checked={notify} disabled={!row.canMessage} onChange={(e) => setNotify(e.target.checked)} />
        Tell the patient on WhatsApp{!row.canMessage && ' (no consent)'}
      </label>
    </Modal>
  );
}

function NewAppointmentModal({ doctors, today, onClose, onDone }: { doctors: Board['doctors']; today: string; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', age: '', gender: '', complaint: '' });
  const [doctorId, setDoctorId] = useState(doctors.length === 1 ? doctors[0].id : '');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasPhone = f.phone.replace(/\D/g, '').length >= 10;
  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Enter the patient's name.");
    setSaving(true);
    try {
      const res = await api<Row>('/api/healthcare/appointments/board', {
        method: 'POST',
        json: { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), age: f.age || undefined, gender: f.gender || undefined, complaint: f.complaint.trim() || undefined, doctorId, date, time, whatsappConsent: consent && hasPhone },
      });
      toast.success(`Booked · ${res.data.ref}`);
      onDone(res.data.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open
      wide
      title="New appointment"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!doctorId || !date || !time || saving} onClick={save} className="gap-1.5">{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Book appointment</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><UserRound className="size-4 text-primary" /> Patient</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label>Full name *</Label><Input value={f.name} onChange={set('name')} placeholder="Rahul Sharma" maxLength={120} /></div>
            <div className="space-y-1.5"><Label>WhatsApp number</Label><Input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="98765 43210" maxLength={18} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input value={f.email} onChange={set('email')} type="email" placeholder="patient@email.com" /></div>
            <div className="space-y-1.5"><Label>Age</Label><Input value={f.age} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" placeholder="32" /></div>
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <select className={`${selectCls} w-full`} value={f.gender} onChange={set('gender')}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Stethoscope className="size-4 text-primary" /> Appointment</p>
          <SlotPicker doctors={doctors} doctorId={doctorId} setDoctorId={setDoctorId} date={date} setDate={setDate} time={time} setTime={setTime} today={today} />
          <div className="mt-3 space-y-1.5"><Label>Chief complaint</Label><Textarea rows={2} value={f.complaint} onChange={set('complaint')} maxLength={1000} placeholder="e.g. Fever for 2 days" /></div>
        </div>
        <label className={`flex items-start gap-2 text-sm ${hasPhone ? '' : 'text-muted-foreground'}`}>
          <input type="checkbox" className="mt-0.5 size-4 rx-check" checked={consent && hasPhone} disabled={!hasPhone} onChange={(e) => setConsent(e.target.checked)} />
          <span>Patient agreed to receive appointment confirmations and reminders on WhatsApp<span className="block text-xs text-muted-foreground"><Clock className="mr-1 inline size-3" />Sends the confirmation now and reminders before the visit.</span></span>
        </label>
      </div>
    </Modal>
  );
}

function EditAppointmentModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: row.patient.name ?? '', email: row.patient.email ?? '', age: row.patient.age ?? '', gender: row.patient.gender ?? '', complaint: row.complaint ?? '' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Enter the patient's name.");
    setSaving(true);
    try {
      await api(`/api/healthcare/appointments/board/${row.id}`, {
        method: 'PATCH',
        json: { action: 'edit', name: f.name.trim(), email: f.email.trim(), age: f.age || undefined, gender: f.gender || null, complaint: f.complaint.trim() },
      });
      toast.success('Appointment updated.');
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open
      title={`Edit ${row.ref}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save} className="gap-1.5">{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save changes</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2"><Label>Full name *</Label><Input value={f.name} onChange={set('name')} maxLength={120} /></div>
        <div className="space-y-1.5"><Label>Email</Label><Input value={f.email} onChange={set('email')} type="email" /></div>
        <div className="space-y-1.5"><Label>Age</Label><Input value={f.age} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" /></div>
        <div className="space-y-1.5">
          <Label>Gender</Label>
          <select className={`${selectCls} w-full`} value={f.gender} onChange={set('gender')}>
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2"><Label>Chief complaint</Label><Textarea rows={3} value={f.complaint} onChange={set('complaint')} maxLength={1000} /></div>
        <p className="text-xs text-muted-foreground sm:col-span-2">To change the doctor, date or time use Reschedule, so slots are checked and the patient is told.</p>
      </div>
    </Modal>
  );
}
