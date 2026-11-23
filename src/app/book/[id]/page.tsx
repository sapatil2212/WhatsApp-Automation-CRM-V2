'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, CalendarDays, CalendarPlus, Check, CheckCircle2, ChevronRight, Clock, Layers, Loader2, Mail, MapPin,
  Phone, RotateCcw, Stethoscope, User, Users,
} from 'lucide-react';
import { DatePicker, Dropdown, type DropdownOption } from '@/components/booking/pickers';

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
  days?: string[];
}
interface Service { id: string; name: string; price: number; duration: number; category?: string | null }
interface DepartmentOption { id: string; name: string; description: string | null; doctorCount: number }
interface Timing { day: string; closed: boolean; open: string | null; close: string | null }
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
  /** Clinic logo uploaded in Prescription setup, if any. */
  logoUrl?: string | null;
  timings?: Timing[];
  departmentList: DepartmentOption[];
  doctors: Doctor[];
  services: Service[];
  timeZone?: string;
}
interface Day { date: string; weekday: string; closedReason: string | null; slots: string[] }
interface Booked { ref: string; token: number; date: string; time: string; title: string; whatsappSent: boolean; businessWhatsapp: string | null }

type Step = 'patient' | 'appointment' | 'confirm' | 'done';
type Gender = '' | 'male' | 'female' | 'other' | 'prefer_not_to_say';

const STEPS: Array<{ id: Exclude<Step, 'done'>; label: string; short: string }> = [
  { id: 'patient', label: 'Your details', short: 'Details' },
  { id: 'appointment', label: 'Appointment', short: 'Slot' },
  { id: 'confirm', label: 'Confirm', short: 'Confirm' },
];
const GENDERS: Array<{ id: Exclude<Gender, ''>; label: string }> = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other', label: 'Other' },
  { id: 'prefer_not_to_say', label: 'Prefer not to say' },
];
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** Bookable window shown in the date dropdown (the slots API serves up to 31 days per call). */
const HORIZON_DAYS = 60;
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
const addDaysIso = (d: string, n: number) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)) + n)).toISOString().slice(0, 10);
const digits = (s: string) => s.replace(/\D/g, '');
const initials = (n: string) => n.replace(/^dr\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

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

/** Calendar file so the patient can save the visit (floating local time, clinic zone). */
function downloadIcs(o: { title: string; date: string; time: string; minutes: number; location: string; ref: string; clinic: string }) {
  const [h, m] = o.time.split(':').map(Number);
  const start = new Date(Date.UTC(Number(o.date.slice(0, 4)), Number(o.date.slice(5, 7)) - 1, Number(o.date.slice(8, 10)), h, m));
  const end = new Date(start.getTime() + o.minutes * 60_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').slice(0, 15);
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ChatNexGen//Booking//EN', 'BEGIN:VEVENT',
    `UID:${o.ref}@chatnexgen`, `DTSTAMP:${stamp(new Date())}Z`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`${o.title} · ${o.clinic}`)}`, `LOCATION:${esc(o.location)}`, `DESCRIPTION:${esc(`Appointment ID ${o.ref}`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `appointment-${o.ref}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// Compact fields: 12px / h-8 on phones, 13px / h-9 from sm up (iOS focus-zoom is disabled in book/layout.tsx).
const fieldBase = 'h-8 w-full rounded-lg border border-slate-200 bg-white text-[12px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 aria-[invalid=true]:border-red-400 sm:h-9 sm:text-[13px]';
const primaryBtn = 'flex h-8 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-[12px] sm:h-9 sm:px-4 sm:text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60';
const ghostBtn = 'flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] sm:h-9 sm:px-3 sm:text-[13px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50';

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
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const isClinic = profile?.kind === 'clinic';
  const today = useMemo(() => todayInZone(profile?.timeZone), [profile?.timeZone]);
  const departments = useMemo(() => profile?.departmentList ?? [], [profile]);
  const selectedDept = departments.find((d) => d.id === departmentId) ?? null;
  const needsDept = isClinic && departments.length > 1;

  const doctorsInDept = useMemo(() => {
    const all = profile?.doctors ?? [];
    if (!departmentId) return departments.length ? [] : all;
    if (departmentId.startsWith('spec:')) return all.filter((d) => d.department === departmentId.slice(5));
    return all.filter((d) => d.departmentIds.includes(departmentId));
  }, [profile, departmentId, departments.length]);
  const serviceOptions = useMemo<Service[]>(() => (profile?.services.length ? profile.services : [{ id: '', name: 'Appointment', price: 0, duration: 30 }]), [profile]);

  const phoneDigits = digits(patient.phone);
  const hasPhone = phoneDigits.length > 0;

  // ── slots for the whole bookable window (two calls: the API caps at 31 days) ──
  const loadSlots = useCallback(
    async (target: { doctorId?: string; serviceId?: string }) => {
      setLoadingSlots(true);
      try {
        const fetchRange = (from: string, n: number) => {
          const q = new URLSearchParams({ days: String(n), from });
          if (target.doctorId) q.set('doctorId', target.doctorId);
          if (target.serviceId) q.set('serviceId', target.serviceId);
          return call<{ days: Day[] }>(`/api/public/booking/${id}/slots?${q}`);
        };
        const [a, b] = await Promise.all([fetchRange(today, 31), fetchRange(addDaysIso(today, 31), HORIZON_DAYS - 31)]);
        setDays([...a.days, ...b.days]);
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
    if (target) void loadSlots(target);
    else setDays(null);
  }, [target, loadSlots]);

  const openDays = useMemo(() => (days ?? []).filter((d) => d.slots.length > 0), [days]);
  const selectedDay = date ? openDays.find((d) => d.date === date) ?? null : null;
  const slotGroups = useMemo(() => {
    const s = selectedDay?.slots ?? [];
    return [
      { label: 'Morning', items: s.filter((t) => t < '12:00') },
      { label: 'Afternoon', items: s.filter((t) => t >= '12:00' && t < '16:00') },
      { label: 'Evening', items: s.filter((t) => t >= '16:00') },
    ].filter((g) => g.items.length);
  }, [selectedDay]);

  const availableMap = useMemo(() => new Map(openDays.map((d) => [d.date, d.slots.length])), [openDays]);
  const closedReasons = useMemo(() => new Map((days ?? []).filter((d) => !d.slots.length && d.closedReason).map((d) => [d.date, d.closedReason as string])), [days]);
  const timeOptions = useMemo<DropdownOption[]>(
    () => slotGroups.flatMap((g) => g.items.map((t) => ({ value: t, label: fmtTime(t), group: `${g.label} · ${g.items.length}` }))),
    [slotGroups],
  );
  const deptOptions = useMemo<DropdownOption[]>(
    () => departments.map((d) => ({ value: d.id, label: d.name, sub: d.doctorCount ? `${d.doctorCount} doctor${d.doctorCount === 1 ? '' : 's'}${d.description ? ` · ${d.description}` : ''}` : 'No doctors yet', disabled: !d.doctorCount })),
    [departments],
  );
  const doctorOptions = useMemo<DropdownOption[]>(
    () => doctorsInDept.map((d) => ({
      value: d.id,
      label: drName(d.name),
      sub: [d.specialization || d.department, d.qualification, d.experience].filter(Boolean).join(' · '),
      right: money(d.fee) || undefined,
      avatar: { text: initials(d.name), src: d.photo },
    })),
    [doctorsInDept],
  );

  function pickDepartment(depId: string) {
    setDepartmentId(depId || null);
    setDoctor(null);
    setDate(null);
    setTime(null);
    setApptError(null);
  }
  function pickDoctor(docId: string) {
    setDoctor(doctorsInDept.find((d) => d.id === docId) ?? null);
    setDate(null);
    setTime(null);
    setApptError(null);
  }
  function pickService(idx: string) {
    setService(idx === '' ? null : serviceOptions[Number(idx)] ?? null);
    setDate(null);
    setTime(null);
    setApptError(null);
  }
  function pickDate(d: string) {
    setDate(d || null);
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
      if (needsDept && !departmentId) return fail('Please choose a department.');
      if (!doctor) return fail('Please choose a doctor.');
    } else if (!service) return fail('Please choose a service.');
    if (!date) return fail('Please pick a date.');
    if (!time) return fail('Please pick a time.');
    if (isClinic && complaint.trim().length < 3) return fail('Please describe the reason for the visit (e.g. “tooth pain for 2 days”).');
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const msg = (err as Error).message;
      if (/taken|available|booked/i.test(msg)) {
        // Someone else got the slot first: refresh availability and send them back.
        setTime(null);
        setApptError(`${msg} Please pick another time.`);
        setStep('appointment');
        if (target) void loadSlots(target);
      } else {
        setSubmitError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function bookAnother() {
    setStep('patient');
    setPatient({ name: '', phone: patient.phone, email: '', age: '', gender: '' });
    setPatientErrors({});
    setDoctor(null);
    setService(null);
    setDate(null);
    setTime(null);
    setComplaint('');
    setConsent(false);
    setBooked(null);
    setSubmitError(null);
    setApptError(null);
    if (departments.length !== 1) setDepartmentId(null);
  }

  const goTo = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const waNumber = digits(booked?.businessWhatsapp || profile?.whatsapp || '');

  if (error && !profile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-base font-semibold text-slate-900">Booking page unavailable</p>
          <p className="mt-1.5 text-sm text-slate-500">{error}</p>
        </div>
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="h-14 border-b border-slate-200 bg-white" />
        <div className="mx-auto grid max-w-5xl gap-4 px-3 py-4 sm:px-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="h-80 animate-pulse rounded-xl bg-slate-200/70" />
          <div className="hidden h-60 animate-pulse rounded-xl bg-slate-200/70 lg:block" />
        </div>
      </main>
    );
  }

  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const mapHref = profile.mapLink || (profile.address ? `https://maps.google.com/?q=${encodeURIComponent(profile.address)}` : null);
  const phoneHref = profile.phone ? `tel:${digits(profile.phone)}` : null;
  const waHref = digits(profile.whatsapp || '') ? `https://wa.me/${digits(profile.whatsapp || '')}` : null;
  const fee = doctor?.fee || service?.price || 0;
  const serviceIdx = service ? serviceOptions.findIndex((s) => s.id === service.id && s.name === service.name) : -1;

  const datePlaceholder = !target
    ? isClinic ? 'Pick doctor first' : 'Pick service first'
    : loadingSlots ? 'Loading…' : openDays.length ? 'Select date' : 'No dates';
  const timePlaceholder = !date ? 'Pick date first' : slotGroups.length ? 'Select time' : 'No times left';

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Business bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-3 py-2.5 sm:px-4">
          <ClinicLogo name={profile.name} src={profile.logoUrl} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-bold leading-tight sm:text-base">{profile.name}</h1>
            <p className="truncate text-[11px] text-slate-500">{[profile.type?.replace(/_/g, ' '), 'Book an appointment'].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {phoneHref && <a href={phoneHref} aria-label="Call" className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 sm:w-auto sm:gap-1.5 sm:px-2.5 sm:text-[12px] sm:font-medium"><Phone className="size-3.5" /><span className="hidden sm:inline">Call</span></a>}
            {waHref && <a href={waHref} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="flex size-8 items-center justify-center rounded-lg bg-[#25D366] text-white hover:brightness-95 sm:w-auto sm:gap-1.5 sm:px-2.5 sm:text-[12px] sm:font-medium"><WhatsAppIcon className="size-4" /><span className="hidden sm:inline">WhatsApp</span></a>}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl items-start gap-3 px-2.5 py-3 sm:gap-4 sm:px-4 sm:py-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-3">
          {step !== 'done' && (
            <ol className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5" aria-label="Booking steps">
              {STEPS.map((s, i) => {
                const done = i < stepIdx;
                const on = i === stepIdx;
                return (
                  <li key={s.id} aria-current={on ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-1">
                    <button
                      type="button"
                      disabled={!done}
                      onClick={() => goTo(s.id)}
                      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1.5 py-1.5 text-[12px] transition sm:justify-start sm:px-2 sm:text-[13px] ${on ? 'bg-emerald-50 font-semibold text-emerald-800' : done ? 'text-slate-700 hover:bg-slate-50' : 'text-slate-400'}`}
                    >
                      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? 'bg-emerald-100 text-emerald-700' : on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {done ? <Check className="size-3" /> : i + 1}
                      </span>
                      <span className="truncate sm:hidden">{s.short}</span>
                      <span className="hidden truncate sm:inline">{s.label}</span>
                    </button>
                    {i < STEPS.length - 1 && <ChevronRight className="size-3.5 shrink-0 text-slate-300" />}
                  </li>
                );
              })}
            </ol>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
            {/* STEP 1: patient information */}
            {step === 'patient' && (
              <form
                noValidate
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (validatePatient()) goTo('appointment');
                }}
              >
                <StepTitle title={isClinic ? 'Patient details' : 'Your details'} sub={isClinic ? 'Who is the appointment for?' : 'So we can confirm your booking.'} />
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5 sm:gap-3">
                  <Field id="bk-name" label="Full name" required error={patientErrors.name} className="col-span-2">
                    <IconInput icon={User}>
                      <input id="bk-name" value={patient.name} maxLength={120} aria-invalid={!!patientErrors.name} onChange={(e) => setPatient({ ...patient, name: e.target.value })} className={`${fieldBase} pl-7 pr-2 sm:pl-8 sm:pr-3`} placeholder="Rahul Sharma" autoComplete="name" />
                    </IconInput>
                  </Field>
                  <Field id="bk-phone" label="WhatsApp number" required={!isClinic} optional={isClinic} error={patientErrors.phone}>
                    <IconInput icon={Phone}>
                      <input id="bk-phone" inputMode="tel" value={patient.phone} maxLength={18} aria-invalid={!!patientErrors.phone} onChange={(e) => setPatient({ ...patient, phone: e.target.value.replace(/[^\d+\s-]/g, '') })} className={`${fieldBase} pl-7 pr-2 sm:pl-8 sm:pr-3`} placeholder="98765 43210" autoComplete="tel" />
                    </IconInput>
                  </Field>
                  <Field id="bk-email" label="Email" optional error={patientErrors.email}>
                    <IconInput icon={Mail}>
                      <input id="bk-email" type="email" inputMode="email" value={patient.email} maxLength={191} aria-invalid={!!patientErrors.email} onChange={(e) => setPatient({ ...patient, email: e.target.value })} className={`${fieldBase} pl-7 pr-2 sm:pl-8 sm:pr-3`} placeholder="you@example.com" autoComplete="email" />
                    </IconInput>
                  </Field>
                  {isClinic && (
                    <>
                      <Field id="bk-age" label="Age" optional error={patientErrors.age}>
                        <input id="bk-age" inputMode="numeric" value={patient.age} aria-invalid={!!patientErrors.age} onChange={(e) => setPatient({ ...patient, age: digits(e.target.value).slice(0, 3) })} className={`${fieldBase} px-2.5 sm:px-3`} placeholder="32" />
                      </Field>
                      <Field id="bk-gender" label="Gender" optional>
                        <Dropdown id="bk-gender" labelledBy="bk-gender-label" title="Gender" value={patient.gender} onChange={(v) => setPatient({ ...patient, gender: v as Gender })} icon={Users} placeholder="Gender" searchable={false} options={GENDERS.map((g) => ({ value: g.id, label: g.label }))} />
                      </Field>
                    </>
                  )}
                </div>
                {isClinic && !hasPhone && <p className="text-[11px] text-slate-500">Add a WhatsApp number to get your confirmation and reminders on WhatsApp.</p>}
                <div className="flex justify-end pt-1">
                  <button type="submit" className={`${primaryBtn} w-full sm:w-auto`}>Continue <ArrowRight className="size-3.5" /></button>
                </div>
              </form>
            )}

            {/* STEP 2: appointment details */}
            {step === 'appointment' && (
              <div className="space-y-3">
                <StepTitle title="Appointment" sub={isClinic ? 'Choose the doctor, then a date and time.' : 'Choose a service, then a date and time.'} />
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5 sm:gap-3">
                  {isClinic ? (
                    <>
                      {needsDept && (
                        <Field id="bk-dept" label="Department" required>
                          <Dropdown id="bk-dept" labelledBy="bk-dept-label" title="Department" value={departmentId ?? ''} onChange={pickDepartment} icon={Layers} placeholder="Department" options={deptOptions} />
                        </Field>
                      )}
                      <Field id="bk-doctor" label="Doctor" required className={needsDept ? '' : 'col-span-2'}>
                        <Dropdown
                          id="bk-doctor"
                          labelledBy="bk-doctor-label"
                          title="Choose a doctor"
                          value={doctor?.id ?? ''}
                          onChange={pickDoctor}
                          icon={Stethoscope}
                          disabled={needsDept && !departmentId}
                          placeholder={needsDept && !departmentId ? 'Pick department first' : doctorsInDept.length ? 'Select doctor' : 'No doctors'}
                          emptyText="No doctors are available for online booking here yet."
                          options={doctorOptions}
                        />
                      </Field>
                    </>
                  ) : (
                    <Field id="bk-service" label="Service" required className="col-span-2">
                      <Dropdown
                        id="bk-service"
                        labelledBy="bk-service-label"
                        title="Choose a service"
                        value={serviceIdx >= 0 ? String(serviceIdx) : ''}
                        onChange={pickService}
                        icon={Stethoscope}
                        placeholder="Select service"
                        options={serviceOptions.map((s, i) => ({ value: String(i), label: s.name, sub: `${s.duration} min${s.category ? ` · ${s.category}` : ''}`, right: money(s.price) || undefined, group: s.category || undefined }))}
                      />
                    </Field>
                  )}

                  {doctor && <DoctorCard d={doctor} className="col-span-2" />}
                  {selectedDept?.description && !doctor && <p className="-mt-1 col-span-2 text-[11px] text-slate-500">{selectedDept.description}</p>}

                  <Field id="bk-date" label="Date" required>
                    <DatePicker
                      id="bk-date"
                      labelledBy="bk-date-label"
                      value={date}
                      onChange={pickDate}
                      available={availableMap}
                      min={today}
                      max={addDaysIso(today, HORIZON_DAYS - 1)}
                      reasonFor={(d) => closedReasons.get(d) ?? null}
                      disabled={!target || loadingSlots || !openDays.length}
                      loading={loadingSlots}
                      placeholder={datePlaceholder}
                    />
                  </Field>
                  <Field id="bk-time" label="Time" required>
                    <Dropdown
                      id="bk-time"
                      labelledBy="bk-time-label"
                      title={date ? `Times on ${fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}` : 'Choose a time'}
                      value={time ?? ''}
                      onChange={(t) => { setTime(t || null); setApptError(null); }}
                      icon={Clock}
                      layout="grid"
                      searchable={false}
                      disabled={!date || !slotGroups.length}
                      placeholder={timePlaceholder}
                      options={timeOptions}
                    />
                  </Field>
                  {target && !loadingSlots && days && !openDays.length && (
                    <p className="col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 sm:text-[12px]">
                      No free slots in the next {HORIZON_DAYS} days. {waHref ? 'Message us on WhatsApp and we’ll help you find a time.' : 'Please try another doctor or call the clinic.'}
                    </p>
                  )}

                  {isClinic && (
                    <Field id="bk-reason" label="Reason" required className="col-span-2" hint={`${complaint.length}/500`}>
                      <textarea id="bk-reason" rows={2} value={complaint} maxLength={500} onChange={(e) => setComplaint(e.target.value)} className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 sm:px-3 sm:py-2 sm:text-[13px]" placeholder="e.g. Tooth pain and swelling for 2 days" />
                    </Field>
                  )}
                </div>

                {apptError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{apptError}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => goTo('patient')} className={ghostBtn}><ArrowLeft className="size-3.5" /> Back</button>
                  <button type="button" onClick={() => validateAppointment() && goTo('confirm')} className={`${primaryBtn} flex-1 sm:ml-auto sm:flex-none`}>
                    Review booking <ArrowRight className="size-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: confirmation */}
            {step === 'confirm' && date && time && (
              <div className="space-y-3">
                <StepTitle title="Review and confirm" sub="Check the details below before booking." />
                <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-[12px] sm:text-[13px]">
                  <Row label="Patient" value={[patient.name.trim(), patient.age && `${patient.age} yrs`, GENDERS.find((g) => g.id === patient.gender)?.label].filter(Boolean).join(' · ')} onEdit={() => goTo('patient')} />
                  {hasPhone && <Row label="WhatsApp" value={patient.phone.trim()} />}
                  {patient.email.trim() && <Row label="Email" value={patient.email.trim()} />}
                  {isClinic && selectedDept && <Row label="Department" value={selectedDept.name} />}
                  {doctor && <Row label="Doctor" value={`${drName(doctor.name)}${doctor.fee > 0 ? ` · ${money(doctor.fee)}` : ''}`} onEdit={() => goTo('appointment')} />}
                  {service && <Row label="Service" value={`${service.name}${service.price > 0 ? ` · ${money(service.price)}` : ''}`} onEdit={() => goTo('appointment')} />}
                  <Row label="Date & time" value={`${fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${fmtTime(time)}`} onEdit={() => goTo('appointment')} />
                  {complaint.trim() && <Row label="Reason" value={complaint.trim()} />}
                </dl>

                <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-[12px] leading-relaxed ${hasPhone ? 'cursor-pointer border-slate-200 hover:border-emerald-400' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                  <input type="checkbox" checked={consent && hasPhone} disabled={!hasPhone} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-emerald-600" />
                  <span>
                    {CONSENT_TEXT}
                    {!hasPhone && <span className="mt-0.5 block text-[11px]">Add a WhatsApp number in step 1 to enable WhatsApp updates.</span>}
                  </span>
                </label>

                {submitError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{submitError}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="button" disabled={submitting} onClick={() => goTo('appointment')} className={ghostBtn}><ArrowLeft className="size-3.5" /> Back</button>
                  <button type="button" disabled={submitting} onClick={submit} className={`${primaryBtn} flex-1 sm:ml-auto sm:flex-none`}>
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Confirm booking
                  </button>
                </div>
              </div>
            )}

            {/* DONE */}
            {step === 'done' && booked && (
              <div className="space-y-3.5 py-1 text-center">
                <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-emerald-100"><CheckCircle2 className="size-6 text-emerald-600" /></span>
                <div>
                  <h2 className="text-base font-bold sm:text-lg">Appointment confirmed</h2>
                  <p className="mt-0.5 text-[12px] text-slate-500 sm:text-[13px]">{booked.title} · {fmtDate(booked.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtTime(booked.time)}</p>
                </div>
                <div className="mx-auto grid w-full max-w-xs grid-cols-2 divide-x divide-emerald-200 rounded-xl border border-dashed border-emerald-300 bg-emerald-50">
                  <div className="px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Appointment ID</p>
                    <p className="mt-1 font-mono text-[15px] font-bold text-emerald-800">{booked.ref}</p>
                  </div>
                  <div className="px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Clinic queue no.</p>
                    <p className="text-2xl font-black leading-tight text-emerald-700">{booked.token}</p>
                  </div>
                </div>
                <p className="mx-auto max-w-sm text-[12px] text-slate-600 sm:text-[13px]">
                  {booked.whatsappSent
                    ? 'Confirmation sent to your WhatsApp. You will also get reminders before your visit.'
                    : consent && hasPhone
                      ? 'Your booking is saved. WhatsApp confirmation will follow shortly.'
                      : 'Your booking is saved. Please note your Appointment ID. You won’t receive WhatsApp updates.'}
                </p>
                <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-center">
                  <button
                    type="button"
                    onClick={() => downloadIcs({ title: booked.title, date: booked.date, time: booked.time, minutes: service?.duration || 30, location: profile.address, ref: booked.ref, clinic: profile.name })}
                    className={ghostBtn}
                  >
                    <CalendarPlus className="size-3.5" /> Add to calendar
                  </button>
                  {waNumber && consent && hasPhone && !booked.whatsappSent && (
                    <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hi, I just booked an appointment. Appointment ID ${booked.ref}, clinic queue no. ${booked.token}.`)}`} className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#25D366] px-4 text-[13px] font-semibold text-white hover:brightness-95">
                      <WhatsAppIcon className="size-4" /> Message us on WhatsApp
                    </a>
                  )}
                  <button type="button" onClick={bookAnother} className={ghostBtn}><RotateCcw className="size-3.5" /> Book another</button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Summary + clinic info */}
        <aside className="space-y-3 lg:sticky lg:top-16">
          {step !== 'done' && (doctor || service || date) && (
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Your appointment</p>
              <div className="mt-2 space-y-1.5 text-[13px]">
                {doctor && <SummaryRow icon={Stethoscope} value={drName(doctor.name)} sub={doctor.specialization || doctor.department} />}
                {service && <SummaryRow icon={Stethoscope} value={service.name} sub={`${service.duration} min`} />}
                {date && <SummaryRow icon={CalendarDays} value={fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} />}
                {time && <SummaryRow icon={Clock} value={fmtTime(time)} />}
              </div>
              {fee > 0 && (
                <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[13px]">
                  <span className="text-slate-500">{isClinic ? 'Consultation fee' : 'Price'}</span>
                  <span className="font-semibold">{money(fee)}</span>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">About</p>
            <p className="mt-1 text-[13px] font-semibold">{profile.name}</p>
            {profile.description && <p className="mt-1 line-clamp-4 text-[12px] leading-relaxed text-slate-600">{profile.description}</p>}
            <div className="mt-2.5 space-y-1.5 text-[12px] text-slate-600">
              {profile.address && (
                <a href={mapHref ?? undefined} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 hover:text-emerald-700">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> <span>{profile.address}</span>
                </a>
              )}
              {profile.phone && phoneHref && (
                <a href={phoneHref} className="flex items-center gap-1.5 hover:text-emerald-700"><Phone className="size-3.5 shrink-0 text-emerald-600" /> {profile.phone}</a>
              )}
            </div>
            <Hours timings={profile.timings} today={today} />
          </div>

          <p className="text-center text-[11px] text-slate-400">Powered by ChatNexGen</p>
        </aside>
      </div>
    </main>
  );
}

/** Uploaded clinic logo, falling back to initials if there is none or it fails to load. */
function ClinicLogo({ name, src }: { name: string; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-0.5 sm:size-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${name} logo`} className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-[12px] font-bold text-white sm:size-9 sm:text-[13px]">{initials(name)}</span>;
}

/** Official WhatsApp glyph (brand mark), drawn in currentColor. */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function StepTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-[14px] font-semibold sm:text-[15px]">{title}</h2>
      <p className="text-[11px] text-slate-500 sm:text-[12px]">{sub}</p>
    </div>
  );
}

function Field({ id, label, required, optional, error, hint, className, children }: { id: string; label: string; required?: boolean; optional?: boolean; error?: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 space-y-1 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-700 sm:text-[12px]">
        <label id={`${id}-label`} htmlFor={id}>
          {label} {required && <span className="text-red-500">*</span>} {optional && <span className="font-normal text-slate-400">(optional)</span>}
        </label>
        {hint && <span className="font-normal text-slate-400">{hint}</span>}
      </div>
      {children}
      {error && <span className="block text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

function IconInput({ icon: Icon, children }: { icon: typeof User; children: React.ReactNode }) {
  return (
    <span className="relative block">
      <Icon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400 sm:left-2.5" />
      {children}
    </span>
  );
}

function DoctorCard({ d, className }: { d: Doctor; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 ${className ?? ''}`}>
      {d.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.photo} alt="" className="size-9 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[12px] font-semibold text-emerald-700">{initials(d.name)}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{drName(d.name)}</p>
        <p className="truncate text-[11px] text-slate-500">{[d.specialization || d.department, d.qualification, d.experience].filter(Boolean).join(' · ')}</p>
        {d.languages && <p className="truncate text-[11px] text-slate-400">Speaks {d.languages}</p>}
      </div>
      {d.fee > 0 && <span className="shrink-0 text-[13px] font-semibold text-emerald-700">{money(d.fee)}</span>}
    </div>
  );
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <div className="flex items-start gap-2 px-2.5 py-1.5 sm:px-3 sm:py-2">
      <dt className="w-[4.5rem] shrink-0 text-slate-500 sm:w-24">{label}</dt>
      <dd className="min-w-0 flex-1 break-words font-medium">{value}</dd>
      {onEdit && <button type="button" onClick={onEdit} className="shrink-0 text-[12px] font-medium text-emerald-700 hover:underline">Edit</button>}
    </div>
  );
}

function SummaryRow({ icon: Icon, value, sub }: { icon: typeof Clock; value: string; sub?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
      <div className="min-w-0">
        <p className="truncate font-medium">{value}</p>
        {sub && <p className="truncate text-[11px] text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

function Hours({ timings, today }: { timings?: Timing[]; today: string }) {
  if (!timings?.length) return null;
  const todayName = fmtDate(today, { weekday: 'long' });
  const sorted = [...timings].sort((a, b) => WEEK.indexOf(a.day) - WEEK.indexOf(b.day));
  return (
    <div className="mt-2.5 border-t border-slate-100 pt-2">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500"><Clock className="size-3.5" /> Opening hours</p>
      <ul className="space-y-0.5 text-[12px]">
        {sorted.map((t) => (
          <li key={t.day} className={`flex justify-between gap-2 ${t.day === todayName ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
            <span>{t.day.slice(0, 3)}{t.day === todayName ? ' (today)' : ''}</span>
            <span>{t.closed || !t.open || !t.close ? 'Closed' : `${fmtTime(t.open)} – ${fmtTime(t.close)}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
