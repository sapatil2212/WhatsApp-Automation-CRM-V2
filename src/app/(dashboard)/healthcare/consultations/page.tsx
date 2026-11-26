'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarClock, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Eye, FileClock, FileText, Loader2, Pencil, Play, Search, Stethoscope, Timer, Trash2, X, BellRing } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api } from '@/lib/campaigns/api';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/hooks/use-auth';

type Tab = 'today' | 'upcoming' | 'waiting' | 'in_progress' | 'completed' | 'all';
interface Row {
  appointmentId: string;
  ref: string;
  patient: { contactId: string; name: string; code: string | null; age: string | null; gender: string | null; phone: string | null };
  doctor: { id: string; name: string } | null;
  department: string | null;
  date: string;
  time: string;
  type: string;
  status: 'waiting' | 'ready' | 'in_progress' | 'completed' | 'no_show' | 'cancelled';
  consultationId: string | null;
  prescription: { status: string; deliveryStatus: string; prescriptionNo: string } | null;
}
interface Queue {
  items: Row[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  stats: { today: number; pending: number; inProgress: number; completed: number; pendingReview: number; avgMinutes: number | null };
  followUps: Array<{ consultationId: string; contactId: string; name: string; phone: string | null; doctor: string | null; date: string | null; overdue: boolean }>;
  doctors: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  today: string;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'today', label: "Today's" },
  { id: 'waiting', label: 'Waiting' },
  { id: 'in_progress', label: 'In consultation' },
  { id: 'completed', label: 'Completed' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'all', label: 'All' },
];
const STATUS: Record<Row['status'], { label: string; cls: string }> = {
  waiting: { label: 'Waiting', cls: 'bg-muted text-muted-foreground' },
  ready: { label: 'Ready for consultation', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  in_progress: { label: 'In progress', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  completed: { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  no_show: { label: 'No-show', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
};
type QueueStatus = 'ready' | 'in_progress' | 'completed' | 'no_show' | 'cancelled';
/** What staff can set by hand, and what the patient is told on WhatsApp. */
const STATUS_OPTIONS: Array<{ id: QueueStatus; label: string; notice: string | null }> = [
  { id: 'ready', label: 'Ready for consultation', notice: null },
  { id: 'in_progress', label: 'In progress', notice: 'The doctor is ready to see you now.' },
  { id: 'completed', label: 'Completed', notice: 'Thank-you message and feedback request.' },
  { id: 'no_show', label: 'No-show', notice: '"We missed you" message with a rebooking link.' },
  { id: 'cancelled', label: 'Cancelled', notice: 'Cancellation notice.' },
];
/** Options that make sense from the current status (the server enforces the same rules). */
function allowedFrom(s: Row['status']): QueueStatus[] {
  switch (s) {
    case 'waiting':
    case 'ready':
    case 'no_show':
    case 'cancelled':
      // Cancelled / no-show can be reinstated (same slot, if still free).
      return ['ready', 'in_progress', 'completed', 'no_show', 'cancelled'];
    case 'in_progress':
      return ['in_progress', 'completed', 'cancelled'];
    default:
      // A completed consultation is a medical record.
      return [];
  }
}
/** Reminders go to patients who are still expected: upcoming, waiting or ready. */
const canRemind = (r: Row) => r.status === 'waiting' || r.status === 'ready';

/** WhatsApp message a change sends, given where the patient is now. */
function noticeFor(from: Row['status'], to: QueueStatus): string | null {
  if (to === 'ready') return from === 'cancelled' || from === 'no_show' ? 'Your appointment is back on (same date and time).' : null;
  return STATUS_OPTIONS.find((o) => o.id === to)?.notice ?? null;
}
const selectCls = 'h-8 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
const inputCls = 'h-8 text-[13px] md:text-[13px]';
const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtPhone = (p?: string | null) => {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
};
const initials = (n?: string | null) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const AVATARS = ['bg-sky-500/15', 'bg-emerald-500/15', 'bg-violet-500/15', 'bg-amber-500/15', 'bg-rose-500/15', 'bg-teal-500/15'];
const avatarColor = (id: string) => AVATARS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];

export default function ConsultationsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const tenantId = (profile as { tenant_id?: string; tenantId?: string } | null)?.tenant_id ?? (profile as { tenantId?: string } | null)?.tenantId;
  const [data, setData] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('today');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [starting, setStarting] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: Row; status: QueueStatus } | null>(null);
  const [notify, setNotify] = useState(true);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reminding, setReminding] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<QueueStatus | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ tab, page: String(page), pageSize: '25' });
      if (debounced) q.set('search', debounced);
      if (doctorId) q.set('doctorId', doctorId);
      if (departmentId) q.set('departmentId', departmentId);
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      setData((await api<Queue>(`/api/healthcare/consultations?${q}`)).data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab, page, debounced, doctorId, departmentId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live refresh when appointments are booked, moved or consultations change.
  useEffect(() => {
    if (!tenantId) return;
    const socket = getSocket();
    const join = () => socket.emit('join-tenant', tenantId);
    const refresh = () => void load();
    if (!socket.connected) socket.connect();
    else join();
    socket.on('connect', join);
    socket.on('appointments:changed', refresh);
    const poll = setInterval(refresh, 60_000);
    return () => {
      socket.off('connect', join);
      socket.off('appointments:changed', refresh);
      clearInterval(poll);
    };
  }, [tenantId, load]);

  const start = async (r: Row) => {
    if (r.consultationId) return router.push(`/healthcare/consultations/${r.consultationId}`);
    setStarting(r.appointmentId);
    try {
      const res = await api<{ consultationId: string }>('/api/healthcare/consultations/start', { method: 'POST', json: { appointmentId: r.appointmentId } });
      router.push(`/healthcare/consultations/${res.data.consultationId}`);
    } catch (e) {
      toast.error((e as Error).message);
      setStarting(null);
    }
  };

  const changeStatus = async (row: Row, status: QueueStatus, sendNotice: boolean) => {
    try {
      const res = await api<{ messaged: boolean; notifiable: boolean }>(`/api/healthcare/consultations/queue/${row.appointmentId}/status`, {
        method: 'POST',
        json: { status, notify: sendNotice },
      });
      const label = STATUS_OPTIONS.find((o) => o.id === status)?.label ?? status;
      toast.success(`${row.patient.name}: ${label}.`, {
        description: res.data.messaged ? 'Patient notified on WhatsApp.' : sendNotice && !res.data.notifiable ? 'Not sent on WhatsApp: the patient has not agreed to messages.' : undefined,
      });
      await load();
    } catch (e) {
      toast.error((e as Error).message, { duration: 8000 });
      throw e;
    }
  };

  const rows = data?.items ?? [];
  const selectedRows = rows.filter((r) => selected.has(r.appointmentId));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.appointmentId));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) rows.forEach((r) => n.delete(r.appointmentId));
      else rows.forEach((r) => n.add(r.appointmentId));
      return n;
    });
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Instant WhatsApp reminder with the appointment details (same engine as the Appointments page). */
  const remind = async (list: Row[]) => {
    const targets = list.filter(canRemind);
    if (!targets.length) return toast.error('Reminders can be sent only for upcoming or waiting patients.');
    setReminding((s) => new Set([...s, ...targets.map((r) => r.appointmentId)]));
    let sent = 0;
    const failed: string[] = [];
    for (const r of targets) {
      try {
        const res = await api<{ messaged: boolean }>(`/api/healthcare/appointments/board/${r.appointmentId}`, { method: 'PATCH', json: { action: 'remind' } });
        if (res.data.messaged) sent += 1;
        else failed.push(`${r.patient.name}: not delivered`);
      } catch (e) {
        failed.push(`${r.patient.name}: ${(e as Error).message}`);
      }
    }
    setReminding((s) => {
      const n = new Set(s);
      targets.forEach((r) => n.delete(r.appointmentId));
      return n;
    });
    if (sent) toast.success(targets.length === 1 ? `Reminder sent to ${targets[0].patient.name} on WhatsApp.` : `Reminders sent: ${sent} of ${targets.length}.`);
    if (failed.length) toast.error(failed.length === 1 ? failed[0] : `${failed.length} reminders not sent. ${failed[0]}`, { duration: 9000 });
    const skipped = list.length - targets.length;
    if (skipped > 0) toast.message(`${skipped} skipped (not upcoming or waiting).`);
  };

  /** Applies one status to every selected row; rows the change does not apply to are skipped. */
  const applyBulkStatus = async (status: QueueStatus, sendNotice: boolean) => {
    const targets = selectedRows.filter((r) => allowedFrom(r.status).includes(status) && !(status === 'ready' && (r.status === 'ready' || r.status === 'waiting')) && r.status !== status);
    let ok = 0;
    let messaged = 0;
    const failed: string[] = [];
    for (const r of targets) {
      try {
        const res = await api<{ messaged: boolean }>(`/api/healthcare/consultations/queue/${r.appointmentId}/status`, { method: 'POST', json: { status, notify: sendNotice } });
        ok += 1;
        if (res.data.messaged) messaged += 1;
      } catch (e) {
        failed.push(`${r.patient.name}: ${(e as Error).message}`);
      }
    }
    const label = STATUS_OPTIONS.find((o) => o.id === status)?.label ?? status;
    if (ok) toast.success(`${ok} marked ${label.toLowerCase()}.`, { description: messaged ? `${messaged} notified on WhatsApp.` : undefined });
    if (failed.length) toast.error(`${failed.length} not changed. ${failed[0]}`, { duration: 9000 });
    if (selectedRows.length > targets.length) toast.message(`${selectedRows.length - targets.length} skipped (already ${label.toLowerCase()} or not allowed).`);
    setSelected(new Set());
    await load();
  };

  /** Deletes the selected visits: appointment, consultation, prescription and dictations. */
  const applyBulkDelete = async () => {
    const res = await api<{ deleted: string[]; blocked: Array<{ id: string; reason: string }> }>('/api/healthcare/appointments/board/bulk-delete', {
      method: 'POST',
      json: { ids: selectedRows.map((r) => r.appointmentId) },
    }).catch((e: Error) => {
      toast.error(e.message);
      throw e;
    });
    if (res.data.deleted.length) toast.success(`${res.data.deleted.length} record${res.data.deleted.length === 1 ? '' : 's'} deleted.`);
    if (res.data.blocked.length) toast.error(`${res.data.blocked.length} not deleted. ${res.data.blocked[0].reason}`);
    setSelected(new Set());
    await load();
  };
  const filters = Boolean(debounced || doctorId || departmentId || from || to);
  const COLS = 8;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Consultations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Patients ready to be seen. Start a consultation, dictate the prescription, and send it on WhatsApp.</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Today's patients", value: data?.stats.today, icon: CalendarClock },
          { label: 'Pending', value: data?.stats.pending, icon: Clock },
          { label: 'In consultation', value: data?.stats.inProgress, icon: Stethoscope },
          { label: 'Completed today', value: data?.stats.completed, icon: CheckCircle2 },
          { label: 'Rx awaiting review', value: data?.stats.pendingReview, icon: FileClock },
          { label: 'Avg. consult time', value: data?.stats.avgMinutes != null ? `${data.stats.avgMinutes} min` : '—', icon: Timer },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10"><s.icon className="size-3.5 text-primary" /></span>
            </div>
            <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{s.value ?? '—'}</p>
          </div>
        ))}
      </div>

      {data && data.followUps.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold"><ClipboardCheck className="size-3.5 text-amber-600" /> Follow-ups due ({data.followUps.length})</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {data.followUps.map((f) => (
              <li key={f.consultationId}>
                <button type="button" onClick={() => router.push(`/healthcare/patients/${f.contactId}`)} className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors hover:bg-background ${f.overdue ? 'border-rose-500/50 text-rose-700 dark:text-rose-400' : 'border-amber-500/50'}`}>
                  {f.name} · {f.date ? fmtDate(f.date) : ''}{f.overdue ? ' (overdue)' : ''}{f.doctor ? ` · ${f.doctor}` : ''}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">Patients without a later appointment. Book their follow-up from Appointments → New appointment.</p>
        </div>
      )}

      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-xl border border-border/70 bg-card p-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setPage(1); }} className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>{t.label}</button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, phone, patient ID…" className={`${inputCls} pl-8 pr-8`} aria-label="Search consultations" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-3.5" /></button>}
        </div>
        <select aria-label="Doctor" className={selectCls} value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setPage(1); }}>
          <option value="">All doctors</option>
          {data?.doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {data && data.departments.length > 0 && (
          <select aria-label="Department" className={selectCls} value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }}>
            <option value="">All departments</option>
            {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={`${inputCls} w-[132px]`} />
          <span className="text-[11px] text-muted-foreground">to</span>
          <Input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={`${inputCls} w-[132px]`} />
        </div>
        {filters && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setSearch(''); setDoctorId(''); setDepartmentId(''); setFrom(''); setTo(''); }}>Clear filters</Button>}
        <p className="ml-auto text-[11px] text-muted-foreground">{(data?.pagination.total ?? 0).toLocaleString()} {filters ? 'matching' : 'patients'}</p>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[13px]" role="status">
          <span className="font-medium">{selected.size} selected</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={bulkBusy || !selectedRows.some(canRemind)} onClick={async () => { setBulkBusy(true); try { await remind(selectedRows); } finally { setBulkBusy(false); } }}>
              <BellRing className="size-3.5" /> Send reminder
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-1.5" disabled={bulkBusy} />}>
                Change status <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {STATUS_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.id} onClick={() => { setNotify(true); setBulkStatus(o.id); }}>
                    <span className={`size-1.5 rounded-full ${STATUS[o.id].cls.split(' ').find((c) => c.startsWith('text-')) ?? ''} bg-current`} /> <span className="text-[13px]">{o.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="destructive" size="sm" className="gap-1.5" disabled={bulkBusy} onClick={() => setBulkDelete(true)}>
              <Trash2 className="size-3.5" /> Delete selected
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] table-fixed text-[13px]">
            <colgroup>
              <col className="w-10" />
              <col className="w-[22%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[14%]" />
              <col className="w-[230px]" />
            </colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-2 pl-4"><input type="checkbox" className="size-4 rx-check" aria-label="Select all on this page" checked={allSelected} onChange={toggleAll} disabled={rows.length === 0} /></th>
                <th className="px-4 py-2">Patient</th>
                <th className="px-3 py-2">Appointment</th>
                <th className="px-3 py-2">Doctor</th>
                <th className="px-3 py-2">Date &amp; time</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && rows.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={COLS} className="px-4 py-3"><div className="h-9 animate-pulse rounded-lg bg-muted/70" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLS} className="px-4 py-16 text-center"><Stethoscope className="mx-auto size-9 text-muted-foreground/60" /><p className="mt-3 text-sm font-medium">{filters ? 'No patients match these filters' : 'No patients here'}</p><p className="mt-1 text-xs text-muted-foreground">{filters ? 'Try a different search, doctor or date.' : 'Booked appointments appear here on their day.'}</p></td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.appointmentId} onClick={() => setViewing(r)} className={`group cursor-pointer transition-colors hover:bg-muted/50 ${selected.has(r.appointmentId) ? 'bg-primary/5' : ''} ${loading ? 'opacity-60' : ''}`}>
                    <td className="py-2 pl-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="size-4 rx-check" aria-label={`Select ${r.patient.name}`} checked={selected.has(r.appointmentId)} onChange={() => toggleOne(r.appointmentId)} /></td>
                    <td className="px-4 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-foreground ${avatarColor(r.patient.contactId)}`}>{initials(r.patient.name)}</span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.patient.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {[r.patient.code, r.patient.age && `${r.patient.age} yrs`, r.patient.gender && r.patient.gender.charAt(0).toUpperCase() + r.patient.gender.slice(1).replace(/_/g, ' ')].filter(Boolean).join(' · ')}
                            {(r.patient.code || r.patient.age || r.patient.gender) && r.patient.phone ? ' · ' : ''}
                            <span className="font-mono tabular-nums">{fmtPhone(r.patient.phone)}</span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <p className="truncate font-mono text-[11px]">{r.ref}</p>
                      {r.prescription?.status === 'finalized' && <p className="truncate font-mono text-[11px] text-muted-foreground">{r.prescription.prescriptionNo}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <p className="truncate">{r.doctor?.name ?? '—'}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{r.department || '—'}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p className="truncate">{r.date === data?.today ? <span className="font-medium text-primary">Today</span> : fmtDate(r.date)}</p>
                      <p className="text-[11px] tabular-nums text-muted-foreground">{fmtTime(r.time)}</p>
                    </td>
                    <td className="px-3 py-2"><span className="block truncate">{r.type}</span></td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {allowedFrom(r.status).length > 1 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Change status for ${r.patient.name}`}
                            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium transition-shadow hover:ring-1 hover:ring-current/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${STATUS[r.status].cls}`}
                          >
                            <span className="size-1.5 rounded-full bg-current" />
                            {STATUS[r.status].label}
                            <ChevronDown className="size-3 opacity-70" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-52">
                            {STATUS_OPTIONS.filter((o) => allowedFrom(r.status).includes(o.id)).map((o) => {
                              const current = o.id === r.status || (o.id === 'ready' && r.status === 'waiting');
                              return (
                                <DropdownMenuItem key={o.id} disabled={current} onClick={() => { setNotify(true); setPending({ row: r, status: o.id }); }}>
                                  <span className="flex w-full items-center gap-2 text-[13px]">
                                    <span className={`size-1.5 rounded-full ${STATUS[o.id].cls.split(' ').find((c) => c.startsWith('text-')) ?? ''} bg-current`} />
                                    {o.label}
                                    {current && <Check className="ml-auto size-3.5 text-primary" />}
                                  </span>
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[r.status].cls}`}>
                          <span className="size-1.5 rounded-full bg-current" />
                          {STATUS[r.status].label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        {r.status === 'cancelled' || r.status === 'no_show' || (r.status === 'completed' && !r.consultationId) ? null : (
                          <Button size="sm" variant={r.status === 'completed' ? 'outline' : 'default'} className="mr-1 gap-1 whitespace-nowrap" disabled={starting === r.appointmentId} onClick={() => start(r)}>
                            {starting === r.appointmentId ? <Loader2 className="size-3.5 animate-spin" /> : r.status === 'completed' ? <FileText className="size-3.5" /> : <Play className="size-3.5" />}
                            {r.status === 'completed' ? 'Open' : r.consultationId ? 'Continue' : 'Start'}
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="View details" aria-label={`View ${r.patient.name}`} onClick={() => setViewing(r)}><Eye className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit patient details" aria-label={`Edit ${r.patient.name}`} disabled={r.status === 'cancelled'} onClick={() => setEditing(r)}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title={canRemind(r) ? 'Send WhatsApp reminder now' : 'Reminders are for upcoming or waiting patients'} aria-label={`Send reminder to ${r.patient.name}`} disabled={!canRemind(r) || reminding.has(r.appointmentId)} onClick={() => void remind([r])}>{reminding.has(r.appointmentId) ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}</Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Delete"
                          aria-label={`Delete ${r.patient.name}`}
                          onClick={() => setRemoving(r)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
          <span>{(data?.pagination.total ?? 0).toLocaleString()} patients</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" className="size-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-3.5" /></Button>
            <span className="px-2 tabular-nums">Page {page} of {data?.pagination.totalPages ?? 1}</span>
            <Button variant="outline" size="icon-sm" className="size-7" disabled={page >= (data?.pagination.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-3.5" /></Button>
          </div>
        </div>
      </div>

      {viewing && <ViewDialog row={viewing} today={data?.today ?? ''} onClose={() => setViewing(null)} onOpen={() => { const r = viewing; setViewing(null); void start(r); }} onPatient={() => router.push(`/healthcare/patients/${viewing.patient.contactId}`)} />}
      {editing && <EditDialog row={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}

      <ConfirmationDialog
        isOpen={Boolean(removing)}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title={removing?.consultationId ? 'Delete this consultation?' : 'Delete this appointment?'}
        description="The visit and everything recorded for it are permanently deleted."
        details={
          removing ? (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-semibold">{removing.patient.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{removing.ref}</span>
              </div>
              <p className="text-[12px] text-muted-foreground">{fmtDate(removing.date)} · {fmtTime(removing.time)}{removing.doctor ? ` · ${removing.doctor.name}` : ''}</p>
            </div>
          ) : null
        }
        notes={[
          ...(removing?.consultationId ? ['The appointment, consultation notes, dictations and prescription (including a finalized one) are deleted.'] : ['The appointment is deleted.']),
          'This cannot be undone. The patient is not notified.',
        ]}
        confirmText="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api(`/api/healthcare/appointments/board/${removing.appointmentId}`, { method: 'DELETE' });
            toast.success(removing.consultationId ? 'Consultation and appointment deleted.' : 'Appointment deleted.');
            setRemoving(null);
            await load();
          } catch (e) {
            toast.error((e as Error).message, { duration: 8000 });
            throw e;
          }
        }}
      />

      <ConfirmationDialog
        isOpen={Boolean(bulkStatus)}
        onOpenChange={(o) => { if (!o) setBulkStatus(null); }}
        title={bulkStatus ? `Mark ${selected.size} as ${STATUS_OPTIONS.find((o) => o.id === bulkStatus)?.label.toLowerCase()}?` : ''}
        description="Each selected patient is updated. Patients this change does not apply to are skipped."
        details={
          bulkStatus ? (
            <div className="space-y-1">
              <ul className="max-h-28 space-y-0.5 overflow-y-auto">
                {selectedRows.slice(0, 5).map((r) => (
                  <li key={r.appointmentId} className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{r.patient.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{STATUS[r.status].label}</span>
                  </li>
                ))}
                {selectedRows.length > 5 && <li className="text-[11px] text-muted-foreground">and {selectedRows.length - 5} more</li>}
              </ul>
              {STATUS_OPTIONS.find((o) => o.id === bulkStatus)?.notice && (
                <label className="flex cursor-pointer items-center gap-2 border-t border-border/60 pt-2 text-[12px]">
                  <input type="checkbox" className="rx-check" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                  Notify each patient on WhatsApp
                </label>
              )}
            </div>
          ) : null
        }
        confirmText="Update status"
        variant={bulkStatus === 'cancelled' || bulkStatus === 'no_show' ? 'destructive' : 'default'}
        icon="warning"
        onConfirm={async () => {
          if (bulkStatus) await applyBulkStatus(bulkStatus, notify);
        }}
      />

      <ConfirmationDialog
        isOpen={bulkDelete}
        onOpenChange={setBulkDelete}
        title={`Delete ${selectedRows.length} record${selectedRows.length === 1 ? '' : 's'}?`}
        description="Each visit and everything recorded for it are permanently deleted."
        details={
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {selectedRows.slice(0, 5).map((r) => (
              <li key={r.appointmentId} className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">{r.patient.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{fmtDate(r.date)} · {fmtTime(r.time)}</span>
              </li>
            ))}
            {selectedRows.length > 5 && <li className="text-[11px] text-muted-foreground">and {selectedRows.length - 5} more</li>}
          </ul>
        }
        notes={[
          'Appointments, consultation notes, dictations and prescriptions (including finalized ones) are deleted.',
          'This cannot be undone. Patients are not notified.',
        ]}
        confirmText={`Delete ${selectedRows.length}`}
        variant="destructive"
        onConfirm={applyBulkDelete}
      />

      <ConfirmationDialog
        isOpen={Boolean(pending)}
        onOpenChange={(o) => { if (!o) setPending(null); }}
        title={pending ? `Mark as ${STATUS_OPTIONS.find((o) => o.id === pending.status)?.label.toLowerCase()}?` : ''}
        description={
          pending?.status === 'in_progress'
            ? 'This starts the consultation for this patient.'
            : pending?.status === 'completed'
              ? 'This closes the visit.'
              : pending?.status === 'ready'
                ? pending.row.status === 'cancelled' || pending.row.status === 'no_show'
                  ? 'The appointment is put back on the schedule.'
                  : 'The patient goes back to the waiting list.'
                : 'This updates the appointment status.'
        }
        details={
          pending ? (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-semibold">{pending.row.patient.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{pending.row.ref}</span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {fmtDate(pending.row.date)} · {fmtTime(pending.row.time)}{pending.row.doctor ? ` · ${pending.row.doctor.name}` : ''}
              </p>
              {noticeFor(pending.row.status, pending.status) && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-border/60 pt-2 text-[12px]">
                  <input type="checkbox" className="rx-check" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                  Notify on WhatsApp: {noticeFor(pending.row.status, pending.status)}
                </label>
              )}
            </div>
          ) : null
        }
        notes={
          !pending
            ? undefined
            : [
                ...((pending.row.status === 'cancelled' || pending.row.status === 'no_show') && pending.status !== pending.row.status && pending.status !== 'cancelled'
                  ? ['The appointment is reinstated at the same date and time. If another patient has taken that slot, reschedule it from Appointments instead.']
                  : []),
                ...(pending.status === 'completed' && pending.row.status === 'in_progress' ? ['The open consultation is closed. Its draft prescription is not issued or sent.'] : []),
                ...(pending.status === 'cancelled' && pending.row.status === 'in_progress' ? ['The open consultation is cancelled too. Its notes are kept if you reinstate the appointment.'] : []),
                ...(pending.status === 'in_progress' && pending.row.consultationId ? ['The earlier consultation draft is resumed.'] : []),
              ]
        }
        confirmText="Update status"
        variant={pending?.status === 'cancelled' || pending?.status === 'no_show' ? 'destructive' : 'default'}
        icon="warning"
        onConfirm={async () => {
          if (pending) await changeStatus(pending.row, pending.status, notify);
        }}
      />
    </div>
  );
}

// ── row dialogs ───────────────────────────────────────────────────────

const GENDERS = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other', label: 'Other' },
  { id: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const;

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-medium">{children}</dd>
    </>
  );
}

function ViewDialog({ row, today, onClose, onOpen, onPatient }: { row: Row; today: string; onClose: () => void; onOpen: () => void; onPatient: () => void }) {
  const canOpen = !(row.status === 'cancelled' || row.status === 'no_show' || (row.status === 'completed' && !row.consultationId));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        <div className="px-5 pb-4 pt-5">
          <DialogTitle className="text-[15px] font-semibold">{row.patient.name}</DialogTitle>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {[row.patient.code, [row.patient.age && `${row.patient.age} yrs`, row.patient.gender].filter(Boolean).join(' · ')].filter(Boolean).join(' · ') || 'No patient details yet'}
          </p>
          <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-[13px]">
            <DetailRow label="Appointment"><span className="font-mono text-[12px]">{row.ref}</span></DetailRow>
            <DetailRow label="Status"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[row.status].cls}`}><span className="size-1.5 rounded-full bg-current" />{STATUS[row.status].label}</span></DetailRow>
            <DetailRow label="Date & time">{row.date === today ? 'Today' : fmtDate(row.date)} · {fmtTime(row.time)}</DetailRow>
            <DetailRow label="Doctor">{row.doctor?.name ?? '—'}{row.department ? ` · ${row.department}` : ''}</DetailRow>
            <DetailRow label="Type">{row.type}</DetailRow>
            <DetailRow label="Phone"><span className="font-mono text-[12px]">{row.patient.phone ? `+${row.patient.phone}` : '—'}</span></DetailRow>
            <DetailRow label="Prescription">{row.prescription?.status === 'finalized' ? <span className="font-mono text-[12px]">{row.prescription.prescriptionNo}</span> : row.consultationId ? 'Draft' : '—'}</DetailRow>
          </dl>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border/70 bg-muted/30 px-5 py-3 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={onPatient}>Patient record</Button>
          {canOpen && (
            <Button size="sm" className="gap-1.5" onClick={onOpen}>
              {row.status === 'completed' ? <FileText className="size-3.5" /> : <Play className="size-3.5" />}
              {row.status === 'completed' ? 'Open consultation' : row.consultationId ? 'Continue consultation' : 'Start consultation'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [form, setForm] = useState({ name: row.patient.name ?? '', age: row.patient.age ?? '', gender: row.patient.gender ?? '', email: '', complaint: '' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Complaint and email are not in the queue row; read the current values.
    api<{ complaint: string | null; patient: { email: string | null; gender: string | null; age: string | null; name: string | null } }>(`/api/healthcare/appointments/board/${row.appointmentId}`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        setForm((f) => ({ ...f, name: d.patient.name ?? f.name, age: d.patient.age ?? f.age, gender: d.patient.gender ?? f.gender, email: d.patient.email ?? '', complaint: d.complaint ?? '' }));
      })
      .catch(() => { /* edit with what the row has */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [row.appointmentId]);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/healthcare/appointments/board/${row.appointmentId}`, {
        method: 'PATCH',
        json: {
          action: 'edit',
          name: form.name.trim(),
          age: form.age.trim(),
          gender: form.gender || null,
          email: form.email.trim(),
          complaint: form.complaint.trim(),
        },
      });
      toast.success('Patient details saved.');
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const field = 'h-8 text-[13px] md:text-[13px]';
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[480px]">
        <div className="px-5 pb-4 pt-5">
          <DialogTitle className="text-[15px] font-semibold">Edit patient details</DialogTitle>
          <p className="mt-0.5 text-[12px] text-muted-foreground"><span className="font-mono">{row.ref}</span> · {fmtDate(row.date)} · {fmtTime(row.time)}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-[12px] font-medium">Patient name</span>
              <Input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!loaded} />
            </label>
            <label className="space-y-1">
              <span className="text-[12px] font-medium">Age</span>
              <Input className={field} inputMode="numeric" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value.replace(/\D/g, '').slice(0, 3) })} disabled={!loaded} />
            </label>
            <label className="space-y-1">
              <span className="text-[12px] font-medium">Gender</span>
              <select className={`${selectCls} w-full`} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} disabled={!loaded}>
                <option value="">Not specified</option>
                {GENDERS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-[12px] font-medium">Email <span className="font-normal text-muted-foreground">(optional)</span></span>
              <Input className={field} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!loaded} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-[12px] font-medium">Complaint / reason for visit</span>
              <textarea
                rows={3}
                className="w-full resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                value={form.complaint}
                onChange={(e) => setForm({ ...form, complaint: e.target.value })}
                disabled={!loaded}
              />
            </label>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border/70 bg-muted/30 px-5 py-3 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" className="gap-1.5" onClick={() => void save()} disabled={saving || !loaded || form.name.trim().length < 2}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}