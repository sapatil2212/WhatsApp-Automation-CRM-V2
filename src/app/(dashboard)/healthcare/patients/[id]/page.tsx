'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Activity, AlertTriangle, ArrowLeft, CalendarClock, Download, Eye, FileText, HeartPulse, Loader2, Pill, Printer,
  Save, Send, ShieldAlert, Stethoscope, Trash2, Upload, Undo2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { api } from '@/lib/campaigns/api';

type Tab = 'overview' | 'profile' | 'consultations' | 'vitals' | 'medications' | 'prescriptions' | 'appointments' | 'investigations' | 'documents' | 'timeline' | 'communications';
interface Profile { patientCode: string; gender: string | null; dateOfBirth: string | null; ageYears: number | null; bloodGroup: string | null; allergies: string | null; conditions: string | null; medications: string | null; surgicalHistory: string | null; familyHistory: string | null; emergencyName: string | null; emergencyPhone: string | null; notes: string | null; updatedAt: string }
type Vitals = Partial<Record<'bp' | 'pulse' | 'temperature' | 'spo2' | 'respiratoryRate' | 'heightCm' | 'weightKg' | 'bmi', string>>;
interface Med { name: string; strength: string; dosage: string; frequency: string; timing: string; duration: string; instructions: string }
interface Record_ {
  contactId: string; name: string; phone: string | null; email: string | null; whatsappConsent: boolean; registeredAt: string; age: string | null; gender: string | null;
  profile: Profile | null;
  consultations: Array<{ id: string; status: string; date: string; doctor: string | null; department: string | null; complaint: string; diagnoses: string[]; vitals: Vitals; notes: string; treatmentPlan: string; investigations: string[]; followUpDate: string | null }>;
  prescriptions: Array<{ id: string; number: string; date: string | null; doctor: string | null; diagnoses: string[]; medicineCount: number; medicines: Med[]; deliveryStatus: string; deliveryError: string | null }>;
  appointments: Array<{ id: string; ref: string | null; date: string; time: string; status: string; doctor: string | null }>;
  nextAppointment: { id: string; date: string; time: string; doctor: string | null } | null;
  problems: Array<{ label: string; count: number; first: string; last: string }>;
  investigations: Array<{ test: string; orderedAt: string; doctor: string | null; consultationId: string }>;
  documents: Array<{ id: string; kind: string; title: string; fileName: string; mimeType: string; size: number; createdAt: string }>;
  intakes: Array<{ id: string; symptoms: string | null; allergies: string | null; currentMedications: string | null; medicalHistory: string | null; urgencyLevel: string | null; createdAt: string }>;
  communications: Array<{ id: string; eventType: string; channel: string; status: string; templateName: string | null; errorMessage: string | null; createdAt: string }>;
  timeline: Array<{ at: string; kind: string; text: string }>;
}

const DOC_KINDS: Record<string, string> = { prescription: 'Previous prescription', lab_report: 'Lab report', scan: 'Scan report', discharge: 'Discharge summary', medical_report: 'Medical report', other: 'Other' };
const VITALS: Array<{ key: keyof Vitals; label: string; unit: string }> = [
  { key: 'bp', label: 'BP', unit: 'mmHg' },
  { key: 'pulse', label: 'Pulse', unit: 'bpm' },
  { key: 'temperature', label: 'Temp', unit: '°F' },
  { key: 'spo2', label: 'SpO₂', unit: '%' },
  { key: 'respiratoryRate', label: 'Resp.', unit: '/min' },
  { key: 'weightKg', label: 'Weight', unit: 'kg' },
  { key: 'heightCm', label: 'Height', unit: 'cm' },
  { key: 'bmi', label: 'BMI', unit: '' },
];
const APPT_STATUS: Record<string, string> = { scheduled: 'bg-sky-500/10 text-sky-700 dark:text-sky-400', completed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', cancelled: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', no_show: 'bg-muted text-muted-foreground' };
const fmt = (iso?: string | null, time = false) => (iso ? new Date(iso).toLocaleString('en-IN', time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : '—');
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const field = 'h-8 text-[13px] md:text-[13px]';
const selectCls = 'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
const EDITABLE: Array<keyof Profile> = ['gender', 'dateOfBirth', 'ageYears', 'bloodGroup', 'allergies', 'conditions', 'medications', 'surgicalHistory', 'familyHistory', 'emergencyName', 'emergencyPhone', 'notes'];

/** Age from date of birth, so the record never shows a stale typed age. */
function ageFrom(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}

export default function PatientRecordPage() {
  const { id } = useParams<{ id: string }>();
  const [rec, setRec] = useState<Record_ | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [form, setForm] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);
  const [openConsult, setOpenConsult] = useState<string | null>(null);

  useEffect(() => {
    // Deep link from the list ("Edit medical profile").
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'profile') setTab('profile');
  }, []);

  const load = useCallback(async () => {
    try {
      const r = (await api<Record_>(`/api/healthcare/patients/${id}`)).data;
      setRec(r);
      setForm(r.profile ?? {});
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    let live = true;
    api<Record_>(`/api/healthcare/patients/${id}`)
      .then((r) => { if (live) { setRec(r.data); setForm(r.data.profile ?? {}); } })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);

  const dirty = useMemo(() => {
    const base = rec?.profile ?? ({} as Partial<Profile>);
    return EDITABLE.some((k) => String(form[k] ?? '') !== String(base[k] ?? ''));
  }, [form, rec]);

  // Warn before leaving with unsaved medical edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      for (const k of EDITABLE) {
        const v = form[k];
        body[k] = v === '' || v === undefined ? null : v;
      }
      body.ageYears = form.ageYears != null && String(form.ageYears) !== '' ? Number(form.ageYears) : ageFrom(form.dateOfBirth);
      await api(`/api/healthcare/patients/${id}`, { method: 'PATCH', json: body });
      toast.success('Health record saved.');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const latestVitals = useMemo(() => {
    const out: Vitals & { at?: string } = {};
    for (const c of rec?.consultations ?? []) {
      for (const v of VITALS) if (!out[v.key] && c.vitals?.[v.key]) out[v.key] = c.vitals[v.key];
      if (!out.at && Object.values(c.vitals ?? {}).some(Boolean)) out.at = c.date;
    }
    return out;
  }, [rec]);
  const currentMeds = rec?.prescriptions[0]?.medicines ?? [];

  if (error) return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm">{error} <Link href="/healthcare/patients" className="ml-2 text-primary underline">Back to patients</Link></div>;
  if (!rec) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/60" />)}</div>;

  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const age = ageFrom(rec.profile?.dateOfBirth) ?? (rec.age ? Number(rec.age) : null);
  const completed = rec.consultations.filter((c) => c.status === 'completed');

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'profile', label: 'Medical profile' },
    { id: 'consultations', label: 'Consultations', count: rec.consultations.length },
    { id: 'vitals', label: 'Vitals' },
    { id: 'medications', label: 'Medications' },
    { id: 'prescriptions', label: 'Prescriptions', count: rec.prescriptions.length },
    { id: 'appointments', label: 'Appointments', count: rec.appointments.length },
    { id: 'investigations', label: 'Investigations', count: rec.investigations.length },
    { id: 'documents', label: 'Documents', count: rec.documents.length },
    { id: 'timeline', label: 'Timeline' },
    { id: 'communications', label: 'Communication' },
  ];

  const printSummary = () => {
    const p = rec.profile;
    const row = (k: string, v: unknown) => (v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : '');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(rec.name)} — Patient summary</title>
<style>body{font:13px/1.45 system-ui,sans-serif;color:#0f172a;margin:28px}h1{font-size:20px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#475569;margin:20px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:3px 8px 3px 0;vertical-align:top}th{color:#64748b;font-weight:500;width:170px}.alert{background:#fff1f2;color:#be123c;padding:6px 10px;border-radius:6px;margin-top:10px}.muted{color:#64748b}ul{margin:0;padding-left:18px}@media print{body{margin:12mm}}</style></head><body>
<h1>${esc(rec.name)}</h1><div class="muted">${esc(p?.patientCode ?? '')} · ${esc([age != null && `${age} yrs`, rec.gender?.replace(/_/g, ' ')].filter(Boolean).join(' / '))} · ${esc(rec.phone ? `+${rec.phone}` : '')} · printed ${esc(new Date().toLocaleString('en-IN'))}</div>
${p?.allergies ? `<div class="alert"><b>Allergies:</b> ${esc(p.allergies)}</div>` : ''}
<h2>Medical profile</h2><table>${row('Blood group', p?.bloodGroup)}${row('Date of birth', p?.dateOfBirth)}${row('Conditions', p?.conditions)}${row('Current medications', p?.medications)}${row('Surgical history', p?.surgicalHistory)}${row('Family history', p?.familyHistory)}${row('Emergency contact', [p?.emergencyName, p?.emergencyPhone].filter(Boolean).join(' · '))}</table>
${rec.problems.length ? `<h2>Problem list</h2><ul>${rec.problems.map((x) => `<li>${esc(x.label)} <span class="muted">(${x.count}×, last ${esc(fmt(x.last))})</span></li>`).join('')}</ul>` : ''}
${latestVitals.at ? `<h2>Latest vitals (${esc(fmt(latestVitals.at))})</h2><table>${VITALS.map((v) => row(v.label, latestVitals[v.key] ? `${latestVitals[v.key]} ${v.unit}` : '')).join('')}</table>` : ''}
${currentMeds.length ? `<h2>Last prescription (${esc(rec.prescriptions[0].number)})</h2><ul>${currentMeds.map((m) => `<li>${esc([m.name, m.strength].filter(Boolean).join(' '))} — ${esc([m.dosage, m.frequency, m.timing, m.duration].filter(Boolean).join(', '))}</li>`).join('')}</ul>` : ''}
<h2>Consultations</h2><table>${completed.slice(0, 15).map((c) => `<tr><th>${esc(fmt(c.date))}</th><td>${esc(c.doctor ?? '')}${c.complaint ? ` — ${esc(c.complaint)}` : ''}${c.diagnoses.length ? `<br><span class="muted">${esc(c.diagnoses.join(', '))}</span>` : ''}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table>
<script>window.onload=()=>window.print()</script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return toast.error('Allow pop-ups to print the summary.');
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon-sm" className="mt-1" render={<Link href="/healthcare/patients" aria-label="Back to patients" />}><ArrowLeft className="size-4" /></Button>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight">{rec.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono text-[12px]">{rec.profile?.patientCode ?? 'No patient ID yet'}</span>
              <span>·</span>
              <span>{[age != null && `${age} yrs`, rec.gender?.replace(/_/g, ' ')].filter(Boolean).join(' / ') || '—'}</span>
              <span>·</span>
              <span className="font-mono text-[12px]">{rec.phone ? `+${rec.phone}` : 'no phone'}</span>
              {rec.profile?.bloodGroup && <span className="rounded bg-rose-500/10 px-1.5 py-px text-[11px] font-semibold text-rose-700 dark:text-rose-300">{rec.profile.bloodGroup}</span>}
              {!rec.whatsappConsent && <span className="rounded bg-amber-500/10 px-1.5 py-px text-[11px] text-amber-700 dark:text-amber-300">No WhatsApp consent</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={printSummary}><Printer className="size-3.5" /> Print summary</Button>
          <Button size="sm" className="gap-1.5" onClick={() => setTab('profile')}><HeartPulse className="size-3.5" /> Update record</Button>
        </div>
      </div>

      {/* Clinical alerts */}
      {(rec.profile?.allergies || rec.profile?.conditions) && (
        <div className="flex flex-wrap gap-2">
          {rec.profile?.allergies && <p className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] font-medium text-rose-700 dark:text-rose-300"><ShieldAlert className="size-4 shrink-0" /> Allergies: {rec.profile.allergies}</p>}
          {rec.profile?.conditions && <p className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-800 dark:text-amber-300"><AlertTriangle className="size-4 shrink-0" /> Conditions: {rec.profile.conditions}</p>}
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Visits', value: String(completed.length), icon: Stethoscope },
          { label: 'Last visit', value: completed[0] ? fmt(completed[0].date) : '—', icon: Activity },
          { label: 'Next appointment', value: rec.nextAppointment ? `${fmtDay(rec.nextAppointment.date)} · ${fmtTime(rec.nextAppointment.time)}` : '—', icon: CalendarClock },
          { label: 'Prescriptions', value: String(rec.prescriptions.length), icon: Pill },
          { label: 'Documents', value: String(rec.documents.length), icon: FileText },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><s.icon className="size-3.5" /></span>
            </div>
            <p className="mt-1 truncate text-[15px] font-bold leading-tight tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-0.5 rounded-xl border border-border/70 bg-card p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
            {t.label}
            {t.count !== undefined && <span className="opacity-70">{t.count}</span>}
            {t.id === 'profile' && dirty && <span className="size-1.5 rounded-full bg-amber-500" aria-label="Unsaved changes" />}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Problem list" empty={!rec.problems.length && 'No diagnoses recorded yet.'}>
            <ul className="divide-y divide-border/60">
              {rec.problems.map((p) => (
                <li key={p.label} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                  <span className="truncate">{p.label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{p.count}× · last {fmt(p.last)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={latestVitals.at ? `Latest vitals · ${fmt(latestVitals.at)}` : 'Latest vitals'} empty={!latestVitals.at && 'No vitals recorded yet.'}>
            <div className="grid grid-cols-4 gap-2">
              {VITALS.filter((v) => latestVitals[v.key]).map((v) => (
                <div key={v.key} className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{v.label}</p>
                  <p className="text-[13px] font-semibold tabular-nums">{latestVitals[v.key]} <span className="text-[10px] font-normal text-muted-foreground">{v.unit}</span></p>
                </div>
              ))}
            </div>
          </Card>
          <Card title={rec.prescriptions[0] ? `Current medications · ${rec.prescriptions[0].number}` : 'Current medications'} empty={!currentMeds.length && !rec.profile?.medications && 'No medications recorded.'}>
            <MedList meds={currentMeds} />
            {rec.profile?.medications && <p className="mt-2 border-t border-border/60 pt-2 text-[12px] text-muted-foreground">Patient-reported: {rec.profile.medications}</p>}
          </Card>
          <Card title="Medical history" empty={!rec.profile?.surgicalHistory && !rec.profile?.familyHistory && !rec.profile?.notes && 'Nothing recorded yet.'}>
            <dl className="space-y-1.5 text-[13px]">
              {rec.profile?.surgicalHistory && <div><dt className="text-[11px] text-muted-foreground">Surgical history</dt><dd>{rec.profile.surgicalHistory}</dd></div>}
              {rec.profile?.familyHistory && <div><dt className="text-[11px] text-muted-foreground">Family history</dt><dd>{rec.profile.familyHistory}</dd></div>}
              {rec.profile?.notes && <div><dt className="text-[11px] text-muted-foreground">Notes</dt><dd className="whitespace-pre-line">{rec.profile.notes}</dd></div>}
              {(rec.profile?.emergencyName || rec.profile?.emergencyPhone) && <div><dt className="text-[11px] text-muted-foreground">Emergency contact</dt><dd>{[rec.profile?.emergencyName, rec.profile?.emergencyPhone].filter(Boolean).join(' · ')}</dd></div>}
            </dl>
          </Card>
          {rec.intakes.length > 0 && (
            <Card title="Patient-reported intake (WhatsApp)" className="lg:col-span-2">
              <ul className="divide-y divide-border/60">
                {rec.intakes.slice(0, 5).map((i) => (
                  <li key={i.id} className="grid gap-x-4 gap-y-0.5 py-2 text-[12px] sm:grid-cols-[120px_1fr]">
                    <span className="text-muted-foreground">{fmt(i.createdAt)}{i.urgencyLevel && <span className={`ml-1 rounded px-1 text-[10px] ${i.urgencyLevel === 'emergency' || i.urgencyLevel === 'urgent' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-muted'}`}>{i.urgencyLevel.replace(/_/g, ' ')}</span>}</span>
                    <span>{[i.symptoms && `Symptoms: ${i.symptoms}`, i.allergies && `Allergies: ${i.allergies}`, i.currentMedications && `Medications: ${i.currentMedications}`, i.medicalHistory && `History: ${i.medicalHistory}`].filter(Boolean).join(' · ') || '—'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === 'profile' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Personal & contact">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gender"><select className={selectCls} value={form.gender ?? ''} onChange={set('gender')}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select></Field>
              <Field label="Blood group"><select className={selectCls} value={form.bloodGroup ?? ''} onChange={set('bloodGroup')}><option value="">—</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b}>{b}</option>)}</select></Field>
              <Field label="Date of birth"><Input type="date" className={field} value={form.dateOfBirth ?? ''} max={new Date().toISOString().slice(0, 10)} onChange={set('dateOfBirth')} /></Field>
              <Field label={ageFrom(form.dateOfBirth) != null ? `Age (from DOB: ${ageFrom(form.dateOfBirth)})` : 'Age (years)'}><Input className={field} inputMode="numeric" value={form.ageYears ?? ''} placeholder={ageFrom(form.dateOfBirth) != null ? String(ageFrom(form.dateOfBirth)) : ''} onChange={(e) => setForm({ ...form, ageYears: e.target.value.replace(/\D/g, '').slice(0, 3) as unknown as number })} /></Field>
              <Field label="Emergency contact"><Input className={field} value={form.emergencyName ?? ''} onChange={set('emergencyName')} /></Field>
              <Field label="Emergency phone"><Input className={field} value={form.emergencyPhone ?? ''} onChange={set('emergencyPhone')} inputMode="tel" /></Field>
              <p className="col-span-2 text-[11px] text-muted-foreground">Email: {rec.email ?? '—'} · Registered {fmt(rec.registeredAt)}{rec.profile?.updatedAt ? ` · Record updated ${fmt(rec.profile.updatedAt, true)}` : ''}</p>
            </div>
          </Card>
          <Card title="Medical information">
            <div className="space-y-2.5">
              {([['allergies', 'Allergies', 'e.g. Penicillin (rash), peanuts'], ['conditions', 'Chronic conditions', 'e.g. Type 2 diabetes, hypertension'], ['medications', 'Current medications (patient-reported)', 'e.g. Metformin 500 mg twice daily'], ['surgicalHistory', 'Surgical history', ''], ['familyHistory', 'Family history', ''], ['notes', 'Clinical notes', '']] as const).map(([k, l, ph]) => (
                <Field key={k} label={l}><Textarea rows={2} className="text-[13px] md:text-[13px]" placeholder={ph} value={form[k] ?? ''} onChange={set(k)} /></Field>
              ))}
            </div>
          </Card>
          <div className="flex items-center justify-end gap-2 lg:col-span-2">
            {dirty && <span className="mr-auto text-[12px] text-amber-700 dark:text-amber-300">Unsaved changes</span>}
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!dirty || saving} onClick={() => setForm(rec.profile ?? {})}><Undo2 className="size-3.5" /> Discard</Button>
            <Button size="sm" onClick={saveProfile} disabled={saving || !dirty} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save record</Button>
          </div>
        </div>
      )}

      {tab === 'consultations' && (
        <ul className="space-y-2">
          {rec.consultations.length === 0 && <Empty text="No consultations yet." />}
          {rec.consultations.map((c) => (
            <li key={c.id} className="overflow-hidden rounded-xl border border-border/70 bg-card">
              <button type="button" onClick={() => setOpenConsult(openConsult === c.id ? null : c.id)} aria-expanded={openConsult === c.id} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-muted/30">
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{fmt(c.date)} · {c.doctor ?? '—'}{c.department ? ` (${c.department})` : ''}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{c.complaint || 'No complaint recorded'}{c.diagnoses.length ? ` — ${c.diagnoses.join(', ')}` : ''}</span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${c.status === 'completed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : c.status === 'cancelled' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>{c.status === 'completed' ? 'Completed' : c.status === 'cancelled' ? 'Cancelled' : 'In progress'}</span>
              </button>
              {openConsult === c.id && (
                <div className="grid gap-2 border-t border-border/60 bg-muted/20 px-4 py-3 text-[13px] sm:grid-cols-2">
                  <p><span className="text-muted-foreground">Vitals: </span>{VITALS.filter((v) => c.vitals?.[v.key]).map((v) => `${v.label} ${c.vitals[v.key]}`).join(' · ') || '—'}</p>
                  <p><span className="text-muted-foreground">Follow-up: </span>{c.followUpDate ? fmtDay(c.followUpDate) : '—'}</p>
                  <p className="sm:col-span-2"><span className="text-muted-foreground">Clinical notes: </span>{c.notes || '—'}</p>
                  <p className="sm:col-span-2"><span className="text-muted-foreground">Treatment plan: </span>{c.treatmentPlan || '—'}</p>
                  {c.investigations.length > 0 && <p className="sm:col-span-2"><span className="text-muted-foreground">Investigations: </span>{c.investigations.join(', ')}</p>}
                  <Link href={`/healthcare/consultations/${c.id}`} className="text-[12px] font-medium text-primary hover:underline">Open full consultation →</Link>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === 'vitals' && <VitalsTab rec={rec} />}

      {tab === 'medications' && (
        <div className="space-y-3">
          {rec.prescriptions.length === 0 ? <Empty text="No prescribed medications yet." /> : rec.prescriptions.map((p, i) => (
            <Card key={p.id} title={`${fmt(p.date)} · ${p.number}${p.doctor ? ` · ${p.doctor}` : ''}${i === 0 ? ' · current' : ''}`}>
              <MedList meds={p.medicines} />
            </Card>
          ))}
        </div>
      )}

      {tab === 'prescriptions' && <PrescriptionsTab rec={rec} onChanged={load} />}

      {tab === 'appointments' && (
        <TableCard empty={!rec.appointments.length && 'No appointments yet.'}>
          <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Date</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Doctor</th><th className="px-3 py-2">Booking ID</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody className="divide-y divide-border/60">
            {rec.appointments.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2">{fmtDay(a.date)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtTime(a.time)}</td>
                <td className="px-3 py-2">{a.doctor ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[11px]">{a.ref ?? '—'}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${APPT_STATUS[a.status] ?? 'bg-muted'}`}>{a.status.replace(/_/g, '-')}</span></td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {tab === 'investigations' && (
        <TableCard empty={!rec.investigations.length && 'No investigations ordered yet.'} footer="Upload lab results in the Documents tab (type “Lab report”).">
          <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Test</th><th className="px-3 py-2">Ordered</th><th className="px-3 py-2">Doctor</th><th className="px-3 py-2" /></tr></thead>
          <tbody className="divide-y divide-border/60">
            {rec.investigations.map((i, n) => (
              <tr key={n}>
                <td className="px-4 py-2">{i.test}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmt(i.orderedAt)}</td>
                <td className="px-3 py-2">{i.doctor ?? '—'}</td>
                <td className="px-3 py-2 text-right"><Link href={`/healthcare/consultations/${i.consultationId}`} className="text-[12px] text-primary hover:underline">Consultation →</Link></td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {tab === 'documents' && <DocumentsTab rec={rec} onChanged={load} />}

      {tab === 'timeline' && (
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <ol className="relative space-y-3 border-l border-border pl-5">
            {rec.timeline.map((t, i) => (
              <li key={i} className="text-[13px]">
                <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-card bg-primary" />
                <p>{t.text}</p>
                <p className="text-[11px] text-muted-foreground">{fmt(t.at, true)}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === 'communications' && (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
          {rec.communications.length === 0 ? <Empty text="No WhatsApp messages yet." /> : (
            <ul className="divide-y divide-border/60">
              {rec.communications.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                  <span><span className="capitalize">{c.eventType.replace(/_/g, ' ')}</span> <span className="text-[11px] text-muted-foreground">· {c.channel === 'template' ? `template ${c.templateName}` : c.channel === 'text' ? 'message' : '—'} · {fmt(c.createdAt, true)}</span>{c.errorMessage && c.status !== 'sent' && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{c.errorMessage}</span>}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${c.status === 'sent' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : c.status === 'failed' || c.status === 'blocked_no_template' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400' : 'bg-muted text-muted-foreground'}`}>{c.status.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ title, children, empty, className = '' }: { title: string; children?: React.ReactNode; empty?: string | false; className?: string }) {
  return (
    <section className={`rounded-xl border border-border/70 bg-card p-4 ${className}`}>
      <h2 className="mb-2.5 text-[13px] font-semibold">{title}</h2>
      {empty ? <p className="text-[12px] text-muted-foreground">{empty}</p> : children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-[11px] font-medium text-muted-foreground">{label}</span>{children}</label>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-[13px] text-muted-foreground">{text}</p>;
}

function TableCard({ children, empty, footer }: { children: React.ReactNode; empty?: string | false; footer?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
      {empty ? <p className="p-8 text-center text-[13px] text-muted-foreground">{empty}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[13px]">{children}</table></div>}
      {footer && <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">{footer}</p>}
    </div>
  );
}

function MedList({ meds }: { meds: Med[] }) {
  if (!meds.length) return null;
  return (
    <ul className="divide-y divide-border/60">
      {meds.map((m, i) => (
        <li key={i} className="py-1.5 text-[13px]">
          <span className="font-medium">{[m.name, m.strength].filter(Boolean).join(' ')}</span>
          <span className="block text-[11px] text-muted-foreground">{[m.dosage, m.frequency, m.timing, m.duration].filter(Boolean).join(' · ') || '—'}{m.instructions ? ` · ${m.instructions}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

function VitalsTab({ rec }: { rec: Record_ }) {
  const rows = rec.consultations.filter((c) => Object.values(c.vitals ?? {}).some(Boolean));
  if (!rows.length) return <Empty text="No vitals recorded yet. They are captured during consultations." />;
  const cols = VITALS.filter((v) => rows.some((r) => r.vitals?.[v.key]));
  const num = (s?: string) => { const n = parseFloat(String(s ?? '').split('/')[0]); return Number.isFinite(n) ? n : null; };
  /** Change since the previous reading, so trends are visible at a glance. */
  const trend = (i: number, key: keyof Vitals) => {
    const cur = num(rows[i].vitals?.[key]);
    const prev = rows.slice(i + 1).map((r) => num(r.vitals?.[key])).find((v) => v !== null) ?? null;
    if (cur === null || prev === null || cur === prev) return null;
    return cur > prev ? '↑' : '↓';
  };
  return (
    <TableCard footer="Arrows compare with the previous recorded reading. BP trend uses the systolic value.">
      <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <tr><th className="px-4 py-2">Date</th>{cols.map((c) => <th key={c.key} className="px-3 py-2">{c.label}{c.unit && <span className="ml-0.5 normal-case opacity-70">({c.unit})</span>}</th>)}<th className="px-3 py-2">Doctor</th></tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {rows.map((r, i) => (
          <tr key={r.id}>
            <td className="px-4 py-2 whitespace-nowrap">{fmt(r.date)}</td>
            {cols.map((c) => (
              <td key={c.key} className="px-3 py-2 tabular-nums">
                {r.vitals?.[c.key] ?? '—'}
                {trend(i, c.key) && <span className="ml-1 text-[11px] text-muted-foreground">{trend(i, c.key)}</span>}
              </td>
            ))}
            <td className="px-3 py-2 text-[12px]">{r.doctor ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

function PrescriptionsTab({ rec, onChanged }: { rec: Record_; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const resend = async (id: string) => {
    setBusy(id);
    try {
      const r = await api<{ status: string; message: string }>(`/api/healthcare/prescriptions/${id}/send`, { method: 'POST' });
      if (r.data.status === 'sent') toast.success(r.data.message);
      else toast.warning(r.data.message, { duration: 10000 });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (!rec.prescriptions.length) return <Empty text="No prescriptions yet." />;
  return (
    <TableCard>
      <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Prescription</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Doctor</th><th className="px-3 py-2">Diagnosis</th><th className="px-3 py-2">Medicines</th><th className="px-3 py-2">WhatsApp</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
      <tbody className="divide-y divide-border/60">
        {rec.prescriptions.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-2 font-mono text-[11px]">{p.number}</td>
            <td className="px-3 py-2">{fmt(p.date)}</td>
            <td className="px-3 py-2">{p.doctor ?? '—'}</td>
            <td className="px-3 py-2 text-[12px]">{p.diagnoses.join(', ') || '—'}</td>
            <td className="px-3 py-2 tabular-nums">{p.medicineCount}</td>
            <td className="px-3 py-2 text-[12px] capitalize" title={p.deliveryError ?? undefined}>{p.deliveryStatus.replace(/_/g, ' ')}</td>
            <td className="px-3 py-2">
              <div className="flex justify-end gap-0.5">
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-primary" title="View PDF" aria-label="View PDF" render={<a href={`/api/healthcare/prescriptions/${p.id}/pdf`} target="_blank" rel="noreferrer" />}><Eye className="size-3.5" /></Button>
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-primary" title="Download PDF" aria-label="Download PDF" render={<a href={`/api/healthcare/prescriptions/${p.id}/pdf?download=1`} />}><Download className="size-3.5" /></Button>
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-primary" title="Send on WhatsApp" aria-label="Send on WhatsApp" disabled={busy === p.id} onClick={() => resend(p.id)}>{busy === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}</Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

function DocumentsTab({ rec, onChanged }: { rec: Record_; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('lab_report');
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState('');
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<Record_['documents'][number] | null>(null);
  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) return toast.error('Files must be 8 MB or smaller.');
    setUploading(true);
    try {
      await api(`/api/healthcare/patients/${rec.contactId}/documents`, { method: 'POST', json: { kind, title: title.trim() || file.name, fileName: file.name, mimeType: file.type, dataBase64: await toBase64(file) } });
      toast.success('Document uploaded.');
      setTitle('');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const docs = filter ? rec.documents.filter((d) => d.kind === filter) : rec.documents;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border/70 bg-card p-3">
        <Field label="Type"><select className={`${selectCls} w-44`} value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <div className="min-w-[200px] flex-1"><Field label="Title"><Input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CBC report 12 Nov" /></Field></div>
        <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-1.5">{uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Upload</Button>
        <p className="w-full text-[11px] text-muted-foreground">PDF or image, up to 8 MB. Stored privately; only signed-in clinic staff can open them, and every access is logged.</p>
      </div>
      {rec.documents.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {[['', 'All'], ...Object.entries(DOC_KINDS)].filter(([k]) => !k || rec.documents.some((d) => d.kind === k)).map(([k, l]) => (
            <button key={k || 'all'} type="button" onClick={() => setFilter(k)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${filter === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}>
              {l} <span className="opacity-70">{k ? rec.documents.filter((d) => d.kind === k).length : rec.documents.length}</span>
            </button>
          ))}
        </div>
      )}
      {docs.length === 0 ? <Empty text="No documents yet." /> : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <span className="flex min-w-0 items-center gap-3"><FileText className="size-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block truncate font-medium">{d.title}</span><span className="block text-[11px] text-muted-foreground">{DOC_KINDS[d.kind] ?? d.kind} · {(d.size / 1024).toFixed(0)} KB · {fmt(d.createdAt)}</span></span></span>
              <span className="flex gap-0.5">
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-primary" title="Open" aria-label="Open" render={<a href={`/api/healthcare/documents/${d.id}`} target="_blank" rel="noreferrer" />}><Eye className="size-3.5" /></Button>
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download" render={<a href={`/api/healthcare/documents/${d.id}?download=1`} />}><Download className="size-3.5" /></Button>
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remove" aria-label="Remove" onClick={() => setRemoving(d)}><Trash2 className="size-3.5" /></Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmationDialog
        isOpen={Boolean(removing)}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title="Remove this document?"
        description="It is removed from the patient's record."
        details={removing ? <div><p className="truncate font-semibold">{removing.title}</p><p className="text-[12px] text-muted-foreground">{DOC_KINDS[removing.kind] ?? removing.kind} · {fmt(removing.createdAt)}</p></div> : null}
        notes={['The removal is logged with your name.']}
        confirmText="Remove"
        variant="destructive"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api(`/api/healthcare/documents/${removing.id}`, { method: 'DELETE' });
            toast.success('Document removed.');
            setRemoving(null);
            onChanged();
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }}
      />
    </div>
  );
}
