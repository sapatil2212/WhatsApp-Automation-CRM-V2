'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ClipboardList, Copy, Download, Eye, FileText, Info, Loader2, Mic, Plus, Printer,
  Pencil, Save, Send, ShieldCheck, Sparkles, Trash2, X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { VoiceRxModal, type Suggestion } from '@/components/consultation/voice-dictation';
import { AiPrescriptionModal } from '@/components/consultation/ai-prescription-modal';
import { api } from '@/lib/campaigns/api';
import { autoQuantity, bmi, checkFinalize, COMMON_ICD10, newId, type Advice, type ChiefComplaint, type Diagnosis, type MedicineLine, type Vitals } from '@/lib/healthcare/prescription';

interface Workspace {
  id: string;
  status: string;
  revision: number;
  startedAt: string;
  appointment: { id: string; ref: string; date: string; time: string; department: string | null };
  patient: { contactId: string; name: string; code: string | null; age: string | null; gender: string | null; phone: string | null; bloodGroup: string | null; allergies: string | null; conditions: string | null; medications: string | null; whatsappConsent: boolean };
  doctor: { id: string; name: string; qualification: string | null; specialization: string | null; registrationNo: string | null; hasSignature: boolean } | null;
  chiefComplaint: ChiefComplaint;
  vitals: Vitals;
  history: Record<string, string>;
  examination: string;
  diagnoses: Diagnosis[];
  investigations: string[];
  treatmentPlan: string;
  followUpDate: string | null;
  prescription: { id: string; number: string | null; status: string; medicines: MedicineLine[]; advice: Advice; finalizedAt: string | null; deliveryStatus: string; deliveryError: string | null } | null;
  previous: Array<{ id: string; date: string | null; doctor: string | null; complaint: string; diagnoses: string[]; vitals: Vitals; prescription: { id: string; number: string; medicines: string[]; date: string | null } | null }>;
  templates: Array<{ id: string; name: string; medicines: MedicineLine[]; advice: Advice }>;
  alerts: Array<{ level: 'danger' | 'warning' | 'info'; text: string }>;
}

const ROUTES = ['Oral', 'Topical', 'Inhalation', 'Sublingual', 'Nasal', 'Eye drops', 'Ear drops', 'IM injection', 'IV', 'Rectal'];
const FREQUENCIES = ['Once daily', 'Twice daily', 'Thrice daily', 'Four times daily', '1-0-1', '1-1-1', '1-0-0', '0-0-1', 'Every 6 hours', 'SOS (as needed)', 'At bedtime'];
const TIMINGS = ['After food', 'Before food', 'With food', 'Empty stomach', 'At bedtime'];
const DELIVERY: Record<string, { label: string; cls: string }> = {
  not_sent: { label: 'Not sent', cls: 'bg-muted text-muted-foreground' },
  pending: { label: 'Pending', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  uploaded: { label: 'Uploaded', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  sent: { label: 'Sent', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  read: { label: 'Read', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  failed: { label: 'Failed', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
  blocked: { label: 'Not sent — action needed', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
};
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Compact form controls used throughout the workspace.
const Inp = (props: React.ComponentProps<typeof Input>) => <Input {...props} className={cn('h-8 text-xs md:text-xs', props.className)} />;
const Ta = (props: React.ComponentProps<typeof Textarea>) => <Textarea {...props} className={cn('min-h-0 py-1.5 text-xs md:text-xs', props.className)} />;

function Section({ title, letter, children, hint }: { title: string; letter: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-xl border border-border/70 bg-card p-3.5">
      <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-xs text-primary">{letter}</span> {title}
        {hint && <span className="text-xs font-normal text-muted-foreground">· {hint}</span>}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export default function ConsultationWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfKey, setPdfKey] = useState(0);
  const [aiModal, setAiModal] = useState<'text' | 'voice' | null>(null);
  const [dxQuery, setDxQuery] = useState('');
  const [invInput, setInvInput] = useState('');
  const revision = useRef(0);
  const pending = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<Workspace>(`/api/healthcare/consultations/${id}`);
      revision.current = res.data.revision;
      setWs(res.data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    let live = true;
    api<Workspace>(`/api/healthcare/consultations/${id}`)
      .then((res) => {
        if (!live) return;
        revision.current = res.data.revision;
        setWs(res.data);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id]);

  const readOnly = !ws || ws.status !== 'in_progress' || ws.prescription?.status === 'finalized';

  // ── autosave (debounced, optimistic concurrency) ──────────────────
  // Saves are serialized: a flush waits for any save already in flight, so
  // finalize/preview always run against the latest revision.
  const inflight = useRef<Promise<boolean> | null>(null);
  const flush = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    while (inflight.current) await inflight.current;
    const body = pending.current;
    if (!Object.keys(body).length) return true;
    pending.current = {};
    setSaveState('saving');
    const run = (async () => {
      try {
        const res = await api<{ revision: number; medicines?: MedicineLine[]; bmi?: string | null }>(`/api/healthcare/consultations/${id}`, { method: 'PATCH', json: { revision: revision.current, ...body } });
        revision.current = res.data.revision;
        if (res.data.bmi) setWs((w) => (w ? { ...w, vitals: { ...w.vitals, bmi: res.data.bmi ?? undefined } } : w));
        setSaveState(Object.keys(pending.current).length ? 'dirty' : 'saved');
        return true;
      } catch (e) {
        setSaveState('error');
        pending.current = { ...body, ...pending.current };
        toast.error((e as Error).message, { action: { label: 'Reload', onClick: () => void load() } });
        return false;
      }
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, [id, load]);

  const queue = useCallback(
    (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      setSaveState('dirty');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), 1200);
    },
    [flush],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const update = <K extends keyof Workspace>(key: K, value: Workspace[K], patch: Record<string, unknown>) => {
    setWs((w) => (w ? { ...w, [key]: value } : w));
    queue(patch);
  };
  const setCC = (k: keyof ChiefComplaint, v: string) => ws && update('chiefComplaint', { ...ws.chiefComplaint, [k]: v }, { chiefComplaint: { ...ws.chiefComplaint, [k]: v } });
  const setVital = (k: keyof Vitals, v: string) => {
    if (!ws) return;
    const next = { ...ws.vitals, [k]: v };
    next.bmi = bmi(next.heightCm, next.weightKg) ?? '';
    update('vitals', next, { vitals: next });
  };
  const setHistory = (k: string, v: string) => ws && update('history', { ...ws.history, [k]: v }, { history: { ...ws.history, [k]: v } });
  const setMeds = (meds: MedicineLine[]) => {
    if (!ws?.prescription) return;
    setWs({ ...ws, prescription: { ...ws.prescription, medicines: meds } });
    queue({ medicines: meds });
  };
  const setAdvice = (k: keyof Advice, v: string) => {
    if (!ws?.prescription) return;
    const advice = { ...ws.prescription.advice, [k]: v };
    setWs({ ...ws, prescription: { ...ws.prescription, advice } });
    queue({ advice });
  };
  const setDx = (dx: Diagnosis[]) => ws && update('diagnoses', dx, { diagnoses: dx });
  const setInv = (inv: string[]) => ws && update('investigations', inv, { investigations: inv });

  // What the last AI draft wrote, so a re-draft replaces it instead of piling up duplicates.
  const lastDraft = useRef<{ investigations: string[]; plan: string; examination: string; advice: Partial<Advice> }>({ investigations: [], plan: '', examination: '', advice: {} });

  // ── AI suggestion merge ──
  // Voice: fills blanks and appends, never overwrites typed values.
  // Draft (AI Prescription): the doctor asked for a full draft, so the complaint fields are set from it
  // and a previous AI draft is replaced. Lines the doctor confirmed or typed are kept.
  const applySuggestion = (s: Suggestion, mode: 'voice' | 'draft' = 'voice') => {
    if (!ws?.prescription) return;
    const draft = mode === 'draft';
    const prev = lastDraft.current;
    const cc = { ...ws.chiefComplaint };
    for (const [k, v] of Object.entries(s.chiefComplaint)) if (v && (draft || !cc[k as keyof ChiefComplaint])) cc[k as keyof ChiefComplaint] = v;
    const vitals: Vitals = { ...ws.vitals };
    for (const [k, v] of Object.entries(s.vitals)) if (v && !vitals[k as keyof Vitals]) vitals[k as keyof Vitals] = v;
    vitals.bmi = bmi(vitals.heightCm, vitals.weightKg) ?? vitals.bmi;
    const keepDx = draft ? ws.diagnoses.filter((d) => d.verified) : ws.diagnoses;
    const known = new Set(keepDx.map((d) => d.text.toLowerCase()));
    const dx = [...keepDx, ...s.diagnoses.filter((d) => !known.has(d.text.toLowerCase()))];
    const keepMeds = draft ? ws.prescription.medicines.filter((m) => m.verified) : ws.prescription.medicines;
    const meds = [...keepMeds, ...(s.medicines as unknown as MedicineLine[]).map((m) => ({ ...m, quantity: m.quantity || autoQuantity(m) || '' }))];
    const prevInv = new Set(prev.investigations.map((x) => x.toLowerCase()));
    const baseInv = draft ? ws.investigations.filter((x) => !prevInv.has(x.toLowerCase())) : ws.investigations;
    const invSeen = new Set<string>();
    const inv = [...baseInv, ...s.investigations].filter((x) => {
      const key = x.trim().toLowerCase();
      if (!key || invSeen.has(key)) return false;
      invSeen.add(key);
      return true;
    });
    const advice = { ...ws.prescription.advice };
    for (const [k, v] of Object.entries(s.advice)) {
      const cur = advice[k as keyof Advice];
      if (v && (!cur || (draft && cur === prev.advice[k as keyof Advice]))) advice[k as keyof Advice] = v;
    }
    const followUpDate = ws.followUpDate || (s.followUpInDays ? plusDays(s.followUpInDays) : null);
    const planBase = draft && ws.treatmentPlan.trim() === prev.plan.trim() ? '' : ws.treatmentPlan;
    const treatmentPlan = [planBase, s.treatmentPlan].filter(Boolean).join('\n');
    const examination = !ws.examination || (draft && ws.examination === prev.examination) ? s.examination || ws.examination || '' : ws.examination;
    if (draft) lastDraft.current = { investigations: s.investigations, plan: s.treatmentPlan, examination: s.examination || '', advice: s.advice as Partial<Advice> };
    // Medical history comes from the patient's own record. Blank fields only; nothing is invented.
    const history: Record<string, string> = { ...ws.history };
    const fromRecord: Record<string, string | null> = {
      past: ws.patient.conditions,
      allergies: ws.patient.allergies,
      medications: ws.patient.medications,
      previousDiagnoses: ws.previous.flatMap((h) => h.diagnoses).join(', ') || null,
    };
    for (const [k, v] of Object.entries(fromRecord)) if (v && !history[k]) history[k] = v;
    setWs({ ...ws, chiefComplaint: cc, vitals, history, examination, diagnoses: dx, investigations: inv, followUpDate, treatmentPlan, prescription: { ...ws.prescription, medicines: meds, advice } });
    queue({ chiefComplaint: cc, vitals, history, examination, diagnoses: dx, investigations: inv, followUpDate, treatmentPlan, medicines: meds, advice });
  };

  const meds = useMemo(() => ws?.prescription?.medicines ?? [], [ws]);
  const finalizeCheck = useMemo(
    () => (ws ? checkFinalize({ medicines: meds, diagnoses: ws.diagnoses, chiefComplaint: ws.chiefComplaint, doctorApproved: true, hasDoctor: Boolean(ws.doctor) }) : { ok: false, issues: [] }),
    [ws, meds],
  );

  if (error) return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm">{error} <Link href="/healthcare/consultations" className="ml-2 text-primary underline">Back to consultations</Link></div>;
  if (!ws) return <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/60" />)}</div>;

  const rx = ws.prescription;
  const dxSuggestions = dxQuery.trim().length > 1 ? COMMON_ICD10.filter((d) => `${d.code} ${d.text}`.toLowerCase().includes(dxQuery.toLowerCase())).slice(0, 6) : [];
  const unverified = meds.filter((m) => !m.verified).length + ws.diagnoses.filter((d) => !d.verified).length;

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="sticky -top-4 z-30 -mx-4 -mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-2.5 sm:-top-6 sm:-mx-6 sm:-mt-6 sm:px-6 [box-shadow:0_0_0_100vmax_var(--background)] [clip-path:inset(0_-100vmax)]">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/healthcare/consultations" className="text-muted-foreground hover:text-foreground" aria-label="Back"><ArrowLeft className="size-5" /></Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{ws.patient.name} <span className="text-xs font-normal text-muted-foreground">· {[ws.patient.age && `${ws.patient.age} yrs`, ws.patient.gender?.replace(/_/g, ' ')].filter(Boolean).join(' / ')}</span></p>
            <p className="truncate text-[11px] text-muted-foreground">{ws.patient.code ?? '—'} · {ws.appointment.ref} · {fmt(`${ws.appointment.date}T00:00:00`)} {ws.appointment.time} · {ws.doctor?.name ?? 'No doctor'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
              {saveState === 'saving' ? <><Loader2 className="size-3 animate-spin" /> Saving…</> : saveState === 'dirty' ? <><Save className="size-3" /> Unsaved</> : saveState === 'error' ? <span className="text-destructive">Not saved</span> : <><CheckCircle2 className="size-3 text-emerald-600" /> Saved</>}
            </span>
          )}
          {!readOnly && (
            <>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAiModal('text')}><Sparkles className="size-3.5" /> AI Prescription</Button>
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={() => setAiModal('voice')}><Mic className="size-3.5" /> AI Voice</Button>
            </>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={async () => { await flush(); setPdfKey((k) => k + 1); setPdfOpen(true); }}><Eye className="size-4" /> {readOnly ? 'View PDF' : 'Preview'}</Button>
          {readOnly && rx?.status === 'finalized' ? (
            <>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setReopenOpen(true)}
              ><Pencil className="size-4" /> Edit prescription</Button>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" render={<a href={`/api/healthcare/prescriptions/${rx.id}/pdf?download=1`} />}><Download className="size-4" /> Download</Button>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => window.open(`/api/healthcare/prescriptions/${rx.id}/pdf`, '_blank')?.addEventListener('load', (e) => (e.currentTarget as Window).print())}><Printer className="size-4" /> Print</Button>
            </>
          ) : (
            <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={readOnly} onClick={async () => { if (await flush()) setFinalizeOpen(true); }}><ShieldCheck className="size-4" /> Complete &amp; finalize</Button>
          )}
        </div>
      </div>

      {readOnly && rx?.status === 'finalized' && <DeliveryBanner rx={rx} onChanged={load} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        {/* LEFT: patient */}
        <aside className="space-y-3 lg:sticky lg:top-[3.25rem] lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto">
          <div className="rounded-xl border border-border/70 bg-card p-3.5 text-xs">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Patient</p>
            <dl className="grid grid-cols-[84px_1fr] gap-y-1.5 leading-snug">
              <dt className="text-muted-foreground">Patient ID</dt><dd className="font-mono text-xs">{ws.patient.code ?? '—'}</dd>
              <dt className="text-muted-foreground">Phone</dt><dd className="font-mono text-xs">{ws.patient.phone ? `+${ws.patient.phone}` : '—'}</dd>
              <dt className="text-muted-foreground">Blood group</dt><dd>{ws.patient.bloodGroup ?? '—'}</dd>
              <dt className="text-muted-foreground">Allergies</dt><dd className={ws.patient.allergies ? 'font-medium text-rose-600' : 'text-muted-foreground'}>{ws.patient.allergies || 'Not recorded'}</dd>
              <dt className="text-muted-foreground">Conditions</dt><dd>{ws.patient.conditions || '—'}</dd>
              <dt className="text-muted-foreground">Medications</dt><dd>{ws.patient.medications || '—'}</dd>
            </dl>
            <Link href={`/healthcare/patients/${ws.patient.contactId}`} className="mt-3 inline-block text-xs text-primary hover:underline">Open full record →</Link>
          </div>
          {ws.alerts.length > 0 && (
            <div className="space-y-1.5">
              {ws.alerts.map((a, i) => (
                <p key={i} className={`flex gap-2 rounded-xl p-2.5 text-xs ${a.level === 'danger' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400' : a.level === 'warning' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'bg-sky-500/10 text-sky-800 dark:text-sky-300'}`}>
                  {a.level === 'info' ? <Info className="size-3.5 shrink-0" /> : <AlertTriangle className="size-3.5 shrink-0" />} {a.text}
                </p>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-border/70 bg-card p-3.5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Previous consultations</p>
            {ws.previous.length === 0 ? (
              <p className="text-xs text-muted-foreground">First consultation.</p>
            ) : (
              <ul className="space-y-3">
                {ws.previous.map((h) => (
                  <li key={h.id} className="text-xs">
                    <p className="font-medium">{fmt(h.date)} · {h.doctor ?? '—'}</p>
                    {h.complaint && <p className="text-muted-foreground">{h.complaint}</p>}
                    {h.diagnoses.length > 0 && <p>Dx: {h.diagnoses.join(', ')}</p>}
                    {h.prescription && (
                      <p className="mt-0.5">
                        <a className="text-primary hover:underline" href={`/api/healthcare/prescriptions/${h.prescription.id}/pdf`} target="_blank" rel="noreferrer">{h.prescription.number}</a>
                        {h.prescription.medicines.length > 0 && <span className="text-muted-foreground"> — {h.prescription.medicines.join(', ')}</span>}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* MAIN */}
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          <fieldset disabled={readOnly} className="space-y-4">
            <Section letter="A" title="Chief complaint">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Main reason for visit *" className="sm:col-span-2"><Inp value={ws.chiefComplaint.complaint ?? ''} onChange={(e) => setCC('complaint', e.target.value)} maxLength={500} /></Field>
                <Field label="Symptoms"><Ta rows={2} value={ws.chiefComplaint.symptoms ?? ''} onChange={(e) => setCC('symptoms', e.target.value)} maxLength={1000} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Duration"><Inp value={ws.chiefComplaint.duration ?? ''} onChange={(e) => setCC('duration', e.target.value)} placeholder="3 days" /></Field>
                  <Field label="Severity">
                    <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={ws.chiefComplaint.severity ?? ''} onChange={(e) => setCC('severity', e.target.value)}>
                      <option value="">—</option><option>Mild</option><option>Moderate</option><option>Severe</option>
                    </select>
                  </Field>
                </div>
              </div>
            </Section>

            <Section letter="B" title="Vitals" hint={ws.vitals.heightCm && !ws.vitals.weightKg ? 'height carried from last visit' : undefined}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([['bp', 'BP (mmHg)', '120/80'], ['pulse', 'Pulse (/min)', '78'], ['temperature', 'Temperature', '98.6 F'], ['spo2', 'SpO2 (%)', '98'], ['respiratoryRate', 'Resp. rate (/min)', '16'], ['heightCm', 'Height (cm)', '170'], ['weightKg', 'Weight (kg)', '68']] as const).map(([k, l, p]) => (
                  <Field key={k} label={l}><Inp value={ws.vitals[k] ?? ''} onChange={(e) => setVital(k, e.target.value)} placeholder={p} inputMode={k === 'bp' || k === 'temperature' ? 'text' : 'decimal'} /></Field>
                ))}
                <Field label="BMI (auto)"><Inp value={ws.vitals.bmi ?? ''} readOnly tabIndex={-1} className="bg-muted/50" /></Field>
              </div>
            </Section>

            <Section letter="C" title="Medical history">
              <div className="grid gap-3 sm:grid-cols-2">
                {([['past', 'Past medical history', ws.patient.conditions], ['surgical', 'Surgical history', null], ['family', 'Family history', null], ['allergies', 'Allergies', ws.patient.allergies], ['medications', 'Current medications', ws.patient.medications], ['previousDiagnoses', 'Relevant previous diagnoses', ws.previous.flatMap((h) => h.diagnoses).join(', ') || null]] as const).map(([k, l, fromRecord]) => (
                  <Field key={k} label={l}>
                    <Ta rows={2} value={ws.history[k] ?? ''} onChange={(e) => setHistory(k, e.target.value)} />
                    {!ws.history[k] && fromRecord && !readOnly && (
                      <button type="button" className="mt-1 flex items-center gap-1 text-[11px] text-primary hover:underline" onClick={() => setHistory(k, fromRecord)}>
                        <Copy className="size-3" /> Use from patient record: “{fromRecord.slice(0, 60)}{fromRecord.length > 60 ? '…' : ''}”
                      </button>
                    )}
                  </Field>
                ))}
              </div>
            </Section>

            <Section letter="D" title="Clinical examination">
              <Ta rows={3} value={ws.examination} onChange={(e) => update('examination', e.target.value, { examination: e.target.value })} placeholder="General examination, systemic findings…" maxLength={5000} />
            </Section>

            <Section letter="E" title="Diagnosis" hint="search ICD-10 or type freely">
              <div className="relative">
                <Input
                  value={dxQuery}
                  onChange={(e) => setDxQuery(e.target.value)}
                  placeholder="e.g. pharyngitis, J02.9 — press Enter to add as typed"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dxQuery.trim()) {
                      e.preventDefault();
                      setDx([...ws.diagnoses, { id: newId('d'), text: dxQuery.trim(), source: 'manual', verified: true }]);
                      setDxQuery('');
                    }
                  }}
                />
                {dxSuggestions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                    {dxSuggestions.map((d) => (
                      <li key={d.code}>
                        <button type="button" className="flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setDx([...ws.diagnoses, { id: newId('d'), text: d.text, code: d.code, source: 'catalog', verified: true }]); setDxQuery(''); }}>
                          <span className="font-mono text-xs text-muted-foreground">{d.code}</span> {d.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {ws.diagnoses.map((d) => (
                  <li key={d.id} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${d.verified ? 'border-border' : 'border-amber-500/60 bg-amber-500/10'}`}>
                    {d.code && <span className="font-mono text-muted-foreground">{d.code}</span>} {d.text}
                    {!d.verified && (
                      <button type="button" className="rounded bg-amber-500 px-1.5 text-[10px] font-semibold text-white" onClick={() => setDx(ws.diagnoses.map((x) => (x.id === d.id ? { ...x, verified: true } : x)))} title="AI suggestion — click to confirm">
                        Confirm
                      </button>
                    )}
                    <button type="button" aria-label={`Remove ${d.text}`} onClick={() => setDx(ws.diagnoses.filter((x) => x.id !== d.id))}><X className="size-3" /></button>
                  </li>
                ))}
              </ul>
            </Section>

            <Section letter="F" title="Investigations / lab tests">
              <div className="flex gap-2">
                <Inp value={invInput} onChange={(e) => setInvInput(e.target.value)} placeholder="CBC, CRP, Throat swab… (Enter to add)" onKeyDown={(e) => { if (e.key === 'Enter' && invInput.trim()) { e.preventDefault(); setInv([...ws.investigations, invInput.trim()]); setInvInput(''); } }} />
                <Button type="button" variant="outline" onClick={() => { if (invInput.trim()) { setInv([...ws.investigations, invInput.trim()]); setInvInput(''); } }}><Plus className="size-4" /></Button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {ws.investigations.map((t, i) => (
                  <li key={`${t}${i}`} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => setInv(ws.investigations.filter((_, j) => j !== i))}><X className="size-3" /></button></li>
                ))}
              </ul>
            </Section>

            <Section letter="G" title="Treatment plan & follow-up">
              <Ta rows={3} value={ws.treatmentPlan} onChange={(e) => update('treatmentPlan', e.target.value, { treatmentPlan: e.target.value })} placeholder="Plan, instructions…" maxLength={5000} />
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Follow-up date"><Inp type="date" value={ws.followUpDate ?? ''} min={plusDays(0)} onChange={(e) => update('followUpDate', e.target.value || null, { followUpDate: e.target.value || null })} className="w-44" /></Field>
                {[3, 7, 14, 30].map((n) => <Button key={n} type="button" size="sm" variant="outline" onClick={() => update('followUpDate', plusDays(n), { followUpDate: plusDays(n) })}>+{n}d</Button>)}
                {ws.followUpDate && <Button type="button" size="sm" variant="ghost" onClick={() => update('followUpDate', null, { followUpDate: null })}>Clear</Button>}
              </div>
            </Section>

            {rx && (
              <PrescriptionBuilder
                meds={meds}
                setMeds={setMeds}
                advice={rx.advice}
                setAdvice={setAdvice}
                templates={ws.templates}
                doctorId={ws.doctor?.id ?? null}
                readOnly={readOnly}
                onTemplatesChanged={load}
              />
            )}
          </fieldset>

          {!readOnly && unverified > 0 && (
            <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"><AlertTriangle className="size-4" /> {unverified} AI/template field(s) are highlighted — confirm each before finalizing.</p>
          )}
        </div>
      </div>

      {aiModal === 'text' && <AiPrescriptionModal consultationId={ws.id} initial={ws.chiefComplaint} onClose={() => setAiModal(null)} onSuggestion={(s) => applySuggestion(s, 'draft')} />}
      {aiModal === 'voice' && <VoiceRxModal consultationId={ws.id} onClose={() => setAiModal(null)} onSuggestion={(s) => applySuggestion(s, 'voice')} />}

      {pdfOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="Prescription preview">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between rounded-t-xl bg-background px-4 py-2">
            <p className="text-sm font-medium">{rx?.status === 'finalized' ? `Prescription ${rx.number}` : 'Draft preview (watermarked, not signed)'}</p>
            <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => setPdfOpen(false)}><X className="size-4" /></Button>
          </div>
          <iframe key={pdfKey} title="Prescription PDF" src={rx?.status === 'finalized' ? `/api/healthcare/prescriptions/${rx.id}/pdf` : `/api/healthcare/consultations/${ws.id}/pdf?v=${pdfKey}`} className="mx-auto w-full max-w-4xl flex-1 rounded-b-xl bg-white" />
        </div>
      )}

      <ConfirmationDialog
        isOpen={reopenOpen}
        onOpenChange={setReopenOpen}
        title="Edit this prescription?"
        description="It goes back to draft so you can correct it."
        details={rx?.number ? <span className="font-mono text-[12px]">{rx.number}</span> : undefined}
        notes={[
          'The prescription number and QR link stay the same.',
          'Finalize again to sign it and send the corrected PDF to the patient.',
          'Until then, the QR verification shows it as not issued.',
        ]}
        confirmText="Edit prescription"
        icon="warning"
        onConfirm={async () => {
          try {
            await api(`/api/healthcare/consultations/${ws.id}/reopen`, { method: 'POST' });
            toast.success('Prescription re-opened. You can edit it now.');
            await load();
          } catch (e) {
            toast.error((e as Error).message, { duration: 8000 });
            throw e;
          }
        }}
      />

      {finalizeOpen && (
        <FinalizeDialog
          ws={ws}
          issues={finalizeCheck.issues}
          revision={() => revision.current}
          onClose={() => setFinalizeOpen(false)}
          onDone={async () => { setFinalizeOpen(false); await load(); }}
        />
      )}
    </div>
  );
}

// ── prescription builder ─────────────────────────────────────────────

function PrescriptionBuilder({ meds, setMeds, advice, setAdvice, templates, doctorId, readOnly, onTemplatesChanged }: {
  meds: MedicineLine[]; setMeds: (m: MedicineLine[]) => void; advice: Advice; setAdvice: (k: keyof Advice, v: string) => void;
  templates: Workspace['templates']; doctorId: string | null; readOnly: boolean; onTemplatesChanged: () => void;
}) {
  const [catalog, setCatalog] = useState<Array<{ id: string; name: string; genericName: string | null; strength: string | null; form: string | null }>>([]);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const blank = (): MedicineLine => ({ id: newId(), name: '', route: 'Oral', source: 'manual', verified: true, flags: [] });

  const search = async (q: string) => {
    if (q.trim().length < 2) return setCatalog([]);
    try {
      setCatalog((await api<typeof catalog>(`/api/healthcare/medicines?q=${encodeURIComponent(q)}`)).data);
    } catch {
      setCatalog([]);
    }
  };
  const patch = (id: string, p: Partial<MedicineLine>) =>
    setMeds(meds.map((m) => {
      if (m.id !== id) return m;
      const next = { ...m, ...p };
      // Editing a line counts as the doctor reviewing it only when they tick "confirm".
      if (['dosage', 'frequency', 'duration'].some((k) => k in p) && !m.quantity) next.quantity = autoQuantity(next) ?? '';
      return next;
    }));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= meds.length) return;
    const next = [...meds];
    [next[i], next[j]] = [next[j], next[i]];
    setMeds(next);
  };
  const add = () => {
    const row = blank();
    setMeds([...meds, row]);
    setFocusRow(row.id);
  };
  const saveTemplate = async () => {
    const name = window.prompt('Name this prescription template (e.g. "Viral fever – adult"):');
    if (!name?.trim()) return;
    try {
      await api('/api/healthcare/prescription-templates', { method: 'POST', json: { name: name.trim(), doctorId, medicines: meds, advice } });
      toast.success('Template saved.');
      onTemplatesChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const insertTemplate = (tid: string) => {
    const t = templates.find((x) => x.id === tid);
    if (!t) return;
    // Template lines are shortcuts: inserted unverified, never auto-applied.
    setMeds([...meds, ...t.medicines.map((m) => ({ ...m, id: newId(), source: 'template' as const, verified: false, flags: ['From template — confirm it suits this patient.'] }))]);
    for (const [k, v] of Object.entries(t.advice ?? {})) if (v && !advice[k as keyof Advice]) setAdvice(k as keyof Advice, v);
  };

  const cell = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/40';

  return (
    <section className="rounded-xl border border-border/70 bg-card p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold"><span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">Rx</span> Prescription</h2>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {templates.length > 0 && (
              <select aria-label="Insert template" className="h-8 rounded-lg border border-input bg-background px-2 text-xs" value="" onChange={(e) => insertTemplate(e.target.value)}>
                <option value="">Insert template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {meds.length > 0 && <Button type="button" size="sm" variant="outline" onClick={saveTemplate} className="h-8 gap-1 text-xs"><ClipboardList className="size-3.5" /> Save as template</Button>}
            <Button type="button" size="sm" onClick={add} className="h-8 gap-1 text-xs"><Plus className="size-3.5" /> Add medicine</Button>
          </div>
        )}
      </div>

      {meds.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No medicines yet. Dictate them, or add one.</p>
      ) : (
        <div className="space-y-2">
          {meds.map((m, i) => (
            <div key={m.id} className={`rounded-lg border p-2.5 ${m.verified ? 'border-border' : 'border-amber-500/60 bg-amber-500/5'}`}>
              <div className="grid gap-2 md:grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr]">
                <div className="relative">
                  <input
                    className={`${cell} font-medium`}
                    aria-label="Medicine name"
                    placeholder="Medicine name *"
                    value={m.name}
                    autoFocus={focusRow === m.id}
                    list={`cat-${m.id}`}
                    onChange={(e) => {
                      patch(m.id, { name: e.target.value });
                      void search(e.target.value);
                    }}
                    onBlur={() => {
                      const hit = catalog.find((c) => c.name.toLowerCase() === m.name.trim().toLowerCase());
                      if (hit) patch(m.id, { genericName: m.genericName || hit.genericName || undefined, strength: m.strength || hit.strength || undefined });
                    }}
                  />
                  <datalist id={`cat-${m.id}`}>{catalog.map((c) => <option key={c.id} value={c.name}>{[c.strength, c.genericName, c.form].filter(Boolean).join(' · ')}</option>)}</datalist>
                </div>
                <input className={cell} aria-label="Strength" placeholder="Strength (500 mg)" value={m.strength ?? ''} onChange={(e) => patch(m.id, { strength: e.target.value })} />
                <input className={cell} aria-label="Dosage" placeholder="Dosage (1 tablet)" value={m.dosage ?? ''} onChange={(e) => patch(m.id, { dosage: e.target.value })} />
                <select className={cell} aria-label="Route" value={m.route ?? ''} onChange={(e) => patch(m.id, { route: e.target.value })}>
                  <option value="">Route</option>
                  {ROUTES.map((r) => <option key={r}>{r}</option>)}
                </select>
                <input className={cell} aria-label="Frequency" placeholder="Frequency *" list="rx-freq" value={m.frequency ?? ''} onChange={(e) => patch(m.id, { frequency: e.target.value })} />
                <input className={cell} aria-label="Timing" placeholder="Timing" list="rx-timing" value={m.timing ?? ''} onChange={(e) => patch(m.id, { timing: e.target.value })} />
                <input className={cell} aria-label="Duration" placeholder="Duration * (3 days)" value={m.duration ?? ''} onChange={(e) => patch(m.id, { duration: e.target.value })} />
                <input className={cell} aria-label="Quantity" placeholder={autoQuantity(m) ?? 'Quantity'} value={m.quantity ?? ''} onChange={(e) => patch(m.id, { quantity: e.target.value })} />
                <input
                  className={`${cell} md:col-span-3`}
                  aria-label="Instructions"
                  placeholder="Special instructions"
                  value={m.instructions ?? ''}
                  onChange={(e) => patch(m.id, { instructions: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && i === meds.length - 1) { e.preventDefault(); add(); } }}
                />
                <input className={cell} aria-label="Generic name" placeholder="Generic name" value={m.genericName ?? ''} onChange={(e) => patch(m.id, { genericName: e.target.value })} />
              </div>
              {m.flags.length > 0 && !m.verified && (
                <ul className="mt-2 space-y-0.5">{m.flags.map((f) => <li key={f} className="flex gap-1 text-[11px] text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-px size-3 shrink-0" /> {f}</li>)}</ul>
              )}
              {!readOnly && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <label className={`flex items-center gap-2 text-xs font-medium ${m.verified ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                    <input type="checkbox" className="size-4 rx-check" checked={m.verified} onChange={(e) => patch(m.id, { verified: e.target.checked })} />
                    {m.verified ? 'Confirmed by doctor' : m.source === 'ai' ? 'AI suggestion — confirm after checking' : 'Confirm this line'}
                  </label>
                  <div className="flex gap-1">
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="size-3.5" /></Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === meds.length - 1}><ArrowDown className="size-3.5" /></Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Duplicate" onClick={() => setMeds([...meds.slice(0, i + 1), { ...m, id: newId(), verified: false }, ...meds.slice(i + 1)])}><Copy className="size-3.5" /></Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove" className="text-destructive" onClick={() => setMeds(meds.filter((x) => x.id !== m.id))}><Trash2 className="size-3.5" /></Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <datalist id="rx-freq">{FREQUENCIES.map((f) => <option key={f} value={f} />)}</datalist>
      <datalist id="rx-timing">{TIMINGS.map((f) => <option key={f} value={f} />)}</datalist>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {([['diet', 'Diet advice'], ['lifestyle', 'Lifestyle'], ['precautions', 'Precautions'], ['followUp', 'Follow-up instructions'], ['investigations', 'Investigation notes'], ['general', 'Other advice']] as const).map(([k, l]) => (
          <Field key={k} label={l}><Ta rows={2} value={advice[k] ?? ''} onChange={(e) => setAdvice(k, e.target.value)} /></Field>
        ))}
      </div>
    </section>
  );
}

// ── finalize + delivery ──────────────────────────────────────────────

function FinalizeDialog({ ws, issues, revision, onClose, onDone }: { ws: Workspace; issues: string[]; revision: () => number; onClose: () => void; onDone: () => void }) {
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocking = issues.filter((i) => !/Tick the doctor approval/.test(i));
  const submit = async () => {
    setBusy(true);
    try {
      const res = await api<{ prescriptionNo: string; delivery: { status: string; message: string } }>(`/api/healthcare/consultations/${ws.id}/finalize`, { method: 'POST', json: { doctorApproved: approved, revision: revision() } });
      toast.success(`Prescription ${res.data.prescriptionNo} finalized.`);
      const d = res.data.delivery;
      if (d.status === 'sent') toast.success(`WhatsApp: ${d.message}`);
      else toast.warning(`WhatsApp not sent: ${d.message}`, { duration: 10000 });
      onDone();
    } catch (e) {
      toast.error((e as Error).message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Finalize prescription">
      <div className="w-full max-w-lg rounded-2xl bg-popover p-5 shadow-2xl ring-1 ring-foreground/10">
        <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="size-5 text-primary" /> Complete consultation &amp; finalize prescription</h2>
        {blocking.length > 0 ? (
          <>
            <p className="mt-3 text-sm">Please fix these first:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-400">{blocking.map((i) => <li key={i}>{i}</li>)}</ul>
            <div className="mt-5 flex justify-end"><Button variant="outline" onClick={onClose}>Back to editing</Button></div>
          </>
        ) : (
          <>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              <li>• {ws.prescription?.medicines.length ?? 0} medicine(s), {ws.diagnoses.length} diagnosis line(s)</li>
              <li>• {ws.doctor?.hasSignature ? 'Your saved signature will be applied.' : 'No signature on file — the PDF will say "Digitally signed" without an image.'}</li>
              <li>• {ws.patient.whatsappConsent && ws.patient.phone ? `PDF will be sent on WhatsApp to +${ws.patient.phone}.` : 'PDF will NOT be sent automatically (no consent or phone).'}</li>
              <li>• After this the prescription cannot be edited.</li>
            </ul>
            <label className="mt-4 flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 rx-check" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
              <span>I, <strong>{ws.doctor?.name ?? 'the treating doctor'}</strong>, have reviewed the diagnosis and every medicine, dose, frequency and duration, and I approve and sign this prescription.</span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={!approved || busy} className="gap-1.5">{busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Sign &amp; finalize</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DeliveryBanner({ rx, onChanged }: { rx: NonNullable<Workspace['prescription']>; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const meta = DELIVERY[rx.deliveryStatus] ?? DELIVERY.not_sent;
  const resend = async () => {
    setBusy(true);
    try {
      const res = await api<{ status: string; message: string }>(`/api/healthcare/prescriptions/${rx.id}/send`, { method: 'POST' });
      if (res.data.status === 'sent') toast.success(res.data.message);
      else toast.warning(res.data.message, { duration: 10000 });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
      <div>
        <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-emerald-600" /> Consultation completed · Prescription {rx.number}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          WhatsApp: <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
          {rx.deliveryError && ['failed', 'blocked'].includes(rx.deliveryStatus) && <span className="text-amber-700 dark:text-amber-400">{rx.deliveryError.replace('[will retry] ', 'Retrying automatically — ')}</span>}
        </p>
      </div>
      {['failed', 'blocked', 'not_sent', 'pending'].includes(rx.deliveryStatus) && (
        <Button size="sm" variant="outline" onClick={resend} disabled={busy} className="gap-1.5">{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send on WhatsApp</Button>
      )}
    </div>
  );
}
