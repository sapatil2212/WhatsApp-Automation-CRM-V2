'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock, FileClock, Loader2, Play, Search, Stethoscope, Timer, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  status: 'waiting' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
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
  cancelled: { label: 'Cancelled', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
};
const selectCls = 'h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
const inputCls = 'h-8 text-xs md:text-xs';
const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

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

  const rows = data?.items ?? [];
  const filters = Boolean(debounced || doctorId || departmentId || from || to);
  const COLS = 8;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Stethoscope className="size-5 text-primary" /> Consultation</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">Patients ready to be seen. Start a consultation, dictate the prescription, and send it on WhatsApp.</p>
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
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10"><s.icon className="size-3.5 text-primary" /></span>
            </div>
            <p className="mt-1 text-xl font-semibold leading-none tabular-nums">{s.value ?? '—'}</p>
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

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        {/* Toolbar: tabs on the left, filters on the right */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
          <div className="flex flex-wrap rounded-md border border-border bg-muted/40 p-0.5" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setPage(1); }} className={`h-7 rounded px-2.5 text-xs font-medium transition-colors ${tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{t.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[210px]">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, phone, patient ID…" className={`${inputCls} pl-7`} aria-label="Search" />
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
              <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={`${inputCls} w-[128px]`} />
              <span className="text-[11px] text-muted-foreground">to</span>
              <Input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={`${inputCls} w-[128px]`} />
            </div>
            {filters && <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => { setSearch(''); setDoctorId(''); setDepartmentId(''); setFrom(''); setTo(''); }}><X className="size-3.5" /> Clear</Button>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] table-fixed text-xs">
            <colgroup>
              <col className="w-[11%]" /><col className="w-[20%]" /><col className="w-[12%]" /><col className="w-[15%]" /><col className="w-[11%]" /><col className="w-[9%]" /><col className="w-[11%]" /><col className="w-[11%]" />
            </colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-2.5 pl-4 pr-3">Appointment</th>
                <th className="px-3 py-2.5">Patient</th>
                <th className="px-3 py-2.5">Phone</th>
                <th className="px-3 py-2.5">Doctor</th>
                <th className="px-3 py-2.5">Date &amp; time</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="py-2.5 pl-3 pr-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading && rows.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={COLS} className="px-4 py-2"><div className="h-8 animate-pulse rounded-md bg-muted/70" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLS} className="px-4 py-14 text-center"><Stethoscope className="mx-auto size-8 text-muted-foreground/50" /><p className="mt-2.5 text-sm font-medium">{filters ? 'No appointments match these filters' : 'No patients here'}</p><p className="mt-1 text-xs text-muted-foreground">Booked appointments appear here on their day.</p></td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.appointmentId} className={`align-middle transition-colors duration-200 hover:bg-muted/40 ${loading ? 'opacity-60' : ''}`}>
                    <td className="py-2.5 pl-4 pr-3">
                      <p className="truncate font-mono text-[11px] font-medium">{r.ref}</p>
                      {r.prescription?.status === 'finalized' && <p className="truncate font-mono text-[10px] text-muted-foreground">{r.prescription.prescriptionNo}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="truncate text-[13px] font-medium leading-tight">{r.patient.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{[r.patient.code, [r.patient.age && `${r.patient.age}y`, r.patient.gender?.charAt(0).toUpperCase()].filter(Boolean).join(' / ')].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] tabular-nums">{r.patient.phone ? `+${r.patient.phone}` : '—'}</td>
                    <td className="px-3 py-2.5">
                      <p className="truncate text-xs font-medium leading-tight">{r.doctor?.name ?? '—'}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{r.department ?? ''}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-xs font-medium leading-tight">{r.date === data?.today ? <span className="text-primary">Today</span> : fmtDate(r.date)}</p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{fmtTime(r.time)}</p>
                    </td>
                    <td className="px-3 py-2.5"><span className="block truncate text-xs">{r.type}</span></td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[r.status].cls}`}>
                        <span className="size-1.5 rounded-full bg-current" />
                        {STATUS[r.status].label}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-right">
                      {r.status === 'cancelled' ? null : (
                        <Button size="sm" variant={r.status === 'completed' ? 'outline' : 'default'} className="h-7 gap-1 whitespace-nowrap px-2.5 text-[11px]" disabled={starting === r.appointmentId} onClick={() => start(r)}>
                          {starting === r.appointmentId ? <Loader2 className="size-3 animate-spin" /> : r.consultationId ? null : <Play className="size-3" />}
                          {r.status === 'completed' ? 'View' : r.consultationId ? 'Continue' : 'Start'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span>{data?.pagination.total ?? 0} appointments</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" className="size-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-3.5" /></Button>
            <span className="px-2 tabular-nums">Page {page} of {data?.pagination.totalPages ?? 1}</span>
            <Button variant="outline" size="icon-sm" className="size-7" disabled={page >= (data?.pagination.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-3.5" /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}