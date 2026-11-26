'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, CalendarOff, Camera, Check, ChevronLeft, ChevronRight, Loader2, Plus, Save, Trash2, UserRound, Wallet, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { defaultSchedule, describeDay, summarize, validateSchedule, WEEKDAYS, type WeeklySchedule } from '@/lib/healthcare/schedule';
import { cn } from '@/lib/utils';
import { ScheduleEditor } from './schedule-editor';
import { api, type Department, type DirectoryDoctor } from './api';

interface FormState {
  name: string;
  photoUrl: string;
  qualification: string;
  specialization: string;
  experience: string;
  phone: string;
  email: string;
  registrationNumber: string;
  languages: string;
  consultationFee: string;
  bio: string;
  departmentIds: string[];
  schedule: WeeklySchedule;
  leaves: Array<{ date: string; reason: string }>;
}

function initial(d?: DirectoryDoctor | null): FormState {
  return {
    name: d?.name ?? '',
    photoUrl: d?.photoUrl ?? '',
    qualification: d?.qualification ?? '',
    specialization: d?.specialization ?? '',
    experience: d?.experience ?? '',
    phone: d?.phone ?? '',
    email: d?.email ?? '',
    registrationNumber: d?.registrationNumber ?? '',
    languages: d?.languages ?? 'English',
    consultationFee: d ? String(d.consultationFee ?? 0) : '',
    bio: d?.bio ?? '',
    departmentIds: d?.departments.map((x) => x.id) ?? [],
    schedule: d?.schedule ?? defaultSchedule(),
    leaves: d?.leaves ?? [],
  };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fieldCls = 'h-8 text-[13px] md:text-[13px]';
const labelCls = 'text-[11px] font-medium text-muted-foreground';

const STEPS = [
  { id: 'profile', title: 'Profile', sub: 'Name & specialty', icon: UserRound },
  { id: 'practice', title: 'Contact & fees', sub: 'Departments, fee', icon: Wallet },
  { id: 'schedule', title: 'Availability', sub: 'Weekly sessions', icon: CalendarClock },
  { id: 'leaves', title: 'Leave & review', sub: 'Days off, summary', icon: CalendarOff },
] as const;
type StepId = (typeof STEPS)[number]['id'];

export function DoctorFormModal({
  open,
  doctor,
  departments,
  onClose,
  onSaved,
}: {
  open: boolean;
  doctor: DirectoryDoctor | null;
  departments: Department[];
  onClose: () => void;
  onSaved: (d: DirectoryDoctor) => void;
}) {
  const [form, setForm] = useState<FormState>(() => initial(doctor));
  const [step, setStep] = useState(0);
  const [leaveDraft, setLeaveDraft] = useState({ date: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setForm(initial(doctor));
      setStep(0);
      setErrors({});
      setLeaveDraft({ date: '', reason: '' });
    }
  }, [open, doctor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, saving, onClose]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  if (!open) return null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: '' }));
  };

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast.error('Choose an image file.');
    if (file.size > 5 * 1024 * 1024) return toast.error('Photo must be under 5 MB.');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/avatar/upload', { method: 'POST', body: fd, credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || 'Upload failed');
      set('photoUrl', body.url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  /** Errors for one step; empty object when it is fine. */
  const checkStep = (i: number): Record<string, string> => {
    const e: Record<string, string> = {};
    const id: StepId = STEPS[i].id;
    if (id === 'profile' && form.name.trim().length < 2) e.name = "Enter the doctor's full name.";
    if (id === 'practice') {
      if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email address.';
      if (form.phone.trim() && form.phone.replace(/\D/g, '').length < 7) e.phone = 'Enter a valid phone number.';
      const fee = form.consultationFee.trim() === '' ? 0 : Number(form.consultationFee);
      if (!Number.isFinite(fee) || fee < 0) e.consultationFee = 'Fee must be zero or more.';
    }
    if (id === 'schedule') {
      const issues = validateSchedule(form.schedule);
      if (issues.length) e._schedule = `${issues[0].day}: ${issues[0].message}`;
      else if (summarize(form.schedule).slotsPerWeek === 0) e._schedule = 'Turn on at least one working day with an active session, so patients can book.';
    }
    return e;
  };

  /** Moves to `target`; going forward validates each step on the way. */
  const goTo = (target: number) => {
    for (let i = step; i < target; i++) {
      const e = checkStep(i);
      if (Object.keys(e).length) {
        setErrors(e);
        setStep(i);
        if (e._schedule) toast.error(e._schedule);
        return;
      }
    }
    setErrors({});
    setStep(target);
  };

  const save = async () => {
    for (let i = 0; i < STEPS.length; i++) {
      const e = checkStep(i);
      if (Object.keys(e).length) {
        setErrors(e);
        setStep(i);
        if (e._schedule) toast.error(e._schedule);
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        photoUrl: form.photoUrl.trim(),
        qualification: form.qualification.trim() || null,
        specialization: form.specialization.trim() || null,
        experience: form.experience.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim(),
        registrationNumber: form.registrationNumber.trim() || null,
        languages: form.languages.trim() || null,
        consultationFee: form.consultationFee.trim() === '' ? 0 : Number(form.consultationFee),
        bio: form.bio.trim() || null,
        departmentIds: form.departmentIds,
        schedule: form.schedule,
        leaves: form.leaves,
      };
      const saved = doctor
        ? await api<DirectoryDoctor>(`/api/healthcare/doctors/${doctor.id}`, { method: 'PATCH', json: payload })
        : await api<DirectoryDoctor>('/api/healthcare/doctors', { method: 'POST', json: payload });
      toast.success(doctor ? 'Doctor updated.' : 'Doctor added.');
      onSaved(saved);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleDept = (id: string) => set('departmentIds', form.departmentIds.includes(id) ? form.departmentIds.filter((x) => x !== id) : [...form.departmentIds, id]);
  const activeDepts = departments.filter((d) => d.isActive || form.departmentIds.includes(d.id));
  const sum = summarize(form.schedule);
  const last = step === STEPS.length - 1;
  const current = STEPS[step].id;

  const field = (k: keyof FormState, label: string, props: React.ComponentProps<typeof Input> = {}, className?: string) => (
    <label className={cn('block min-w-0 space-y-1', className)} htmlFor={`doc-${k}`}>
      <span className={labelCls}>{label}</span>
      <Input id={`doc-${k}`} value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} className={fieldCls} {...props} />
      {errors[k] && <span className="block text-[11px] text-destructive">{errors[k]}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="doctor-modal-title" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="flex max-h-[95dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 id="doctor-modal-title" className="truncate text-base font-semibold">{doctor ? `Edit ${doctor.name}` : 'Add doctor'}</h2>
            <p className="text-[11px] text-muted-foreground">{sum.workingDays} working day{sum.workingDays === 1 ? '' : 's'} · {sum.slotsPerWeek} slots per week</p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close" disabled={saving} onClick={onClose}><X className="size-4" /></Button>
        </div>

        {/* Steps */}
        <ol className="grid shrink-0 grid-cols-4 gap-1.5 border-b border-border px-5 py-2.5" aria-label="Steps">
          {STEPS.map((s, i) => {
            const done = i < step;
            const on = i === step;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  disabled={saving}
                  aria-current={on ? 'step' : undefined}
                  className={cn('flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors', on ? 'border-primary/50 bg-primary/5' : 'border-transparent hover:bg-muted/60')}
                >
                  <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                    {done ? <Check className="size-3.5" /> : <s.icon className="size-3.5" />}
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <span className={cn('block truncate text-[12px] font-medium', !on && 'text-muted-foreground')}>{s.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{s.sub}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Body */}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {current === 'profile' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3">
                <button type="button" onClick={() => fileRef.current?.click()} className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground hover:border-primary" aria-label="Upload profile photo">
                  {form.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.photoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <UserRound className="size-6" />
                  )}
                  <span className="absolute inset-x-0 bottom-0 flex justify-center bg-black/50 py-0.5 text-white">{uploading ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}</span>
                </button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">Profile photo</p>
                  <p className="text-[11px] text-muted-foreground">JPG or PNG, up to 5 MB. Shown on the booking page.</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>{form.photoUrl ? 'Replace' : 'Upload'}</Button>
                  {form.photoUrl && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => set('photoUrl', '')}>Remove</Button>}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {field('name', 'Full name *', { placeholder: 'Dr. Priya Sharma', maxLength: 120, autoFocus: true }, 'sm:col-span-2')}
                {field('specialization', 'Specialization', { placeholder: 'Pediatrician', maxLength: 120 })}
                {field('qualification', 'Qualifications', { placeholder: 'MBBS, MD (Pediatrics)', maxLength: 200 })}
                {field('experience', 'Experience', { placeholder: '8 years', maxLength: 60 })}
                {field('languages', 'Languages spoken', { placeholder: 'English, Hindi, Marathi', maxLength: 200 })}
              </div>
            </div>
          )}

          {current === 'practice' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {field('phone', 'Contact number', { placeholder: '+91 98765 43210', inputMode: 'tel', maxLength: 32 })}
                {field('email', 'Email', { placeholder: 'doctor@clinic.com', type: 'email', maxLength: 191 })}
                {field('consultationFee', 'Consultation fee (₹)', { placeholder: '500', inputMode: 'decimal', type: 'number', min: 0 })}
                {field('registrationNumber', 'Registration no. (optional)', { placeholder: 'Medical council number', maxLength: 80 })}
              </div>

              <div className="space-y-1.5">
                <span className={labelCls}>Departments</span>
                {activeDepts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground">No departments yet. Add them in the Departments step so patients can find this doctor by department.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {activeDepts.map((d) => {
                        const on = form.departmentIds.includes(d.id);
                        return (
                          <button key={d.id} type="button" aria-pressed={on} onClick={() => toggleDept(d.id)} className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/50')}>
                            {on && <Check className="size-3" />} {d.name}
                          </button>
                        );
                      })}
                    </div>
                    {form.departmentIds.length === 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">Not in any department yet. Choose one so patients can find this doctor when booking.</p>}
                  </>
                )}
              </div>

              <label className="block space-y-1" htmlFor="doc-bio">
                <span className={labelCls}>About the doctor <span className="font-normal">(optional)</span></span>
                <Textarea id="doc-bio" rows={3} maxLength={2000} value={form.bio} placeholder="Areas of interest, awards, notes for patients…" onChange={(e) => set('bio', e.target.value)} className="min-h-0 text-[13px] md:text-[13px]" />
              </label>
            </div>
          )}

          {current === 'schedule' && (
            <div className="space-y-2">
              {errors._schedule && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{errors._schedule}</p>}
              <ScheduleEditor value={form.schedule} onChange={(s) => { set('schedule', s); if (errors._schedule) setErrors({}); }} />
            </div>
          )}

          {current === 'leaves' && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-3">
                <div>
                  <p className="text-[13px] font-semibold">Leave dates</p>
                  <p className="text-[11px] text-muted-foreground">No slots are offered on these days, and patients already booked are notified.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-end">
                  <label className="block space-y-1">
                    <span className={labelCls}>Date</span>
                    <Input type="date" min={todayStr()} value={leaveDraft.date} className={fieldCls} onChange={(e) => setLeaveDraft((x) => ({ ...x, date: e.target.value }))} />
                  </label>
                  <label className="block space-y-1">
                    <span className={labelCls}>Reason</span>
                    <Input value={leaveDraft.reason} maxLength={200} placeholder="Conference, personal leave…" className={fieldCls} onChange={(e) => setLeaveDraft((x) => ({ ...x, reason: e.target.value }))} />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1"
                    disabled={!leaveDraft.date}
                    onClick={() => {
                      if (form.leaves.some((l) => l.date === leaveDraft.date)) return toast.error('That date is already on the list.');
                      set('leaves', [...form.leaves, { date: leaveDraft.date, reason: leaveDraft.reason.trim() || 'On leave' }].sort((a, b) => a.date.localeCompare(b.date)));
                      setLeaveDraft({ date: '', reason: '' });
                    }}
                  >
                    <Plus className="size-3.5" /> Add
                  </Button>
                </div>
                {form.leaves.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">No leave dates. You can add them any time.</p>
                ) : (
                  <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
                    {form.leaves.map((l) => (
                      <li key={l.date} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[13px]">
                        <span className="min-w-0 truncate"><span className="font-medium">{new Date(`${l.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span> <span className="text-muted-foreground">· {l.reason}</span></span>
                        <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label="Remove leave date" onClick={() => set('leaves', form.leaves.filter((x) => x.date !== l.date))}><Trash2 className="size-3.5" /></Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Review */}
              <aside className="rounded-lg border border-border/70 bg-muted/30 p-3 text-[12px]">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Review</p>
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {form.photoUrl ? <img src={form.photoUrl} alt="" className="size-full object-cover" /> : <UserRound className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{form.name || 'Unnamed doctor'}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{[form.specialization, form.qualification].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-y-1">
                  <dt className="text-muted-foreground">Fee</dt><dd>₹{form.consultationFee || 0}</dd>
                  <dt className="text-muted-foreground">Departments</dt><dd className="truncate">{departments.filter((d) => form.departmentIds.includes(d.id)).map((d) => d.name).join(', ') || <span className="text-amber-600 dark:text-amber-400">None</span>}</dd>
                  <dt className="text-muted-foreground">Week</dt><dd>{sum.workingDays} days · {sum.slotsPerWeek} slots</dd>
                  <dt className="text-muted-foreground">Leaves</dt><dd>{form.leaves.length || 'None'}</dd>
                </dl>
                <ul className="mt-2 space-y-0.5 border-t border-border/70 pt-2">
                  {WEEKDAYS.filter((w) => form.schedule.days[w]?.enabled).map((w) => (
                    <li key={w} className="flex gap-2 text-[11px] text-muted-foreground"><span className="w-8 shrink-0 font-medium text-foreground/80">{w.slice(0, 3)}</span><span className="truncate">{describeDay(form.schedule.days[w])}</span></li>
                  ))}
                  {sum.workingDays === 0 && <li className="text-[11px] text-amber-600 dark:text-amber-400">No working days set.</li>}
                </ul>
              </aside>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/30 px-5 py-2.5">
          <Button size="sm" variant="outline" className="gap-1" disabled={saving} onClick={step === 0 ? onClose : () => goTo(step - 1)}>
            {step === 0 ? 'Cancel' : <><ChevronLeft className="size-3.5" /> Back</>}
          </Button>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground sm:inline">Step {step + 1} of {STEPS.length}</span>
            {doctor && !last && <Button size="sm" variant="ghost" disabled={saving || uploading} onClick={save}>Save now</Button>}
            {last ? (
              <Button size="sm" className="gap-1.5" disabled={saving || uploading} onClick={save}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {doctor ? 'Save changes' : 'Add doctor'}
              </Button>
            ) : (
              <Button size="sm" className="gap-1" disabled={saving} onClick={() => goTo(step + 1)}>Next <ChevronRight className="size-3.5" /></Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
