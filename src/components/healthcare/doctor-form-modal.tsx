'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, CalendarOff, Camera, Loader2, Plus, Save, Trash2, UserRound, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { defaultSchedule, summarize, validateSchedule, type WeeklySchedule } from '@/lib/healthcare/schedule';
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
  const [tab, setTab] = useState<'details' | 'schedule' | 'leaves'>('details')
  const [leaveDraft, setLeaveDraft] = useState({ date: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(initial(doctor));
      setTab('details');
      setErrors({});
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

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Enter the doctor's full name.";
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email address.';
    if (form.phone.trim() && form.phone.replace(/\D/g, '').length < 7) e.phone = 'Enter a valid phone number.';
    const fee = form.consultationFee.trim() === '' ? 0 : Number(form.consultationFee);
    if (!Number.isFinite(fee) || fee < 0) e.consultationFee = 'Fee must be zero or more.';
    setErrors(e);
    if (Object.keys(e).length) {
      setTab('details');
      return false;
    }
    const issues = validateSchedule(form.schedule);
    if (issues.length) {
      setTab('schedule');
      toast.error(`${issues[0].day}: ${issues[0].message}`);
      return false;
    }
    if (summarize(form.schedule).slotsPerWeek === 0) {
      setTab('schedule');
      toast.error('Turn on at least one working day with an active session, so patients can book.');
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
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

  const field = (k: keyof FormState, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`doc-${k}`}>{label}</Label>
      <Input id={`doc-${k}`} value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} {...props} />
      {errors[k] && <p className="text-xs text-destructive">{errors[k]}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="doctor-modal-title" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="flex max-h-[95dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="doctor-modal-title" className="text-lg font-semibold text-foreground">{doctor ? `Edit ${doctor.name}` : 'Add Doctor'}</h2>
            <p className="text-xs text-muted-foreground">{sum.workingDays} working days · {sum.slotsPerWeek} slots per week</p>
          </div>
          <Button size="icon" variant="ghost" aria-label="Close" disabled={saving} onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex gap-1 border-b border-border px-5">
          {([['details', 'Doctor details', UserRound], ['schedule', 'Weekly availability', CalendarClock], ['leaves', `Leave dates${form.leaves.length ? ` (${form.leaves.length})` : ''}`, CalendarOff]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${tab === id ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'details' ? (
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => fileRef.current?.click()} className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground hover:border-primary" aria-label="Upload profile photo">
                  {form.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <UserRound className="h-8 w-8" />
                  )}
                  <span className="absolute bottom-0 inset-x-0 flex justify-center bg-black/50 py-0.5 text-white">{uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}</span>
                </button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Profile photo</p>
                  <p>JPG or PNG, up to 5 MB. Shown on the booking page.</p>
                  {form.photoUrl && <button type="button" className="text-destructive hover:underline" onClick={() => set('photoUrl', '')}>Remove photo</button>}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {field('name', 'Full name *', { placeholder: 'Dr. Priya Sharma', maxLength: 120 })}
                {field('qualification', 'Qualifications', { placeholder: 'MBBS, MD (Pediatrics)', maxLength: 200 })}
                {field('specialization', 'Specialization', { placeholder: 'Pediatrician', maxLength: 120 })}
                {field('experience', 'Experience', { placeholder: '8 years', maxLength: 60 })}
                {field('phone', 'Contact number', { placeholder: '+91 98765 43210', inputMode: 'tel', maxLength: 32 })}
                {field('email', 'Email', { placeholder: 'doctor@clinic.com', type: 'email', maxLength: 191 })}
                {field('consultationFee', 'Consultation fee (₹)', { placeholder: '500', inputMode: 'decimal', type: 'number', min: 0 })}
                {field('languages', 'Languages spoken', { placeholder: 'English, Hindi, Marathi', maxLength: 200 })}
                {field('registrationNumber', 'Registration no. (optional)', { placeholder: 'MCI / state council number', maxLength: 80 })}
              </div>

              <div className="space-y-2">
                <Label>Departments</Label>
                {activeDepts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No departments yet — add them in the Departments step so patients can find this doctor by department.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {activeDepts.map((d) => {
                      const on = form.departmentIds.includes(d.id);
                      return (
                        <button key={d.id} type="button" aria-pressed={on} onClick={() => toggleDept(d.id)} className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}>
                          {d.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc-bio">Other information</Label>
                <Textarea id="doc-bio" rows={3} maxLength={2000} value={form.bio} placeholder="Areas of interest, awards, special notes for patients…" onChange={(e) => set('bio', e.target.value)} />
              </div>
            </div>
          ) : tab === 'schedule' ? (
            <ScheduleEditor value={form.schedule} onChange={(s) => set('schedule', s)} />
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Dates the doctor is unavailable. No slots are offered on these days, and patients already booked are notified.</p>
              <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="leave-date">Date</Label>
                  <Input id="leave-date" type="date" min={todayStr()} value={leaveDraft.date} onChange={(e) => setLeaveDraft((x) => ({ ...x, date: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="leave-reason">Reason</Label>
                  <Input id="leave-reason" value={leaveDraft.reason} maxLength={200} placeholder="Conference, personal leave…" onChange={(e) => setLeaveDraft((x) => ({ ...x, reason: e.target.value }))} />
                </div>
                <Button
                  variant="outline"
                  disabled={!leaveDraft.date}
                  onClick={() => {
                    if (form.leaves.some((l) => l.date === leaveDraft.date)) return toast.error('That date is already on the list.');
                    set('leaves', [...form.leaves, { date: leaveDraft.date, reason: leaveDraft.reason.trim() || 'On leave' }].sort((a, b) => a.date.localeCompare(b.date)));
                    setLeaveDraft({ date: '', reason: '' });
                  }}
                >
                  <Plus className="h-4 w-4" /> Add date
                </Button>
              </div>
              {form.leaves.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No leave dates.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {form.leaves.map((l) => (
                    <li key={l.date} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span><span className="font-medium text-foreground">{new Date(`${l.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span> <span className="text-muted-foreground">— {l.reason}</span></span>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" aria-label="Remove leave date" onClick={() => set('leaves', form.leaves.filter((x) => x.date !== l.date))}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <div className="flex gap-2">
            {tab === 'details' && <Button variant="outline" onClick={() => setTab('schedule')}><CalendarClock className="h-4 w-4" /> Set schedule</Button>}
            <Button disabled={saving || uploading} onClick={save} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {tab === 'schedule' ? 'Save Schedule' : 'Save Doctor'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
