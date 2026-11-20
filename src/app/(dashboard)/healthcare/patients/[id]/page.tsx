'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Download, Eye, FileText, Loader2, Save, Send, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/campaigns/api';

type Tab = 'overview' | 'consultations' | 'prescriptions' | 'investigations' | 'documents' | 'timeline' | 'communications';
interface Profile { patientCode: string; gender: string | null; dateOfBirth: string | null; ageYears: number | null; bloodGroup: string | null; allergies: string | null; conditions: string | null; medications: string | null; surgicalHistory: string | null; familyHistory: string | null; emergencyName: string | null; emergencyPhone: string | null; notes: string | null; updatedAt: string }
interface Record_ {
  contactId: string; name: string; phone: string | null; email: string | null; whatsappConsent: boolean; registeredAt: string; age: string | null; gender: string | null;
  profile: Profile | null;
  consultations: Array<{ id: string; status: string; date: string; doctor: string | null; department: string | null; complaint: string; diagnoses: string[]; vitals: Record<string, string>; notes: string; treatmentPlan: string; investigations: string[]; followUpDate: string | null }>;
  prescriptions: Array<{ id: string; number: string; date: string | null; doctor: string | null; diagnoses: string[]; medicineCount: number; deliveryStatus: string; deliveryError: string | null }>;
  investigations: Array<{ test: string; orderedAt: string; doctor: string | null; consultationId: string }>;
  documents: Array<{ id: string; kind: string; title: string; fileName: string; mimeType: string; size: number; createdAt: string }>;
  communications: Array<{ id: string; eventType: string; channel: string; status: string; templateName: string | null; errorMessage: string | null; createdAt: string }>;
  timeline: Array<{ at: string; kind: string; text: string }>;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'consultations', label: 'Consultations' },
  { id: 'prescriptions', label: 'Prescriptions' },
  { id: 'investigations', label: 'Investigations' },
  { id: 'documents', label: 'Documents' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'communications', label: 'Communication' },
];
const DOC_KINDS: Record<string, string> = { prescription: 'Previous prescription', lab_report: 'Lab report', scan: 'Scan report', discharge: 'Discharge summary', medical_report: 'Medical report', other: 'Other' };
const fmt = (iso?: string | null, time = false) => (iso ? new Date(iso).toLocaleString('en-IN', time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : '—');
const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

export default function PatientRecordPage() {
  const { id } = useParams<{ id: string }>();
  const [rec, setRec] = useState<Record_ | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [form, setForm] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);
  const [openConsult, setOpenConsult] = useState<string | null>(null);

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

  const saveProfile = async () => {
    setSaving(true);
    try {
      const body = { ...form, ageYears: form.ageYears != null && String(form.ageYears) !== '' ? Number(form.ageYears) : null };
      delete (body as Record<string, unknown>).patientCode;
      delete (body as Record<string, unknown>).updatedAt;
      for (const k of Object.keys(body)) if ((body as Record<string, unknown>)[k] === '') (body as Record<string, unknown>)[k] = null;
      await api(`/api/healthcare/patients/${id}`, { method: 'PATCH', json: body });
      toast.success('Patient record saved.');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm">{error}</div>;
  if (!rec) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/60" />)}</div>;

  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link href="/healthcare/patients" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Back"><ArrowLeft className="size-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{rec.name}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{rec.profile?.patientCode ?? 'No patient ID yet'}</span> · {[rec.age && `${rec.age} yrs`, rec.gender?.replace(/_/g, ' ')].filter(Boolean).join(' / ') || '—'} · {rec.phone ? `+${rec.phone}` : 'no phone'}
              {!rec.whatsappConsent && <span className="ml-2 rounded bg-amber-500/10 px-1.5 text-xs text-amber-700">no WhatsApp consent</span>}
            </p>
          </div>
        </div>
        {rec.profile?.allergies && <p className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-400"><AlertTriangle className="size-4" /> Allergies: {rec.profile.allergies}</p>}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.id ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t.label}
            {t.id === 'consultations' && ` (${rec.consultations.length})`}
            {t.id === 'prescriptions' && ` (${rec.prescriptions.length})`}
            {t.id === 'documents' && ` (${rec.documents.length})`}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
            <h2 className="text-sm font-semibold">Personal &amp; contact</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Gender</span>
                <select className="h-9 w-full rounded-lg border border-input bg-background px-2" value={form.gender ?? ''} onChange={set('gender')}>
                  <option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Blood group</span>
                <select className="h-9 w-full rounded-lg border border-input bg-background px-2" value={form.bloodGroup ?? ''} onChange={set('bloodGroup')}>
                  <option value="">—</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b}>{b}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Date of birth</span><Input type="date" value={form.dateOfBirth ?? ''} onChange={set('dateOfBirth')} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Age (years)</span><Input inputMode="numeric" value={form.ageYears ?? ''} onChange={(e) => setForm({ ...form, ageYears: e.target.value.replace(/\D/g, '') as unknown as number })} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Emergency contact</span><Input value={form.emergencyName ?? ''} onChange={set('emergencyName')} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Emergency phone</span><Input value={form.emergencyPhone ?? ''} onChange={set('emergencyPhone')} inputMode="tel" /></label>
              <p className="col-span-2 text-xs text-muted-foreground">Email: {rec.email ?? '—'} · Registered {fmt(rec.registeredAt)}</p>
            </div>
          </section>
          <section className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
            <h2 className="text-sm font-semibold">Medical information</h2>
            {([['allergies', 'Allergies'], ['conditions', 'Medical conditions'], ['medications', 'Current medications'], ['surgicalHistory', 'Surgical history'], ['familyHistory', 'Family history'], ['notes', 'Patient notes']] as const).map(([k, l]) => (
              <label key={k} className="block space-y-1"><span className="text-xs text-muted-foreground">{l}</span><Textarea rows={2} value={form[k] ?? ''} onChange={set(k)} /></label>
            ))}
          </section>
          <div className="flex justify-end lg:col-span-2">
            <Button onClick={saveProfile} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save record</Button>
          </div>
        </div>
      )}

      {tab === 'consultations' && (
        <ul className="space-y-2">
          {rec.consultations.length === 0 && <Empty text="No consultations yet." />}
          {rec.consultations.map((c) => (
            <li key={c.id} className="rounded-2xl border border-border/70 bg-card">
              <button type="button" onClick={() => setOpenConsult(openConsult === c.id ? null : c.id)} className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left">
                <span>
                  <span className="block font-medium">{fmt(c.date)} · {c.doctor ?? '—'}{c.department ? ` (${c.department})` : ''}</span>
                  <span className="block text-sm text-muted-foreground">{c.complaint || 'No complaint recorded'}{c.diagnoses.length ? ` — ${c.diagnoses.join(', ')}` : ''}</span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${c.status === 'completed' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>{c.status === 'completed' ? 'Completed' : 'In progress'}</span>
              </button>
              {openConsult === c.id && (
                <div className="grid gap-3 border-t border-border p-4 text-sm sm:grid-cols-2">
                  <p><span className="text-muted-foreground">Vitals: </span>{Object.entries(c.vitals).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</p>
                  <p><span className="text-muted-foreground">Follow-up: </span>{c.followUpDate ? fmt(`${c.followUpDate}T00:00:00`) : '—'}</p>
                  <p className="sm:col-span-2"><span className="text-muted-foreground">Clinical notes: </span>{c.notes || '—'}</p>
                  <p className="sm:col-span-2"><span className="text-muted-foreground">Treatment plan: </span>{c.treatmentPlan || '—'}</p>
                  {c.investigations.length > 0 && <p className="sm:col-span-2"><span className="text-muted-foreground">Investigations: </span>{c.investigations.join(', ')}</p>}
                  <Link href={`/healthcare/consultations/${c.id}`} className="text-primary hover:underline">Open full consultation →</Link>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === 'prescriptions' && <PrescriptionsTab rec={rec} onChanged={load} />}

      {tab === 'investigations' && (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          {rec.investigations.length === 0 ? <Empty text="No investigations ordered yet." /> : (
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Test</th><th className="px-3 py-2">Ordered</th><th className="px-3 py-2">Doctor</th></tr></thead>
              <tbody className="divide-y divide-border/70">{rec.investigations.map((i, n) => <tr key={n}><td className="px-4 py-2">{i.test}</td><td className="px-3 py-2 text-muted-foreground">{fmt(i.orderedAt)}</td><td className="px-3 py-2">{i.doctor ?? '—'}</td></tr>)}</tbody>
            </table>
          )}
          <p className="border-t border-border p-3 text-xs text-muted-foreground">Upload lab results in the Documents tab (type “Lab report”).</p>
        </div>
      )}

      {tab === 'documents' && <DocumentsTab rec={rec} onChanged={load} />}

      {tab === 'timeline' && (
        <ol className="relative space-y-4 border-l border-border pl-5">
          {rec.timeline.map((t, i) => (
            <li key={i} className="text-sm">
              <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-background bg-primary" />
              <p>{t.text}</p>
              <p className="text-xs text-muted-foreground">{fmt(t.at, true)}</p>
            </li>
          ))}
        </ol>
      )}

      {tab === 'communications' && (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          {rec.communications.length === 0 ? <Empty text="No WhatsApp messages yet." /> : (
            <ul className="divide-y divide-border/70">
              {rec.communications.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span><span className="capitalize">{c.eventType.replace(/_/g, ' ')}</span> <span className="text-xs text-muted-foreground">· {c.channel === 'template' ? `template ${c.templateName}` : c.channel === 'text' ? 'message' : '—'} · {fmt(c.createdAt, true)}</span>{c.errorMessage && c.status !== 'sent' && <span className="block text-xs text-amber-700">{c.errorMessage}</span>}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${c.status === 'sent' ? 'bg-emerald-500/10 text-emerald-700' : c.status === 'failed' || c.status === 'blocked_no_template' ? 'bg-rose-500/10 text-rose-700' : 'bg-muted text-muted-foreground'}`}>{c.status.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{text}</p>;
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
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Prescription</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Doctor</th><th className="px-3 py-2">Diagnosis</th><th className="px-3 py-2">Medicines</th><th className="px-3 py-2">WhatsApp</th><th className="px-3 py-2" /></tr></thead>
          <tbody className="divide-y divide-border/70">
            {rec.prescriptions.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-mono text-xs">{p.number}</td>
                <td className="px-3 py-2 text-xs">{fmt(p.date)}</td>
                <td className="px-3 py-2 text-xs">{p.doctor ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{p.diagnoses.join(', ') || '—'}</td>
                <td className="px-3 py-2 text-xs">{p.medicineCount}</td>
                <td className="px-3 py-2 text-xs capitalize" title={p.deliveryError ?? undefined}>{p.deliveryStatus.replace(/_/g, ' ')}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label="View PDF" render={<a href={`/api/healthcare/prescriptions/${p.id}/pdf`} target="_blank" rel="noreferrer" />}><Eye className="size-4" /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Download PDF" render={<a href={`/api/healthcare/prescriptions/${p.id}/pdf?download=1`} />}><Download className="size-4" /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Send on WhatsApp" disabled={busy === p.id} onClick={() => resend(p.id)}>{busy === p.id ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocumentsTab({ rec, onChanged }: { rec: Record_; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('lab_report');
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
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
  const remove = async (id: string) => {
    if (!window.confirm('Remove this document from the patient record?')) return;
    try {
      await api(`/api/healthcare/documents/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border/70 bg-card p-4">
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Type</span>
          <select className="h-9 rounded-lg border border-input bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className="min-w-[200px] flex-1 space-y-1"><span className="text-xs text-muted-foreground">Title</span><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CBC report 12 Nov" /></label>
        <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-1.5">{uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload</Button>
        <p className="w-full text-[11px] text-muted-foreground">PDF or image, up to 8 MB. Stored privately; only signed-in clinic staff can open them, and every access is logged.</p>
      </div>
      {rec.documents.length === 0 ? <Empty text="No documents yet." /> : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card">
          {rec.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-3"><FileText className="size-5 shrink-0 text-primary" /><span className="min-w-0"><span className="block truncate font-medium">{d.title}</span><span className="block text-xs text-muted-foreground">{DOC_KINDS[d.kind] ?? d.kind} · {(d.size / 1024).toFixed(0)} KB · {fmt(d.createdAt)}</span></span></span>
              <span className="flex gap-1">
                <Button size="icon-sm" variant="ghost" aria-label="Open" render={<a href={`/api/healthcare/documents/${d.id}`} target="_blank" rel="noreferrer" />}><Eye className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Download" render={<a href={`/api/healthcare/documents/${d.id}?download=1`} />}><Download className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove" className="text-destructive" onClick={() => remove(d.id)}><Trash2 className="size-4" /></Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
