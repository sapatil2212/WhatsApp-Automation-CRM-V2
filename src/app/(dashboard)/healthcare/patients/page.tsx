'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Activity, AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Download, Eye, Loader2, Pencil, Search, Trash2, UserPlus, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
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
const GENDER: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other', prefer_not_to_say: '' };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const AVATARS = ['bg-sky-500/15', 'bg-emerald-500/15', 'bg-violet-500/15', 'bg-amber-500/15', 'bg-rose-500/15', 'bg-teal-500/15'];
const avatarColor = (id: string) => AVATARS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];
const fmtPhone = (p?: string | null) => {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
};
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Row[] | null>(null);

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
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.contactId));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) rows.forEach((r) => n.delete(r.contactId));
      else rows.forEach((r) => n.add(r.contactId));
      return n;
    });
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Deletes the patients' clinical records (appointments, consultations, prescriptions, EHR, documents). */
  const deletePatients = async (list: Row[]) => {
    const res = await api<{ deleted: string[]; blocked: Array<{ id: string; reason: string }> }>('/api/healthcare/patients/bulk-delete', { method: 'POST', json: { ids: list.map((r) => r.contactId) } });
    const { deleted, blocked } = res.data;
    if (deleted.length) toast.success(`${deleted.length} patient record${deleted.length === 1 ? '' : 's'} deleted.`);
    if (blocked.length) toast.error(`${blocked.length} could not be deleted: ${blocked[0].reason}`);
    setSelected(new Set());
    await load();
  };

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
            <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{s.value === undefined ? '—' : s.value.toLocaleString()}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border/70 bg-card p-1" role="tablist">
          {[{ id: '', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' }].map((t) => (
            <button key={t.id || 'all'} role="tab" aria-selected={status === t.id} onClick={() => resetPage(setStatus)(t.id)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${status === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>{t.label}</button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, phone or patient ID…" className="h-8 pl-8 pr-8 text-[13px] md:text-[13px]" aria-label="Search patients" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-3.5" /></button>}
        </div>
        <select aria-label="Blood group" className={selectCls} value={blood} onChange={(e) => resetPage(setBlood)(e.target.value)}>
          <option value="">Any blood group</option>
          {BLOOD.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[13px]">
          <input type="checkbox" className="size-4 rx-check" checked={allergies} onChange={(e) => resetPage(setAllergies)(e.target.checked)} /> Allergies
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Registered</span>
          <Input type="date" aria-label="Registered from" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} className="h-8 w-[132px] text-[13px] md:text-[13px]" />
          <span className="text-[11px] text-muted-foreground">to</span>
          <Input type="date" aria-label="Registered to" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} className="h-8 w-[132px] text-[13px] md:text-[13px]" />
        </div>
        {filters && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setSearch(''); setStatus(''); setBlood(''); setAllergies(false); setFrom(''); setTo(''); setPage(1); }}>
            Clear filters
          </Button>
        )}
        <p className="ml-auto text-[11px] text-muted-foreground">{(data?.pagination.total ?? 0).toLocaleString()} {filters ? 'matching' : 'patients'}</p>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[13px]" role="status">
          <span className="font-medium">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleting(rows.filter((r) => selected.has(r.contactId)))}><Trash2 className="size-3.5" /> Delete selected</Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] table-fixed text-[13px]">
            <colgroup>
              <col className="w-10" />
              <col className="w-[26%]" />
              <col className="w-[11%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[15%]" />
              <col className="w-[10%]" />
              <col className="w-[112px]" />
            </colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-2 pl-4"><input type="checkbox" className="size-4 rx-check" aria-label="Select all patients on this page" checked={allSelected} onChange={toggleAll} disabled={rows.length === 0} /></th>
                <th className="px-4 py-2">Patient</th>
                <th className="px-3 py-2">Patient ID</th>
                <th className="px-3 py-2">Blood</th>
                <th className="px-3 py-2">Last visit</th>
                <th className="px-3 py-2">Visits</th>
                <th className="px-3 py-2">Doctor</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && rows.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={9} className="px-4 py-3"><div className="h-9 animate-pulse rounded-lg bg-muted/70" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <Users className="mx-auto size-9 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">{filters ? 'No patients match these filters' : 'No patients yet'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{filters ? 'Try a different search or filter.' : 'Patients appear here once they book an appointment.'}</p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.contactId} onClick={() => router.push(`/healthcare/patients/${r.contactId}`)} className={`group cursor-pointer transition-colors hover:bg-muted/50 ${selected.has(r.contactId) ? 'bg-primary/5' : ''} ${loading ? 'opacity-60' : ''}`}>
                    <td className="py-2 pl-4" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="size-4 rx-check" aria-label={`Select ${r.name}`} checked={selected.has(r.contactId)} onChange={() => toggleOne(r.contactId)} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-foreground ${avatarColor(r.contactId)}`}>{initials(r.name)}</span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium">
                            <span className="truncate">{r.name}</span>
                            {r.hasAllergies && <span title="Allergies recorded" className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-500/10 px-1.5 py-px text-[10px] font-medium text-rose-700 dark:text-rose-400"><AlertTriangle className="size-3" /> Allergies</span>}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {[r.age && `${r.age} yrs`, r.gender && GENDER[r.gender]].filter(Boolean).join(' · ')}
                            {(r.age || (r.gender && GENDER[r.gender])) && r.phone ? ' · ' : ''}
                            <span className="font-mono tabular-nums">{fmtPhone(r.phone)}</span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.code ?? <span className="text-muted-foreground">new</span>}</td>
                    <td className="px-3 py-2">{r.bloodGroup ? <span className="rounded bg-rose-500/10 px-1.5 py-px text-[11px] font-semibold text-rose-700 dark:text-rose-300">{r.bloodGroup}</span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmt(r.lastConsultation)}</td>
                    <td className="px-3 py-2 tabular-nums">{r.totalConsultations}</td>
                    <td className="px-3 py-2"><p className="truncate">{r.doctor ?? '—'}</p></td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${r.status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                        <span className="size-1.5 rounded-full bg-current" />{r.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Open health record" aria-label={`Open ${r.name}`} onClick={() => router.push(`/healthcare/patients/${r.contactId}`)}><Eye className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit medical profile" aria-label={`Edit ${r.name}`} onClick={() => router.push(`/healthcare/patients/${r.contactId}?tab=profile`)}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete ${r.name}`} onClick={() => setDeleting([r])}><Trash2 className="size-3.5" /></Button>
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
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-3.5" /></Button>
            <span className="px-2 tabular-nums">Page {page} of {data?.pagination.totalPages ?? 1}</span>
            <Button variant="outline" size="icon-sm" disabled={page >= (data?.pagination.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-3.5" /></Button>
          </div>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} patient records?` : 'Delete this patient record?'}
        description="Everything the clinic recorded for the patient is permanently deleted."
        details={
          deleting ? (
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {deleting.slice(0, 5).map((r) => (
                <li key={r.contactId} className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r.code ?? fmtPhone(r.phone)}</span>
                </li>
              ))}
              {deleting.length > 5 && <li className="text-[11px] text-muted-foreground">and {deleting.length - 5} more</li>}
            </ul>
          ) : null
        }
        notes={[
          'Appointments, consultations, prescriptions, medical profile, documents, intake forms and feedback are deleted.',
          'The WhatsApp contact and chat history stay in the Inbox.',
          'This cannot be undone.',
        ]}
        confirmText={deleting && deleting.length > 1 ? `Delete ${deleting.length}` : 'Delete'}
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deletePatients(deleting);
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