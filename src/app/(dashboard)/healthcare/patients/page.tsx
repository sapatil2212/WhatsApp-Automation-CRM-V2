'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Activity, AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Download, Eye, Loader2, Pencil, Search, UserPlus, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/campaigns/api';

interface Row {
  contactId: string;
  code: string | null;
  name: string;
  age: string | null;
  gender: string | null;
  phone: string | null;
  bloodGroup: string | null;
  hasAllergies: boolean;
  lastConsultation: string | null;
  totalConsultations: number;
  doctor: string | null;
  status: 'active' | 'inactive';
  registeredAt: string;
}
interface Data {
  items: Row[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  stats: { total: number; newThisMonth: number; withAllergies: number; active: number; todayAppointments: number };
}

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENDER: Record<string, string> = { male: 'M', female: 'F', other: 'Other', prefer_not_to_say: '—' };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const selectCls = 'h-8 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export default function PatientsPage() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [blood, setBlood] = useState('');
  const [allergies, setAllergies] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useCallback(
    (p: number, size: number) => {
      const q = new URLSearchParams({ page: String(p), pageSize: String(size) });
      if (debounced) q.set('search', debounced);
      if (status) q.set('status', status);
      if (blood) q.set('bloodGroup', blood);
      if (allergies) q.set('allergies', 'yes');
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      return q;
    },
    [debounced, status, blood, allergies, from, to],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData((await api<Data>(`/api/healthcare/patients?${query(page, 25)}`)).data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, query]);
  useEffect(() => {
    void load();
  }, [load]);

  /** CSV of every patient matching the filters (up to 2,000). */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: Row[] = [];
      for (let p = 1; p <= 20; p++) {
        const res = (await api<Data>(`/api/healthcare/patients?${query(p, 100)}`)).data;
        all.push(...res.items);
        if (p >= res.pagination.totalPages) break;
      }
      const header = ['Patient ID', 'Name', 'Age', 'Gender', 'Phone', 'Blood group', 'Allergies recorded', 'Visits', 'Last consultation', 'Doctor', 'Status', 'Registered'];
      const lines = all.map((r) => [r.code, r.name, r.age, r.gender, r.phone ? `+${r.phone}` : '', r.bloodGroup, r.hasAllergies ? 'Yes' : 'No', r.totalConsultations, r.lastConsultation?.slice(0, 10), r.doctor, r.status, r.registeredAt.slice(0, 10)].map(csvCell).join(','));
      const url = URL.createObjectURL(new Blob(['﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `patients-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length} patient${all.length === 1 ? '' : 's'}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const rows = data?.items ?? [];
  const filters = Boolean(debounced || status || blood || allergies || from || to);
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Patients</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Electronic health records: history, vitals, medications, prescriptions and documents.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={exporting || !data?.pagination.total} onClick={() => void exportCsv()}>
          {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Export
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Total patients', value: data?.stats.total, icon: Users, onClick: () => { setStatus(''); setAllergies(false); setPage(1); } },
          { label: 'Active (6 months)', value: data?.stats.active, icon: Activity, onClick: () => { setStatus('active'); setPage(1); } },
          { label: 'New this month', value: data?.stats.newThisMonth, icon: UserPlus },
          { label: 'With allergies', value: data?.stats.withAllergies, icon: AlertTriangle, onClick: () => { setAllergies(true); setPage(1); } },
          { label: "Today's appointments", value: data?.stats.todayAppointments, icon: CalendarClock, onClick: () => router.push('/healthcare/consultations') },
        ].map((s) => (
          <button key={s.label} type="button" onClick={s.onClick} disabled={!s.onClick} className="rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors enabled:hover:border-primary/40 disabled:cursor-default">
            <div className="flex items-center justify-between">
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><s.icon className="size-3.5" /></span>
            </div>
            <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{s.value ?? '—'}</p>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2.5">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, phone or patient ID…" className="h-8 pl-8 text-[13px] md:text-[13px]" aria-label="Search patients" />
          </div>
          <select aria-label="Status" className={selectCls} value={status} onChange={(e) => resetPage(setStatus)(e.target.value)}>
            <option value="">All patients</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select aria-label="Blood group" className={selectCls} value={blood} onChange={(e) => resetPage(setBlood)(e.target.value)}>
            <option value="">Any blood group</option>
            {BLOOD.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input px-2.5 text-[13px]">
            <input type="checkbox" className="rx-check" checked={allergies} onChange={(e) => resetPage(setAllergies)(e.target.checked)} /> Allergies
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Registered</span>
            <Input type="date" aria-label="Registered from" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} className="h-8 w-[132px] text-[13px] md:text-[13px]" />
            <span className="text-[11px] text-muted-foreground">to</span>
            <Input type="date" aria-label="Registered to" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} className="h-8 w-[132px] text-[13px] md:text-[13px]" />
          </div>
          {filters && (
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => { setSearch(''); setStatus(''); setBlood(''); setAllergies(false); setFrom(''); setTo(''); setPage(1); }}>
              <X className="size-3.5" /> Clear
            </Button>
          )}
          <p className="ml-auto text-[11px] text-muted-foreground">{data?.pagination.total ?? 0} {filters ? 'matching' : 'patients'}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] table-fixed text-[13px]">
            <colgroup>
              <col className="w-[10%]" /><col className="w-[22%]" /><col className="w-[9%]" /><col className="w-[12%]" /><col className="w-[6%]" /><col className="w-[11%]" /><col className="w-[6%]" /><col className="w-[12%]" /><col className="w-[8%]" /><col className="w-[96px]" />
            </colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Patient ID</th>
                <th className="px-3 py-2">Patient</th>
                <th className="px-3 py-2">Age / sex</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Blood</th>
                <th className="px-3 py-2">Last visit</th>
                <th className="px-3 py-2">Visits</th>
                <th className="px-3 py-2">Doctor</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading && rows.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={10} className="px-4 py-2"><div className="h-8 animate-pulse rounded-md bg-muted/70" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center">
                    <Users className="mx-auto size-8 text-muted-foreground/50" />
                    <p className="mt-2.5 text-sm font-medium">{filters ? 'No patients match these filters' : 'No patients yet'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Patients appear here once they book an appointment.</p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.contactId} onClick={() => router.push(`/healthcare/patients/${r.contactId}`)} className={`cursor-pointer transition-colors hover:bg-muted/40 ${loading ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2 font-mono text-[11px]">{r.code ?? <span className="text-muted-foreground">new</span>}</td>
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initials(r.name)}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.name}</span>
                          {r.hasAllergies && <span className="flex items-center gap-1 text-[10px] font-medium text-rose-600 dark:text-rose-400"><AlertTriangle className="size-3" /> Allergies</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[12px]">{[r.age && `${r.age}y`, r.gender && GENDER[r.gender]].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px] tabular-nums">{r.phone ? `+${r.phone}` : '—'}</td>
                    <td className="px-3 py-2 text-[12px]">{r.bloodGroup ? <span className="rounded bg-rose-500/10 px-1.5 py-px text-[11px] font-semibold text-rose-700 dark:text-rose-300">{r.bloodGroup}</span> : '—'}</td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">{fmt(r.lastConsultation)}</td>
                    <td className="px-3 py-2 tabular-nums">{r.totalConsultations}</td>
                    <td className="truncate px-3 py-2 text-[12px]">{r.doctor ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${r.status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                        <span className="size-1.5 rounded-full bg-current" />{r.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Open health record" aria-label={`Open ${r.name}`} onClick={() => router.push(`/healthcare/patients/${r.contactId}`)}><Eye className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit medical profile" aria-label={`Edit ${r.name}`} onClick={() => router.push(`/healthcare/patients/${r.contactId}?tab=profile`)}><Pencil className="size-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
          <span>{data?.pagination.total ?? 0} patients</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-3.5" /></Button>
            <span className="px-2 tabular-nums">Page {page} of {data?.pagination.totalPages ?? 1}</span>
            <Button variant="outline" size="icon-sm" disabled={page >= (data?.pagination.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-3.5" /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}
