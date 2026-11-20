'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock, Loader2, Mail, MapPin,
  MessageCircle, Phone, Stethoscope, User,
} from 'lucide-react';

interface Doctor {
  id: string;
  name: string;
  department: string;
  departmentIds: string[];
  specialization?: string | null;
  qualification: string | null;
  experience: string | null;
  fee: number;
  languages: string | null;
  photo: string | null;
}
interface Service { id: string; name: string; price: number; duration: number; category?: string | null }
interface DepartmentOption { id: string; name: string; description: string | null; doctorCount: number }
interface Profile {
  kind: 'clinic' | 'business';
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  address: string;
  phone: string | null;
  whatsapp: string | null;
  mapLink: string | null;
  departmentList: DepartmentOption[];
  doctors: Doctor[];
  services: Service[];
  timeZone?: string;
}
interface Day { date: string; weekday: string; closedReason: string | null; slots: string[] }
interface Booked { ref: string; token: number; date: string; time: string; title: string; whatsappSent: boolean; businessWhatsapp: string | null }

type Step = 'patient' | 'appointment' | 'confirm' | 'done';
type Gender = '' | 'male' | 'female' | 'other' | 'prefer_not_to_say';

const STEPS: Array<{ id: Exclude<Step, 'done'>; label: string }> = [
  { id: 'patient', label: 'Patient details' },
  { id: 'appointment', label: 'Appointment' },
  { id: 'confirm', label: 'Confirm' },
];
const GENDERS: Array<{ id: Exclude<Gender, ''>; label: string }> = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other', label: 'Other' },
  { id: 'prefer_not_to_say', label: 'Prefer not to say' },
];
const BOOKING_HORIZON_MONTHS = 2;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONSENT_TEXT = 'I agree to receive appointment confirmations, reminders, and relevant appointment-related updates via WhatsApp.';

const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
const money = (n: number) => (n > 0 ? `₹${n.toLocaleString('en-IN')}` : '');
const drName = (n: string) => (/^dr\.?\s/i.test(n) ? n : `Dr. ${n}`);
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const digits = (s: string) => s.replace(/\D/g, '');

/** Today (YYYY-MM-DD) in the clinic's zone, so "past" means past for the clinic. */
function todayInZone(timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    const d = new Date();
    return iso(d.getFullYear(), d.getMonth(), d.getDate());
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    // Prefer the field-level reason over a generic "Invalid request body."
    const issue = body?.error?.details?.issues?.[0]?.message;
    throw new Error(issue && body?.error?.code === 'VALIDATION_ERROR' ? issue : body?.message || 'Something went wrong. Please try again.');
  }
  return body.data as T;
}

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 aria-[invalid=true]:border-red-400';
const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 text-slate-600 hover:border-emerald-400'}`;

export default function PublicBookingPage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('patient');

  const [patient, setPatient] = useState({ name: '', phone: '', email: '', age: '', gender: '' as Gender });
  const [patientErrors, setPatientErrors] = useState<Record<string, string>>({});

  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const [days, setDays] = useState<Day[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [complaint, setComplaint] = useState('');
  const [apptError, setApptError] = useState<string | null>(null);

  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);

  useEffect(() => {
    call<Profile>(`/api/public/booking/${id}`)
      .then((p) => {
        setProfile(p);
        document.title = `Book an appointment · ${p.name}`;
        if (p.departmentList?.length === 1) setDepartmentId(p.departmentList[0].id);
        const t = todayInZone(p.timeZone);
        setMonth({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const isClinic = profile?.kind === 'clinic';
  const today = useMemo(() => todayInZone(profile?.timeZone), [profile?.timeZone]);
  const departments = useMemo(() => profile?.departmentList ?? [], [profile]);
  const selectedDept = departments.find((d) => d.id === departmentId) ?? null;

  const doctorsInDept = useMemo(() => {
    const all = profile?.doctors ?? [];
    if (!departmentId) return departments.length ? [] : all;
    if (departmentId.startsWith('spec:')) return all.filter((d) => d.department === departmentId.slice(5));
    return all.filter((d) => d.departmentIds.includes(departmentId));
  }, [profile, departmentId, departments.length]);

  const phoneDigits = digits(patient.phone);
  const hasPhone = phoneDigits.length > 0;

  // ── slots for the visible month ────────────────────────────────────
  const loadSlots = useCallback(
    async (target: { doctorId?: string; serviceId?: string }, view: { y: number; m: number }) => {
      const monthStart = iso(view.y, view.m, 1);
      const from = monthStart < today ? today : monthStart;
      const lastDay = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
      const span = lastDay - Number(from.slice(8, 10)) + 1;
      if (span < 1) return setDays([]);
      setLoadingSlots(true);
      try {
        const q = new URLSearchParams({ days: String(Math.min(31, span)), from });
        if (target.doctorId) q.set('doctorId', target.doctorId);
        if (target.serviceId) q.set('serviceId', target.serviceId);
        const res = await call<{ days: Day[] }>(`/api/public/booking/${id}/slots?${q}`);
        setDays(res.days);
      } catch (e) {
        setApptError((e as Error).message);
        setDays([]);
      } finally {
        setLoadingSlots(false);
      }
    },
    [id, today],
  );

  const target = useMemo(
    () => (isClinic ? (doctor ? { doctorId: doctor.id } : null) : service ? { serviceId: service.id || undefined } : null),
    [isClinic, doctor, service],
  );

  useEffect(() => {
    if (target && month) void loadSlots(target, month);
    else setDays(null);
  }, [target, month, loadSlots]);

  const dayMap = useMemo(() => new Map((days ?? []).map((d) => [d.date, d])), [days]);
  const selectedDay = date ? dayMap.get(date) ?? null : null;

  function pickDepartment(depId: string) {
    setDepartmentId(depId);
    setDoctor(null);
    setDate(null);
    setTime(null);
  }
  function pickDoctor(d: Doctor) {
    setDoctor(d);
    setDate(null);
    setTime(null);
    setApptError(null);
  }
  function pickService(s: Service) {
    setService(s);
    setDate(null);
    setTime(null);
    setApptError(null);
  }

  // ── validation ─────────────────────────────────────────────────────
  function validatePatient(): boolean {
    const e: Record<string, string> = {};
    const name = patient.name.trim();
    if (name.length < 2) e.name = 'Please enter the patient’s full name.';
    else if (!/[a-zऀ-ॿ]/i.test(name)) e.name = 'Name should contain letters.';
    if (hasPhone && (phoneDigits.length < 10 || phoneDigits.length > 13)) e.phone = 'Enter a valid 10-digit mobile number.';
    if (!isClinic && !hasPhone) e.phone = 'A WhatsApp number is required to book.';
    if (patient.email.trim() && !EMAIL_RE.test(patient.email.trim())) e.email = 'Enter a valid email address.';
    if (patient.age && Number(patient.age) > 120) e.age = 'Enter a valid age.';
    setPatientErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateAppointment(): boolean {
    const fail = (msg: string) => {
      setApptError(msg);
      return false;
    };
    if (isClinic) {
      if (departments.length > 1 && !departmentId) return fail('Please choose a department.');
      if (!doctor) return fail('Please choose a doctor.');
    } else if (!service) return fail('Please choose a service.');
    if (!date) return fail('Please pick a date.');
    if (!time) return fail('Please pick a time slot.');
    if (isClinic && complaint.trim().length < 3) return fail('Please describe the chief complaint (e.g. “fever for 2 days”).');
    setApptError(null);
    return true;
  }

  async function submit() {
    if (!date || !time) return;
    if (consent && !hasPhone) return setSubmitError('Add a WhatsApp number to receive updates, or untick the consent box.');
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await call<Booked>(`/api/public/booking/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: patient.name.trim(),
          phone: patient.phone.trim(),
          email: patient.email.trim(),
          age: patient.age || undefined,
          gender: patient.gender || undefined,
          departmentId: isClinic ? departmentId ?? undefined : undefined,
          doctorId: doctor?.id,
          serviceId: service?.id || undefined,
          date,
          time,
          notes: complaint.trim() || undefined,
          whatsappConsent: consent && hasPhone,
        }),
      });
      setBooked(res);
      setStep('done');
    } catch (err) {
      const msg = (err as Error).message;
      if (/taken|available|booked/i.test(msg)) {
        // Someone else got the slot first: refresh availability and send them back.
        setTime(null);
        setApptError(`${msg} Please pick another time.`);
        setStep('appointment');
        if (target && month) void loadSlots(target, month);
      } else {
        setSubmitError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const waNumber = digits(booked?.businessWhatsapp || profile?.whatsapp || '');

  if (error && !profile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Booking page unavailable</p>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </div>
      </main>
    );
  }
  if (!profile || !month) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl space-y-4">
          <div className="h-28 animate-pulse rounded-2xl bg-slate-200/70" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-200/70" />
        </div>
      </main>
    );
  }

  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7)) - 1;
  const monthOffset = (month.y - ty) * 12 + (month.m - tm);
  const changeMonth = (delta: number) => {
    const n = month.y * 12 + month.m + delta;
    setMonth({ y: Math.floor(n / 12), m: n % 12 });
    setDate(null);
    setTime(null);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 to-slate-50 px-4 py-6 text-slate-900 sm:py-10">
      <div className="mx-auto max-w-xl space-y-4">
        {/* Business header */}
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-lg font-bold text-white">{profile.name.charAt(0).toUpperCase()}</span>
            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-tight">{profile.name}</h1>
              {profile.type && <p className="text-xs capitalize text-slate-500">{profile.type.replace(/_/g, ' ')}</p>}
              {profile.address && (
                <a href={profile.mapLink || `https://maps.google.com/?q=${encodeURIComponent(profile.address)}`} target="_blank" rel="noreferrer" className="mt-1 flex items-start gap-1 text-xs text-slate-600 hover:text-emerald-700">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" /> {profile.address}
                </a>
              )}
            </div>
          </div>
          {step !== 'done' && (
            <ol className="mt-4 grid grid-cols-3 gap-1 text-[11px] font-medium" aria-label="Booking steps">
              {STEPS.map((s, i) => (
                <li key={s.id} aria-current={i === stepIdx ? 'step' : undefined} className={`rounded-full px-2 py-1 text-center ${i < stepIdx ? 'bg-emerald-100 text-emerald-800' : i === stepIdx ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {i + 1}. {s.label}
                </li>
              ))}
            </ol>
          )}
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* STEP 1 — patient information */}
          {step === 'patient' && (
            <form
              noValidate
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (validatePatient()) setStep('appointment');
              }}
            >
              <p className="text-sm font-semibold">{isClinic ? 'Patient information' : 'Your details'}</p>
              <Field label="Full name" required error={patientErrors.name}>
                <span className="relative block"><User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={patient.name} maxLength={120} aria-invalid={!!patientErrors.name} onChange={(e) => setPatient({ ...patient, name: e.target.value })} className={`${inputCls} pl-9`} placeholder="Rahul Sharma" autoComplete="name" /></span>
              </Field>
              <Field label="WhatsApp number" required={!isClinic} optional={isClinic} error={patientErrors.phone}>
                <span className="relative block"><Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input inputMode="tel" value={patient.phone} maxLength={18} aria-invalid={!!patientErrors.phone} onChange={(e) => setPatient({ ...patient, phone: e.target.value.replace(/[^\d+\s-]/g, '') })} className={`${inputCls} pl-9`} placeholder="98765 43210" autoComplete="tel" /></span>
              </Field>
              <Field label="Email" optional error={patientErrors.email}>
                <span className="relative block"><Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input type="email" inputMode="email" value={patient.email} maxLength={191} aria-invalid={!!patientErrors.email} onChange={(e) => setPatient({ ...patient, email: e.target.value })} className={`${inputCls} pl-9`} placeholder="you@example.com" autoComplete="email" /></span>
              </Field>
              {isClinic && (
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Age" error={patientErrors.age}>
                    <input inputMode="numeric" value={patient.age} aria-invalid={!!patientErrors.age} onChange={(e) => setPatient({ ...patient, age: digits(e.target.value).slice(0, 3) })} className={`${inputCls} pl-3`} placeholder="32" />
                  </Field>
                  <div className="col-span-2 space-y-1 text-sm">
                    <span className="font-medium">Gender</span>
                    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Gender">
                      {GENDERS.map((g) => (
                        <button key={g.id} type="button" role="radio" aria-checked={patient.gender === g.id} onClick={() => setPatient({ ...patient, gender: patient.gender === g.id ? '' : g.id })} className={chip(patient.gender === g.id)}>{g.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
                Continue <ArrowRight className="size-4" />
              </button>
            </form>
          )}

          {/* STEP 2 — appointment details */}
          {step === 'appointment' && (
            <div className="space-y-5">
              {isClinic ? (
                <>
                  {departments.length > 1 && (
                    <div>
                      <p className="mb-2 text-sm font-semibold">Choose a department</p>
                      <div className="flex flex-wrap gap-2">
                        {departments.map((d) => (
                          <button key={d.id} type="button" disabled={!d.doctorCount} onClick={() => pickDepartment(d.id)} className={`${chip(departmentId === d.id)} disabled:cursor-not-allowed disabled:opacity-40`} title={d.description ?? undefined}>
                            {d.name}
                          </button>
                        ))}
                      </div>
                      {selectedDept?.description && <p className="mt-2 text-xs text-slate-500">{selectedDept.description}</p>}
                    </div>
                  )}
                  {(departmentId || departments.length <= 1) && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Choose a doctor</p>
                      {doctorsInDept.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No doctors are available for online booking in this department yet.</p>}
                      {doctorsInDept.map((d) => {
                        const on = doctor?.id === d.id;
                        return (
                          <button key={d.id} type="button" onClick={() => pickDoctor(d)} aria-pressed={on} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${on ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500/20' : 'border-slate-200 hover:border-emerald-500'}`}>
                            {d.photo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={d.photo} alt="" className="size-12 rounded-full object-cover" />
                            ) : (
                              <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Stethoscope className="size-5" /></span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">{drName(d.name)}</span>
                              <span className="block text-xs text-slate-500">{[d.specialization || d.department, d.qualification, d.experience].filter(Boolean).join(' · ')}</span>
                              {d.languages && <span className="block text-[11px] text-slate-400">Speaks {d.languages}</span>}
                            </span>
                            {d.fee > 0 && <span className="shrink-0 text-sm font-semibold text-emerald-700">{money(d.fee)}</span>}
                            {on && <Check className="size-5 shrink-0 text-emerald-600" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Choose a service</p>
                  {(profile.services.length ? profile.services : [{ id: '', name: 'Appointment', price: 0, duration: 30 }]).map((s) => {
                    const on = service?.id === s.id && service?.name === s.name;
                    return (
                      <button key={s.id || 'default'} type="button" onClick={() => pickService(s)} aria-pressed={on} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${on ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 hover:border-emerald-500'}`}>
                        <span><span className="block font-semibold">{s.name}</span><span className="block text-xs text-slate-500">{s.duration} min</span></span>
                        {s.price > 0 && <span className="text-sm font-semibold text-emerald-700">{money(s.price)}</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {target && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-emerald-600" /> Pick a date</p>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Previous month" disabled={monthOffset <= 0} onClick={() => changeMonth(-1)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="size-4" /></button>
                      <span className="w-32 text-center text-sm font-medium">{new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
                      <button type="button" aria-label="Next month" disabled={monthOffset >= BOOKING_HORIZON_MONTHS - 1} onClick={() => changeMonth(1)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="size-4" /></button>
                    </div>
                  </div>
                  <Calendar y={month.y} m={month.m} today={today} loading={loadingSlots || !days} dayMap={dayMap} selected={date} onSelect={(d) => { setDate(d); setTime(null); setApptError(null); }} />

                  {date && (
                    <>
                      <p className="flex items-center gap-2 text-sm font-semibold"><Clock className="size-4 text-emerald-600" /> Available times · {fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                      {!selectedDay || selectedDay.slots.length === 0 ? (
                        <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">{selectedDay?.closedReason ?? 'No slots on this day.'}</p>
                      ) : (
                        <SlotGrid slots={selectedDay.slots} selected={time} onSelect={(t) => { setTime(t); setApptError(null); }} />
                      )}
                    </>
                  )}
                </div>
              )}

              {isClinic && (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Chief complaint <span className="text-red-500">*</span></span>
                  <textarea rows={3} value={complaint} maxLength={500} onChange={(e) => setComplaint(e.target.value)} className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" placeholder="e.g. Fever and sore throat for 2 days" />
                  <span className="block text-right text-[11px] text-slate-400">{complaint.length}/500</span>
                </label>
              )}

              {apptError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{apptError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep('patient')} className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft className="size-4" /> Back</button>
                <button type="button" onClick={() => validateAppointment() && setStep('confirm')} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
                  Review booking <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — confirmation */}
          {step === 'confirm' && date && time && (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="size-4 text-emerald-600" /> Review your appointment</p>
              <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                <Row label="Patient" value={[patient.name.trim(), patient.age && `${patient.age} yrs`, GENDERS.find((g) => g.id === patient.gender)?.label].filter(Boolean).join(' · ')} />
                {hasPhone && <Row label="WhatsApp" value={patient.phone.trim()} />}
                {patient.email.trim() && <Row label="Email" value={patient.email.trim()} />}
                {isClinic && selectedDept && <Row label="Department" value={selectedDept.name} />}
                {doctor && <Row label="Doctor" value={`${drName(doctor.name)}${doctor.fee > 0 ? ` · ${money(doctor.fee)}` : ''}`} />}
                {service && <Row label="Service" value={service.name} />}
                <Row label="Date & time" value={`${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${fmtTime(time)}`} />
                {complaint.trim() && <Row label="Chief complaint" value={complaint.trim()} />}
              </dl>

              <label className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${hasPhone ? 'cursor-pointer border-slate-200 hover:border-emerald-400' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                <input type="checkbox" checked={consent && hasPhone} disabled={!hasPhone} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-emerald-600" />
                <span>
                  {CONSENT_TEXT}
                  {!hasPhone && <span className="mt-1 block text-xs">Add a WhatsApp number in step 1 to enable WhatsApp updates.</span>}
                </span>
              </label>

              {submitError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>}
              <div className="flex gap-2">
                <button type="button" disabled={submitting} onClick={() => setStep('appointment')} className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><ArrowLeft className="size-4" /> Back</button>
                <button type="button" disabled={submitting} onClick={submit} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Confirm &amp; Book Appointment
                </button>
              </div>
            </div>
          )}

          {/* DONE */}
          {step === 'done' && booked && (
            <div className="space-y-4 py-2 text-center">
              <CheckCircle2 className="mx-auto size-14 text-emerald-600" />
              <div>
                <p className="text-xl font-bold">Appointment confirmed!</p>
                <p className="mt-1 text-sm text-slate-500">{booked.title} · {fmtDate(booked.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtTime(booked.time)}</p>
              </div>
              <div className="mx-auto grid w-fit grid-cols-2 divide-x divide-emerald-200 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50">
                <div className="px-6 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Appointment ID</p>
                  <p className="mt-1 font-mono text-lg font-bold text-emerald-800">{booked.ref}</p>
                </div>
                <div className="px-6 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Token</p>
                  <p className="text-4xl font-black text-emerald-700">{booked.token}</p>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                {booked.whatsappSent
                  ? 'Confirmation sent to your WhatsApp. You will also get reminders before your visit.'
                  : consent && hasPhone
                    ? 'Your booking is saved. WhatsApp confirmation will follow shortly.'
                    : 'Your booking is saved. Please note your Appointment ID — you won’t receive WhatsApp updates.'}
              </p>
              {waNumber && consent && hasPhone && !booked.whatsappSent && (
                <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hi, I just booked an appointment. Appointment ID ${booked.ref}, token ${booked.token}.`)}`} className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:brightness-95">
                  <MessageCircle className="size-4" /> Message us on WhatsApp
                </a>
              )}
            </div>
          )}
        </section>

        <p className="text-center text-[11px] text-slate-400">Powered by ChatNexGen</p>
      </div>
    </main>
  );
}

function Field({ label, required, optional, error, children }: { label: string; required?: boolean; optional?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">
        {label} {required && <span className="text-red-500">*</span>} {optional && <span className="font-normal text-slate-400">(optional)</span>}
      </span>
      {children}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 break-words font-medium">{value}</dd>
    </div>
  );
}

function SlotGrid({ slots, selected, onSelect }: { slots: string[]; selected: string | null; onSelect: (t: string) => void }) {
  const groups = [
    { label: 'Morning', items: slots.filter((t) => t < '12:00') },
    { label: 'Afternoon', items: slots.filter((t) => t >= '12:00' && t < '16:00') },
    { label: 'Evening', items: slots.filter((t) => t >= '16:00') },
  ].filter((g) => g.items.length);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label} · {g.items.length}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {g.items.map((t) => (
              <button key={t} type="button" aria-pressed={selected === t} onClick={() => onSelect(t)} className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${selected === t ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 hover:border-emerald-400'}`}>{fmtTime(t)}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Calendar({ y, m, today, loading, dayMap, selected, onSelect }: { y: number; m: number; today: string; loading: boolean; dayMap: Map<string, Day>; selected: string | null; onSelect: (d: string) => void }) {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [...Array<null>(first).fill(null), ...Array.from({ length: count }, (_, i) => iso(y, m, i + 1))];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const past = d < today;
          const info = dayMap.get(d);
          const free = info?.slots.length ?? 0;
          const disabled = past || loading || !free;
          const on = d === selected;
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(d)}
              aria-pressed={on}
              aria-label={`${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}${free ? `, ${free} slots available` : ', unavailable'}`}
              title={!past && info && !free ? info.closedReason ?? 'Fully booked' : undefined}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition ${
                on ? 'bg-emerald-600 font-bold text-white' : disabled ? 'cursor-not-allowed text-slate-300' : 'font-medium text-slate-800 hover:bg-emerald-50'
              } ${d === today && !on ? 'ring-1 ring-emerald-400' : ''}`}
            >
              {Number(d.slice(8))}
              {loading && !past ? (
                <span className="mt-0.5 h-1 w-1 animate-pulse rounded-full bg-slate-300" />
              ) : free > 0 ? (
                <span className={`mt-0.5 text-[9px] leading-none ${on ? 'text-emerald-100' : 'text-emerald-600'}`}>{free}</span>
              ) : (
                <span className="mt-0.5 h-[9px]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
