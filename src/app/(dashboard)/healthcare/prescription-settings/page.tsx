'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileSignature, ImagePlus, Loader2, Save, Stamp, Trash2, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/campaigns/api';

interface Clinic { clinicName: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; registrationNo: string | null; headerStyle: string; accentColor: string; footerText: string | null; hasLogo: boolean; hasStamp: boolean; updatedAt: string | null }
interface Doctor { id: string; name: string; qualification: string | null; specialization: string | null; departments: string[]; registrationNo: string | null; designation: string | null; hasSignature: boolean; signatureUpdatedAt: string | null }

const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

function ImageSlot({ label, hint, src, onPick, onRemove, busy, icon: Icon }: { label: string; hint: string; src: string | null; onPick: (f: File) => void; onRemove: () => void; busy: boolean; icon: typeof ImagePlus }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-3">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={label} className="max-h-full max-w-full object-contain" /> : <Icon className="size-7 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="flex gap-2">
          <input ref={ref} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()} className="gap-1">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />} {src ? 'Replace' : 'Upload'}</Button>
          {src && <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove} className="gap-1 text-destructive"><Trash2 className="size-3.5" /> Remove</Button>}
        </div>
      </div>
    </div>
  );
}

export default function PrescriptionSettingsPage() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [v, setV] = useState(0); // cache-buster for images

  const load = useCallback(async () => {
    const r = await api<{ clinic: Clinic; doctors: Doctor[] }>('/api/healthcare/prescription-settings');
    setClinic(r.data.clinic);
    setDoctors(r.data.doctors);
    setV((x) => x + 1);
  }, []);
  useEffect(() => {
    let live = true;
    api<{ clinic: Clinic; doctors: Doctor[] }>('/api/healthcare/prescription-settings')
      .then((r) => { if (live) { setClinic(r.data.clinic); setDoctors(r.data.doctors); } })
      .catch((e: Error) => toast.error(e.message));
    return () => { live = false; };
  }, []);

  const save = async () => {
    if (!clinic) return;
    setSaving(true);
    try {
      const { clinicName, address, phone, email, website, registrationNo, headerStyle, accentColor, footerText } = clinic;
      await api('/api/healthcare/prescription-settings', { method: 'PUT', json: { clinicName, address, phone, email: email || '', website, registrationNo, headerStyle, accentColor, footerText } });
      toast.success('Prescription branding saved. It applies to new prescriptions only.');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const setImage = async (kind: 'logo' | 'stamp', file: File | null) => {
    if (file && file.size > 1024 * 1024) return toast.error('Images must be 1 MB or smaller.');
    setBusy(kind);
    try {
      await api(`/api/healthcare/prescription-settings/${kind}`, { method: 'PUT', json: { image: file ? { mimeType: file.type, dataBase64: await toBase64(file) } : null } });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const saveDoctor = async (d: Doctor, patch: Record<string, unknown>) => {
    setBusy(d.id);
    try {
      await api(`/api/healthcare/prescription-settings/doctors/${d.id}`, { method: 'PUT', json: patch });
      toast.success(`${d.name} updated.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!clinic) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted/60" />)}</div>;
  const set = (k: keyof Clinic) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setClinic({ ...clinic, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><FileSignature className="size-6 text-primary" /> Prescription setup</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Set your prescription branding once. It appears on every new prescription; already-signed prescriptions never change.</p>
        </div>
        <Button onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save branding</Button>
      </div>

      <section className="grid gap-4 rounded-2xl border border-border/70 bg-card p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Clinic header</h2>
          {([['clinicName', 'Clinic / hospital name'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['registrationNo', 'Registration details']] as const).map(([k, l]) => (
            <label key={k} className="block space-y-1"><span className="text-xs text-muted-foreground">{l}</span><Input value={clinic[k] ?? ''} onChange={set(k)} /></label>
          ))}
          <label className="block space-y-1"><span className="text-xs text-muted-foreground">Full address</span><Textarea rows={2} value={clinic.address ?? ''} onChange={set('address')} /></label>
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Look &amp; assets</h2>
          <ImageSlot label="Clinic logo" hint="PNG or JPG, up to 1 MB. Shown top-left." src={clinic.hasLogo ? `/api/healthcare/prescription-settings/logo?v=${v}` : null} busy={busy === 'logo'} icon={ImagePlus} onPick={(f) => setImage('logo', f)} onRemove={() => setImage('logo', null)} />
          <ImageSlot label="Clinic stamp" hint="Transparent PNG works best. Shown next to the signature." src={clinic.hasStamp ? `/api/healthcare/prescription-settings/stamp?v=${v}` : null} busy={busy === 'stamp'} icon={Stamp} onPick={(f) => setImage('stamp', f)} onRemove={() => setImage('stamp', null)} />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Accent colour</span><Input type="color" value={clinic.accentColor} onChange={set('accentColor')} className="h-9 p-1" /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Header style</span>
              <select className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm" value={clinic.headerStyle} onChange={set('headerStyle')}><option value="classic">Classic</option><option value="minimal">Minimal</option></select>
            </label>
          </div>
          <label className="block space-y-1"><span className="text-xs text-muted-foreground">Footer text</span><Textarea rows={2} value={clinic.footerText ?? ''} onChange={set('footerText')} placeholder="e.g. Not valid for medico-legal purposes. In emergency call 108." /></label>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border/70 bg-card p-5">
        <div>
          <h2 className="text-sm font-semibold">Doctors</h2>
          <p className="text-xs text-muted-foreground">Name, qualification and specialization come from the Doctors directory. A signature is applied only when that doctor approves and finalizes a prescription.</p>
        </div>
        {doctors.length === 0 && <p className="text-sm text-muted-foreground">Add doctors in Business Setup → Doctors first.</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {doctors.map((d) => <DoctorCard key={d.id} d={d} v={v} busy={busy === d.id} onSave={(p) => saveDoctor(d, p)} />)}
        </div>
      </section>
    </div>
  );
}

function DoctorCard({ d, v, busy, onSave }: { d: Doctor; v: number; busy: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  const [reg, setReg] = useState(d.registrationNo ?? '');
  const [designation, setDesignation] = useState(d.designation ?? '');
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <UserRound className="size-5 text-primary" />
        <div className="min-w-0"><p className="truncate font-medium">{d.name}</p><p className="truncate text-xs text-muted-foreground">{[d.qualification, d.specialization, d.departments.join(', ')].filter(Boolean).join(' · ') || '—'}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Medical registration no.</span><Input value={reg} onChange={(e) => setReg(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Designation</span><Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Consultant" /></label>
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onSave({ registrationNo: reg || null, designation: designation || null })}>Save details</Button>
      <ImageSlot
        label="Digital signature"
        hint={d.signatureUpdatedAt ? `Updated ${new Date(d.signatureUpdatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Sign on white paper, photograph, crop — PNG/JPG up to 1 MB.'}
        src={d.hasSignature ? `/api/healthcare/prescription-settings/doctors/${d.id}/signature?v=${v}` : null}
        busy={busy}
        icon={FileSignature}
        onPick={async (f) => {
          if (f.size > 1024 * 1024) return toast.error('Images must be 1 MB or smaller.');
          onSave({ signature: { mimeType: f.type, dataBase64: await toBase64(f) } });
        }}
        onRemove={() => onSave({ signature: null })}
      />
    </div>
  );
}
