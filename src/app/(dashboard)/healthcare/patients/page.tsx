'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, Search, UserPlus, Users, X } from 'lucide-react';

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
}
interface Data {
  items: Row[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  stats: { total: number; newThisMonth: number; withAllergies: number };
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function PatientsPage() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (debounced) q.set('search', debounced);
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      setData((await api<Data>(`/api/healthcare/patients?${q}`)).data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, debounced, from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.items ?? [];
  const filters = Boolean(debounced || from || to);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ClipboardList className="size-6 text-primary" /> Patients</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Medical records, consultation history, prescriptions and documents for every patient.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Patients', value: data?.stats.total, icon: Users },
          { label: 'New this month', value: data?.stats.newThisMonth, icon: UserPlus },
          { label: 'With recorded allergies', value: data?.stats.withAllergies, icon: AlertTriangle },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <div className="flex items-center justify-between"><p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p><s.icon className="size-4 text-primary" /></div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{s.value ?? '—'}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, phone or patient ID…" className="h-9 pl-8" aria-label="Search patients" />
        </div>
        <span className="text-xs text-muted-foreground">Registered</span>
        <Input type="date" aria-label="Registered from" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-9 w-[140px]" />
        <Input type="date" aria-label="Registered to" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-9 w-[140px]" />
        {filters && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFrom(''); setTo(''); }}><X className="size-3.5" /> Clear</Button>}
        <p className="ml-auto text-xs text-muted-foreground">{data?.pagination.total ?? 0} patients</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed text-sm">
            <colgroup><col className="w-[10%]" /><col className="w-[22%]" /><col className="w-[10%]" /><col className="w-[13%]" /><col className="w-[7%]" /><col className="w-[12%]" /><col className="w-[8%]" /><col className="w-[11%]" /><col className="w-[7%]" /></colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-3">Patient ID</th><th className="px-3 py-3">Patient</th><th className="px-3 py-3">Age / Gender</th><th className="px-3 py-3">Phone</th><th className="px-3 py-3">Blood</th><th className="px-3 py-3">Last consultation</th><th className="px-3 py-3">Visits</th><th className="px-3 py-3">Doctor</th><th className="px-3 py-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && rows.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={9} className="px-4 py-3"><div className="h-9 animate-pulse rounded-lg bg-muted/70" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center"><Users className="mx-auto size-9 text-muted-foreground/60" /><p className="mt-3 text-sm font-medium">{filters ? 'No patients match' : 'No patients yet'}</p><p className="mt-1 text-xs text-muted-foreground">Patients appear here once they book an appointment.</p></td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.contactId} onClick={() => router.push(`/healthcare/patients/${r.contactId}`)} className={`cursor-pointer transition-colors hover:bg-muted/50 ${loading ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-mono text-xs">{r.code ?? <span className="text-muted-foreground">new</span>}</td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(r.name)}</span>
                        <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span>{r.hasAllergies && <span className="flex items-center gap-1 text-[11px] text-rose-600"><AlertTriangle className="size-3" /> Allergies</span>}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">{[r.age && `${r.age} yrs`, r.gender?.replace(/_/g, ' ')].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-3 font-mono text-xs">{r.phone ? `+${r.phone}` : '—'}</td>
                    <td className="px-3 py-3 text-xs">{r.bloodGroup ?? '—'}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{fmt(r.lastConsultation)}</td>
                    <td className="px-3 py-3 text-xs tabular-nums">{r.totalConsultations}</td>
                    <td className="truncate px-3 py-3 text-xs">{r.doctor ?? '—'}</td>
                    <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] ${r.status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{r.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-1 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground">
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
          <span className="px-2">Page {page} of {data?.pagination.totalPages ?? 1}</span>
          <Button variant="outline" size="icon-sm" disabled={page >= (data?.pagination.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
        </div>
      </div>
    </div>
  );
}
