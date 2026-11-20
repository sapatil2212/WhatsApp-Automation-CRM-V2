'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { describeDay, WEEKDAYS } from '@/lib/healthcare/schedule';
import { DoctorFormModal } from './doctor-form-modal';
import { api, type Department, type DirectoryDoctor } from './api';

/** Step 3 of clinic setup: the doctors directory with per-doctor weekly schedules. */
export function DoctorsDirectory({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [doctors, setDoctors] = useState<DirectoryDoctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [modal, setModal] = useState<{ open: boolean; doctor: DirectoryDoctor | null }>({ open: false, doctor: null });
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
      (!dept || d.departments.some((x) => x.id === dept)) &&
      (!term || [d.name, d.specialization, d.qualification, ...d.departments.map((x) => x.name)].some((v) => v?.toLowerCase().includes(term))),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctors by name, specialization or department" className="pl-8" />
        </div>
        {departments.length > 0 && (
          <select aria-label="Filter by department" value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <Button onClick={() => setModal({ open: true, doctor: null })} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Add Doctor
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted/60" />)}
        </div>
      ) : doctors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <UserRound className="mx-auto mb-2 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">No doctors yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Add each doctor with their departments and weekly availability. Booking slots are generated from these schedules.</p>
          <Button className="mt-4" onClick={() => setModal({ open: true, doctor: null })}><Plus className="h-4 w-4" /> Add your first doctor</Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No doctors match your search.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((d) => (
            <div key={d.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {d.photoUrl ? <img src={d.photoUrl} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-6 w-6" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{d.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{[d.qualification, d.specialization, d.experience].filter(Boolean).join(' · ') || 'No details yet'}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {d.departments.length ? d.departments.map((x) => <span key={x.id} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{x.name}</span>) : <span className="text-[11px] text-amber-600">No department</span>}
                  </div>
                </div>
                <div className="flex shrink-0">
                  <Button size="icon" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => setModal({ open: true, doctor: d })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${d.name}`} className="text-destructive hover:text-destructive" onClick={() => setToDelete(d)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-muted/40 p-2.5">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 font-medium text-foreground"><CalendarClock className="h-3.5 w-3.5 text-primary" /> {d.scheduleSummary.workingDays} days · {d.scheduleSummary.slotsPerWeek} slots/week</span>
                  <span className="text-muted-foreground">₹{d.consultationFee}</span>
                </div>
                <ul className="space-y-0.5">
                  {WEEKDAYS.filter((w) => d.schedule.days[w]?.enabled).map((w) => (
                    <li key={w} className="flex gap-2 text-[11px] text-muted-foreground"><span className="w-8 shrink-0 font-medium text-foreground/80">{w.slice(0, 3)}</span><span className="truncate">{describeDay(d.schedule.days[w])}</span></li>
                  ))}
                  {d.scheduleSummary.workingDays === 0 && <li className="text-[11px] text-amber-600">No working days — patients cannot book this doctor.</li>}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

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
        description={toDelete ? `${toDelete.name} and their schedule will be removed. Doctors with upcoming appointments can't be removed until those are rescheduled or cancelled.` : ''}
        confirmText="Remove"
        variant="destructive"
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />
    </div>
  );
}
