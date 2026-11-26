'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, CalendarOff, Eye, Languages, Mail, Pencil, Phone, Plus, Search, Trash2, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { describeDay, WEEKDAYS } from '@/lib/healthcare/schedule';
import { cn } from '@/lib/utils';
import { DoctorFormModal } from './doctor-form-modal';
import { api, type Department, type DirectoryDoctor } from './api';

const money = (n: number) => (n > 0 ? `₹${n.toLocaleString('en-IN')}` : 'Free');

function Avatar({ d, size = 'md' }: { d: DirectoryDoctor; size?: 'md' | 'lg' }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary', size === 'lg' ? 'size-14' : 'size-10')}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {d.photoUrl ? <img src={d.photoUrl} alt="" className="size-full object-cover" /> : <UserRound className={size === 'lg' ? 'size-6' : 'size-5'} />}
    </span>
  );
}

function DayDots({ d }: { d: DirectoryDoctor }) {
  return (
    <div className="flex gap-0.5" aria-label="Working days">
      {WEEKDAYS.map((w) => {
        const on = !!d.schedule.days[w]?.enabled;
        return (
          <span key={w} title={on ? `${w}: ${describeDay(d.schedule.days[w])}` : `${w}: off`} className={cn('flex size-5 items-center justify-center rounded text-[9px] font-semibold', on ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground/60')}>
            {w.charAt(0)}
          </span>
        );
      })}
    </div>
  );
}

/** Clinic setup → Doctors: directory with per-doctor weekly schedules. */
export function DoctorsDirectory({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [doctors, setDoctors] = useState<DirectoryDoctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [modal, setModal] = useState<{ open: boolean; doctor: DirectoryDoctor | null }>({ open: false, doctor: null });
  const [viewing, setViewing] = useState<DirectoryDoctor | null>(null);
  const [toDelete, setToDelete] = useState<DirectoryDoctor | null>(null);

  const load = useCallback(async () => {
    try {
      const [docs, deps] = await Promise.all([api<DirectoryDoctor[]>('/api/healthcare/doctors'), api<Department[]>('/api/healthcare/departments')]);
      setDoctors(docs);
      setDepartments(deps);
      onCountChange?.(docs.length);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (d: DirectoryDoctor) => {
    try {
      await api(`/api/healthcare/doctors/${d.id}`, { method: 'DELETE' });
      toast.success(`${d.name} removed.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };

  const term = q.trim().toLowerCase();
  const shown = doctors.filter(
    (d) =>
      (!dept || (dept === '_none' ? d.departments.length === 0 : d.departments.some((x) => x.id === dept))) &&
      (!term || [d.name, d.specialization, d.qualification, ...d.departments.map((x) => x.name)].some((v) => v?.toLowerCase().includes(term))),
  );
  const unassigned = doctors.filter((d) => d.departments.length === 0).length;
  const edit = (d: DirectoryDoctor) => setModal({ open: true, doctor: d });

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, specialization or department" className="h-8 pl-8 text-[13px] md:text-[13px]" aria-label="Search doctors" />
        </div>
        {departments.length > 0 && (
          <select aria-label="Filter by department" value={dept} onChange={(e) => setDept(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-[13px] text-foreground">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            {unassigned > 0 && <option value="_none">No department ({unassigned})</option>}
          </select>
        )}
        <Button size="sm" className="gap-1.5" onClick={() => setModal({ open: true, doctor: null })}>
          <Plus className="size-3.5" /> Add doctor
        </Button>
      </div>

      {unassigned > 0 && departments.length > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
          {unassigned} doctor{unassigned === 1 ? ' is' : 's are'} not in any department. {departments.some((d) => d.isActive && d.doctorCount > 0) ? 'They are not shown on the booking page.' : 'Until a doctor is assigned, the booking page lists all doctors without a department step.'} Edit a doctor to assign one.
        </p>
      )}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-muted/60" />)}</div>
      ) : doctors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <UserRound className="mx-auto mb-2 size-8 text-muted-foreground/50" />
          <p className="text-[13px] font-medium">No doctors yet</p>
          <p className="mx-auto mt-0.5 max-w-sm text-xs text-muted-foreground">Add each doctor with their departments and weekly availability. Booking slots are generated from these schedules.</p>
          <Button size="sm" className="mt-3 gap-1.5" onClick={() => setModal({ open: true, doctor: null })}><Plus className="size-3.5" /> Add your first doctor</Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">No doctors match your search.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((d) => (
            <div key={d.id} className="flex flex-col rounded-xl border border-border/70 bg-card p-3 transition-colors hover:border-primary/30">
              <div className="flex items-start gap-2.5">
                <Avatar d={d} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setViewing(d)}>
                  <p className="truncate text-[13px] font-semibold">{d.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{[d.specialization, d.qualification, d.experience].filter(Boolean).join(' · ') || 'No details yet'}</p>
                </button>
                <div className="flex shrink-0 gap-0.5">
                  <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-foreground" title="View" aria-label={`View ${d.name}`} onClick={() => setViewing(d)}><Eye className="size-3.5" /></Button>
                  <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-foreground" title="Edit" aria-label={`Edit ${d.name}`} onClick={() => edit(d)}><Pencil className="size-3.5" /></Button>
                  <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" title="Delete" aria-label={`Delete ${d.name}`} onClick={() => setToDelete(d)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>

              <div className="mb-2.5 mt-2 flex flex-wrap gap-1">
                {d.departments.length
                  ? d.departments.map((x) => <span key={x.id} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{x.name}</span>)
                  : <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">No department</span>}
              </div>

              <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                <DayDots d={d} />
                <div className="text-right">
                  <p className="text-[12px] font-semibold">{money(d.consultationFee)}</p>
                  <p className={cn('text-[10px]', d.scheduleSummary.slotsPerWeek ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400')}>{d.scheduleSummary.slotsPerWeek ? `${d.scheduleSummary.slotsPerWeek} slots/week` : 'Not bookable'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View profile */}
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="sm:max-w-lg">
          {viewing && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <Avatar d={viewing} size="lg" />
                  <div className="min-w-0">
                    <DialogTitle className="truncate">{viewing.name}</DialogTitle>
                    <DialogDescription className="truncate">{[viewing.specialization, viewing.qualification, viewing.experience].filter(Boolean).join(' · ') || 'No details yet'}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="max-h-[60dvh] space-y-3 overflow-y-auto text-[13px]">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border/70 px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Fee</p><p className="font-semibold">{money(viewing.consultationFee)}</p></div>
                  <div className="rounded-lg border border-border/70 px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Per week</p><p className="font-semibold">{viewing.scheduleSummary.workingDays} days · {viewing.scheduleSummary.slotsPerWeek} slots</p></div>
                </div>
                <dl className="space-y-1.5">
                  {viewing.phone && <div className="flex items-center gap-2"><Phone className="size-3.5 text-muted-foreground" /><dd>{viewing.phone}</dd></div>}
                  {viewing.email && <div className="flex items-center gap-2"><Mail className="size-3.5 text-muted-foreground" /><dd className="truncate">{viewing.email}</dd></div>}
                  {viewing.languages && <div className="flex items-center gap-2"><Languages className="size-3.5 text-muted-foreground" /><dd>{viewing.languages}</dd></div>}
                  {viewing.registrationNumber && <div className="flex items-center gap-2 text-muted-foreground"><span className="text-[11px]">Reg. no.</span><dd className="text-foreground">{viewing.registrationNumber}</dd></div>}
                </dl>
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Departments</p>
                  <div className="flex flex-wrap gap-1">
                    {viewing.departments.length ? viewing.departments.map((x) => <span key={x.id} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{x.name}</span>) : <span className="text-[12px] text-amber-600 dark:text-amber-400">Not assigned</span>}
                  </div>
                </div>
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><CalendarClock className="size-3.5" /> Weekly availability</p>
                  <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
                    {WEEKDAYS.map((w) => {
                      const day = viewing.schedule.days[w];
                      return (
                        <li key={w} className="flex gap-3 px-3 py-1.5 text-[12px]">
                          <span className="w-9 shrink-0 font-medium">{w.slice(0, 3)}</span>
                          <span className={day?.enabled ? 'text-muted-foreground' : 'text-muted-foreground/50'}>{day?.enabled ? describeDay(day) : 'Off'}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {viewing.leaves.length > 0 && (
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><CalendarOff className="size-3.5" /> Leave dates</p>
                    <ul className="space-y-0.5 text-[12px]">
                      {viewing.leaves.map((l) => <li key={l.date}><span className="font-medium">{new Date(`${l.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span> <span className="text-muted-foreground">· {l.reason}</span></li>)}
                    </ul>
                  </div>
                )}
                {viewing.bio && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">About</p>
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{viewing.bio}</p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button size="sm" variant="outline" onClick={() => setViewing(null)}>Close</Button>
                <Button size="sm" className="gap-1.5" onClick={() => { const d = viewing; setViewing(null); edit(d); }}><Pencil className="size-3.5" /> Edit</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <DoctorFormModal
        open={modal.open}
        doctor={modal.doctor}
        departments={departments}
        onClose={() => setModal({ open: false, doctor: null })}
        onSaved={() => {
          setModal({ open: false, doctor: null });
          void load();
        }}
      />
      <ConfirmationDialog
        isOpen={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Remove doctor?"
        description="Their profile and schedule are removed from the clinic."
        details={toDelete ? <span><span className="font-medium">{toDelete.name}</span>{toDelete.specialization ? ` · ${toDelete.specialization}` : ''}</span> : undefined}
        notes={["Doctors with upcoming appointments can't be removed until those are rescheduled or cancelled."]}
        confirmText="Remove"
        variant="destructive"
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />
    </div>
  );
}
