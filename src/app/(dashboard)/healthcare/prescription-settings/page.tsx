'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, CircleAlert, FileSignature, ImagePlus, Loader2, RotateCcw, Save, Stamp, Trash2, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { api } from '@/lib/campaigns/api';
import { cn } from '@/lib/utils';

interface Clinic { clinicName: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; registrationNo: string | null; headerStyle: string; accentColor: string; footerText: string | null; hasLogo: boolean; hasStamp: boolean; updatedAt: string | null }
interface Doctor { id: string; name: string; qualification: string | null; specialization: string | null; departments: string[]; registrationNo: string | null; designation: string | null; hasSignature: boolean; signatureUpdatedAt: string | null }

const MAX_IMAGE = 1024 * 1024;
const FIELDS = ['clinicName', 'address', 'phone', 'email', 'website', 'registrationNo', 'headerStyle', 'accentColor', 'footerText'] as const;
const DEFAULT_FOOTER = "This prescription is valid only with the doctor's signature.";
const fieldCls = 'h-8 text-[13px]';
const labelCls = 'text-[11px] font-medium text-muted-foreground';

const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
const pickBranding = (c: Clinic) => Object.fromEntries(FIELDS.map((k) => [k, c[k] ?? ''])) as Record<(typeof FIELDS)[number], string>;

type RemoveTarget = { title: string; description: string; run: () => Promise<void> | void };

function ImageSlot({ label, hint, src, onPick, onRemove, busy, icon: Icon }: { label: string; hint: string; src: string | null; onPick: (f: File) => void; onRemove: () => void; busy: boolean; icon: typeof ImagePlus }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/40 p-2.5">
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={label} className="max-h-full max-w-full object-contain" /> : <Icon className="size-5 text-slate-400" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground" title={hint}>{hint}</p>
        <div className="mt-1.5 flex gap-1.5">
          <input ref={ref} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()} className="h-7 gap-1 px-2 text-xs">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />} {src ? 'Replace' : 'Upload'}</Button>
          {src && <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove} className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Remove</Button>}
        </div>
      </div>
    </div>
  );
}

function Section({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border/70 bg-card p-4', className)}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function PrescriptionSettingsPage() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [saved, setSaved] = useState<Record<string, string> | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [previewDoctorId, setPreviewDoctorId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [v, setV] = useState(0); // cache-buster for images
  const [remove, setRemove] = useState<RemoveTarget | null>(null);

  const apply = useCallback((r: { clinic: Clinic; doctors: Doctor[] }, keepEdits: boolean) => {
    setClinic((cur) => (keepEdits && cur ? { ...r.clinic, ...pickBranding(cur) } : r.clinic));
    if (!keepEdits) setSaved(pickBranding(r.clinic));
    setDoctors(r.doctors);
    setV((x) => x + 1);
  }, []);

  /** Re-fetch. Image/doctor changes keep unsaved branding edits in the form. */
  const load = useCallback(async (keepEdits = true) => {
    const r = await api<{ clinic: Clinic; doctors: Doctor[] }>('/api/healthcare/prescription-settings');
    apply(r.data, keepEdits);
  }, [apply]);

  useEffect(() => {
    let live = true;
    api<{ clinic: Clinic; doctors: Doctor[] }>('/api/healthcare/prescription-settings')
      .then((r) => { if (live) apply(r.data, false); })
      .catch((e: Error) => toast.error(e.message));
    return () => { live = false; };
  }, [apply]);

  const dirty = useMemo(() => !!clinic && !!saved && FIELDS.some((k) => (clinic[k] ?? '') !== saved[k]), [clinic, saved]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    if (!clinic) return;
    if (!clinic.clinicName?.trim()) return toast.error('Clinic name is required. It is the heading of every prescription.');
    if (!/^#[0-9a-f]{6}$/i.test(clinic.accentColor)) return toast.error('Accent colour must be a hex code like #0F766E.');
    setSaving(true);
    try {
      const { clinicName, address, phone, email, website, registrationNo, headerStyle, accentColor, footerText } = clinic;
      await api('/api/healthcare/prescription-settings', { method: 'PUT', json: { clinicName, address, phone, email: email || '', website, registrationNo, headerStyle, accentColor, footerText } });
      toast.success('Prescription branding saved. It applies to new prescriptions only.');
      await load(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const discard = () => { if (clinic && saved) setClinic({ ...clinic, ...saved }); };

  const setImage = async (kind: 'logo' | 'stamp', file: File | null) => {
    if (file && file.size > MAX_IMAGE) return toast.error('Images must be 1 MB or smaller.');
    setBusy(kind);
    try {
      await api(`/api/healthcare/prescription-settings/${kind}`, { method: 'PUT', json: { image: file ? { mimeType: file.type, dataBase64: await toBase64(file) } : null } });
      toast.success(file ? `${kind === 'logo' ? 'Logo' : 'Stamp'} uploaded.` : `${kind === 'logo' ? 'Logo' : 'Stamp'} removed.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const saveDoctor = async (d: Doctor, patch: Record<string, unknown>, msg: string) => {
    setBusy(d.id);
    try {
      await api(`/api/healthcare/prescription-settings/doctors/${d.id}`, { method: 'PUT', json: patch });
      toast.success(msg);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!clinic) {
    return (
      <div className="space-y-3">
        <div className="h-12 w-72 animate-pulse rounded-lg bg-muted/60" />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
          <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
        </div>
      </div>
    );
  }
  const set = (k: keyof Clinic) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setClinic({ ...clinic, [k]: e.target.value });
  const logoSrc = clinic.hasLogo ? `/api/healthcare/prescription-settings/logo?v=${v}` : null;
  const stampSrc = clinic.hasStamp ? `/api/healthcare/prescription-settings/stamp?v=${v}` : null;
  const previewDoctor = doctors.find((d) => d.id === previewDoctorId) ?? doctors[0] ?? null;
  const readyDoctors = doctors.filter((d) => d.registrationNo && d.hasSignature).length;

  return (
    <div className="space-y-4 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Prescription setup</h1>
          <p className="text-sm text-muted-foreground">Branding shown on every new prescription. Prescriptions already signed never change.</p>
        </div>
        <Button size="sm" onClick={save} disabled={saving || !dirty} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save branding</Button>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Section title="Clinic header" description="Printed at the top of the first page.">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 sm:col-span-2"><span className={labelCls}>Clinic / hospital name <span className="text-destructive">*</span></span><Input className={fieldCls} value={clinic.clinicName ?? ''} onChange={set('clinicName')} /></label>
              <label className="block space-y-1"><span className={labelCls}>Phone</span><Input className={fieldCls} value={clinic.phone ?? ''} onChange={set('phone')} /></label>
              <label className="block space-y-1"><span className={labelCls}>Email</span><Input className={fieldCls} type="email" value={clinic.email ?? ''} onChange={set('email')} /></label>
              <label className="block space-y-1"><span className={labelCls}>Website</span><Input className={fieldCls} value={clinic.website ?? ''} onChange={set('website')} placeholder="www.yourclinic.com" /></label>
              <label className="block space-y-1"><span className={labelCls}>Registration details</span><Input className={fieldCls} value={clinic.registrationNo ?? ''} onChange={set('registrationNo')} /></label>
              <label className="block space-y-1 sm:col-span-2"><span className={labelCls}>Full address</span><Textarea rows={2} className="min-h-0 text-[13px]" value={clinic.address ?? ''} onChange={set('address')} /></label>
            </div>
          </Section>

          <Section title="Look & assets" description="Logo, stamp, colour and footer.">
            <div className="grid gap-3 sm:grid-cols-2">
              <ImageSlot label="Clinic logo" hint="PNG or JPG, up to 1 MB. Shown top-left." src={logoSrc} busy={busy === 'logo'} icon={ImagePlus} onPick={(f) => setImage('logo', f)} onRemove={() => setRemove({ title: 'Remove clinic logo?', description: 'New prescriptions will print without a logo.', run: async () => { await setImage('logo', null); } })} />
              <ImageSlot label="Clinic stamp" hint="Transparent PNG works best. Shown next to the signature." src={stampSrc} busy={busy === 'stamp'} icon={Stamp} onPick={(f) => setImage('stamp', f)} onRemove={() => setRemove({ title: 'Remove clinic stamp?', description: 'New prescriptions will print without a stamp.', run: async () => { await setImage('stamp', null); } })} />
              <label className="block space-y-1"><span className={labelCls}>Accent colour</span>
                <div className="flex items-center gap-2">
                  <Input type="color" value={clinic.accentColor} onChange={set('accentColor')} className="h-8 w-12 shrink-0 cursor-pointer p-1" />
                  <Input className={cn(fieldCls, 'font-mono uppercase')} value={clinic.accentColor} maxLength={7} onChange={set('accentColor')} />
                </div>
              </label>
              <label className="block space-y-1"><span className={labelCls}>Header style</span>
                <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px]" value={clinic.headerStyle} onChange={set('headerStyle')}><option value="classic">Classic</option><option value="minimal">Minimal</option></select>
              </label>
              <label className="block space-y-1 sm:col-span-2"><span className={labelCls}>Footer text</span><Textarea rows={2} className="min-h-0 text-[13px]" value={clinic.footerText ?? ''} onChange={set('footerText')} placeholder="e.g. Not valid for medico-legal purposes. In emergency call 108." /></label>
            </div>
          </Section>

          <Section title="Doctors" description="Name, qualification and specialization come from the Doctors directory. A signature is applied only when that doctor finalizes a prescription.">
            {doctors.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-[13px] text-muted-foreground">Add doctors in Business Setup → Doctors first.</p>
            ) : (
              <>
                <p className="mb-2 text-[11px] text-muted-foreground">{readyDoctors} of {doctors.length} doctor{doctors.length === 1 ? '' : 's'} ready to sign (registration no. + signature).</p>
                <div className="grid gap-3 xl:grid-cols-2">
                  {doctors.map((d) => (
                    <DoctorCard
                      key={`${d.id}-${d.registrationNo ?? ''}-${d.designation ?? ''}`}
                      d={d}
                      v={v}
                      busy={busy === d.id}
                      onSave={(p, msg) => saveDoctor(d, p, msg)}
                      onRemoveSignature={() => setRemove({ title: `Remove ${d.name}'s signature?`, description: 'Their future prescriptions cannot carry a signature until a new one is uploaded.', run: () => saveDoctor(d, { signature: null }, 'Signature removed.') })}
                    />
                  ))}
                </div>
              </>
            )}
          </Section>
        </div>

        <aside className="space-y-2 lg:sticky lg:top-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Live preview</h2>
            {doctors.length > 1 && (
              <select className="h-7 max-w-[180px] rounded-md border border-input bg-background px-2 text-xs" value={previewDoctor?.id ?? ''} onChange={(e) => setPreviewDoctorId(e.target.value)}>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
          <RxPreview clinic={clinic} logoSrc={logoSrc} stampSrc={stampSrc} doctor={previewDoctor} v={v} />
          <p className="text-[11px] text-muted-foreground">Approximate layout of an A4 prescription. Sample patient and medicine shown.</p>
        </aside>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 shadow-lg">
            <span className="text-[13px] text-muted-foreground">You have unsaved branding changes.</span>
            <Button size="sm" variant="ghost" onClick={discard} disabled={saving} className="gap-1"><RotateCcw className="size-3.5" /> Discard</Button>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save</Button>
          </div>
        </div>
      )}

      <ConfirmationDialog
        isOpen={!!remove}
        onOpenChange={(o) => { if (!o) setRemove(null); }}
        title={remove?.title ?? ''}
        description={remove?.description ?? ''}
        notes={['Prescriptions already signed keep their images.']}
        confirmText="Remove"
        variant="destructive"
        onConfirm={async () => { const r = remove; setRemove(null); await r?.run(); }}
      />
    </div>
  );
}

/** HTML approximation of the PDF header/footer from prescription-pdf.ts. Always white "paper", in both themes. */
function RxPreview({ clinic, logoSrc, stampSrc, doctor, v }: { clinic: Clinic; logoSrc: string | null; stampSrc: string | null; doctor: Doctor | null; v: number }) {
  const accent = /^#[0-9a-f]{6}$/i.test(clinic.accentColor) ? clinic.accentColor : '#0f766e';
  const contact = [clinic.phone, clinic.email].filter(Boolean).join('  |  ');
  const docLines = doctor ? [doctor.qualification, [doctor.specialization, doctor.departments[0]].filter(Boolean).join(' | '), doctor.designation, doctor.registrationNo ? `Reg. No: ${doctor.registrationNo}` : ''].filter(Boolean) : [];
  const sigSrc = doctor?.hasSignature ? `/api/healthcare/prescription-settings/doctors/${doctor.id}/signature?v=${v}` : null;
  return (
    <div className="aspect-[210/297] w-full overflow-hidden rounded-lg border border-border bg-white p-4 text-slate-800 shadow-sm">
      <div className="flex h-full flex-col text-[8px] leading-snug">
        <div className="flex gap-3">
          <div className="flex min-w-0 flex-[58] gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoSrc && <img src={logoSrc} alt="" className="max-h-10 max-w-12 shrink-0 object-contain" />}
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold" style={{ color: accent }}>{clinic.clinicName || 'Your clinic name'}</p>
              {[clinic.address, contact, clinic.website, clinic.registrationNo ? `Reg. No: ${clinic.registrationNo}` : ''].filter(Boolean).map((l, i) => <p key={i} className="line-clamp-2 text-slate-500">{l}</p>)}
            </div>
          </div>
          <div className="min-w-0 flex-[40]">
            <p className="truncate text-[9px] font-bold">{doctor?.name ?? 'Dr. Doctor name'}</p>
            {docLines.map((l, i) => <p key={i} className="truncate text-slate-500">{l}</p>)}
          </div>
        </div>
        <div className="my-2 h-[1.5px]" style={{ backgroundColor: accent }} />
        <div className="grid grid-cols-3 gap-1 rounded bg-slate-50 p-1.5 text-slate-600">
          <span><b>Patient:</b> Sample Patient</span><span><b>Age/Sex:</b> 34 / F</span><span className="text-right"><b>Date:</b> {new Date().toLocaleDateString('en-IN')}</span>
        </div>
        <p className="mt-2 text-[13px] font-bold" style={{ color: accent }}>Rx</p>
        <div className="mt-1 overflow-hidden rounded-sm border border-slate-200">
          <div className="grid grid-cols-[1.6fr_1fr_1fr] px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: accent }}><span>Medicine</span><span>Dosage</span><span>Duration</span></div>
          <div className="grid grid-cols-[1.6fr_1fr_1fr] px-1.5 py-0.5"><span>Tab. Paracetamol 650</span><span>1-0-1</span><span>5 days</span></div>
          <div className="grid grid-cols-[1.6fr_1fr_1fr] bg-slate-50 px-1.5 py-0.5"><span>Syp. Cough relief</span><span>10 ml HS</span><span>3 days</span></div>
        </div>
        <div className="mt-auto flex items-end justify-end gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {stampSrc && <img src={stampSrc} alt="" className="max-h-12 max-w-14 object-contain opacity-90" />}
          <div className="w-28 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {sigSrc ? <img src={sigSrc} alt="" className="mx-auto max-h-8 object-contain" /> : <p className="py-2 italic text-slate-300">No signature</p>}
            <div className="border-t border-slate-300 pt-0.5 font-semibold">{doctor?.name ?? 'Doctor'}</div>
          </div>
        </div>
        <div className="mt-2 border-t border-slate-200 pt-1 text-center text-[7px] text-slate-400">{clinic.footerText || DEFAULT_FOOTER}</div>
      </div>
    </div>
  );
}

function DoctorCard({ d, v, busy, onSave, onRemoveSignature }: { d: Doctor; v: number; busy: boolean; onSave: (patch: Record<string, unknown>, msg: string) => void; onRemoveSignature: () => void }) {
  const [reg, setReg] = useState(d.registrationNo ?? '');
  const [designation, setDesignation] = useState(d.designation ?? '');
  const changed = reg !== (d.registrationNo ?? '') || designation !== (d.designation ?? '');
  const ready = !!d.registrationNo && d.hasSignature;
  const missing = [!d.registrationNo && 'registration no.', !d.hasSignature && 'signature'].filter(Boolean).join(' and ');
  return (
    <div className="space-y-2.5 rounded-lg border border-border/70 p-3">
      <div className="flex items-start gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10"><UserRound className="size-3.5 text-primary" /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{d.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{[d.qualification, d.specialization, d.departments.join(', ')].filter(Boolean).join(' · ') || '—'}</p>
        </div>
        {ready
          ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-3" /> Ready</span>
          : <span title={`Missing ${missing}`} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"><CircleAlert className="size-3" /> Incomplete</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className={labelCls}>Medical registration no.</span><Input className={fieldCls} value={reg} onChange={(e) => setReg(e.target.value)} /></label>
        <label className="space-y-1"><span className={labelCls}>Designation</span><Input className={fieldCls} value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Consultant" /></label>
      </div>
      {changed && (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setReg(d.registrationNo ?? ''); setDesignation(d.designation ?? ''); }}>Cancel</Button>
          <Button size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => onSave({ registrationNo: reg.trim() || null, designation: designation.trim() || null }, `${d.name} updated.`)}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save details</Button>
        </div>
      )}
      <ImageSlot
        label="Digital signature"
        hint={d.signatureUpdatedAt ? `Updated ${new Date(d.signatureUpdatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Sign on white paper, photograph, crop. PNG/JPG up to 1 MB.'}
        src={d.hasSignature ? `/api/healthcare/prescription-settings/doctors/${d.id}/signature?v=${v}` : null}
        busy={busy}
        icon={FileSignature}
        onPick={async (f) => {
          if (f.size > MAX_IMAGE) return toast.error('Images must be 1 MB or smaller.');
          onSave({ signature: { mimeType: f.type, dataBase64: await toBase64(f) } }, 'Signature uploaded.');
        }}
        onRemove={onRemoveSignature}
      />
    </div>
  );
}
