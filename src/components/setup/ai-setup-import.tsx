'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Building2, CheckCircle2, Clock, FileUp, HelpCircle, Loader2, Package, Sparkles, Stethoscope, Upload, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ExtractedSetup } from '@/lib/ai/setup-extract';

export type SetupSection = 'profile' | 'timings' | 'people' | 'services' | 'faqs' | 'knowledge';

interface Props {
  /** "healthcare" shows doctors/departments wording. */
  isHealthcare: boolean;
  onApply: (data: ExtractedSetup, sections: Set<SetupSection>) => void;
}

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.html,.png,.jpg,.jpeg,.webp';

/**
 * "Fill setup from a document": upload a brochure / roster / rate card,
 * AI extracts the business details, the owner approves sections, and the
 * wizard is pre-filled for saving.
 */
export function AiSetupImport({ isHealthcare, onApply }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [data, setData] = useState<ExtractedSetup | null>(null);
  const [sections, setSections] = useState<Set<SetupSection>>(new Set());

  async function analyse(file: File) {
    if (file.size > 50 * 1024 * 1024) return toast.error('Documents must be 50 MB or smaller.');
    setFileName(file.name);
    setBusy(true);
    setOpen(true);
    setData(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/setup/ai-extract', { method: 'POST', body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.message || 'Could not analyse this document');
      const d = body.data as ExtractedSetup;
      setData(d);
      const s = new Set<SetupSection>();
      if (Object.keys(d.profile).length) s.add('profile');
      if (d.timings.length) s.add('timings');
      if (d.people.length) s.add('people');
      if (d.services.length) s.add('services');
      if (d.faqs.length) s.add('faqs');
      if (d.knowledge) s.add('knowledge');
      setSections(s);
      if (!s.size) toast.warning('No business details were found in this document.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Analysis failed');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (s: SetupSection) => setSections((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  const rows: Array<{ key: SetupSection; label: string; icon: React.ElementType; count: number; preview: string }> = data
    ? [
        { key: 'profile', label: 'Business profile', icon: Building2, count: Object.keys(data.profile).length, preview: [data.profile.name, data.profile.city, data.profile.phone].filter(Boolean).join(' · ') },
        { key: 'timings', label: 'Operating hours', icon: Clock, count: data.timings.filter((t) => !t.is_closed).length, preview: data.timings.filter((t) => !t.is_closed).slice(0, 2).map((t) => `${t.day_name.slice(0, 3)} ${t.opening_time}–${t.closing_time}`).join(', ') },
        { key: 'people', label: isHealthcare ? `Doctors (${data.departments.length} departments)` : 'Team / staff', icon: isHealthcare ? Stethoscope : Users, count: data.people.length, preview: data.people.slice(0, 3).map((p) => `${p.name}${p.department ? ` (${p.department})` : ''}`).join(', ') },
        { key: 'services', label: 'Services & prices', icon: Package, count: data.services.length, preview: data.services.slice(0, 3).map((s) => s.name).join(', ') },
        { key: 'faqs', label: 'FAQs', icon: HelpCircle, count: data.faqs.length, preview: data.faqs.slice(0, 2).map((f) => f.question).join(' · ') },
        { key: 'knowledge', label: 'AI knowledge notes', icon: Sparkles, count: data.knowledge ? 1 : 0, preview: data.knowledge.slice(0, 90) },
      ]
    : [];

  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><FileUp className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Fill setup automatically from a document</p>
          <p className="text-xs text-muted-foreground">
            Upload a brochure, {isHealthcare ? 'doctor roster, OPD timetable' : 'rate card, menu, prospectus'} or website export (PDF, Word, Excel, image · up to 50 MB). AI extracts the details; you approve before anything is saved.
          </p>
        </div>
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) analyse(f); e.target.value = ''; }} />
        <Button onClick={() => fileRef.current?.click()} disabled={busy} className="shrink-0 gap-1.5">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload document
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Review extracted details</DialogTitle>
            <DialogDescription>{busy ? `Reading ${fileName}…` : `From ${fileName}. Choose what to apply — you can still edit every field before saving.`}</DialogDescription>
          </DialogHeader>

          {busy && (
            <div className="space-y-2 py-2">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/60" />)}
              <p className="text-center text-xs text-muted-foreground">Large documents can take up to a minute.</p>
            </div>
          )}

          {data && !busy && (
            <div className="space-y-2">
              {rows.map((r) => (
                <label key={r.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${!r.count ? 'cursor-not-allowed opacity-50' : sections.has(r.key) ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40'}`}>
                  <input type="checkbox" disabled={!r.count} checked={sections.has(r.key)} onChange={() => toggle(r.key)} className="mt-1 size-4 accent-[var(--primary)]" />
                  <r.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">{r.label} <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{r.count || 'none found'}</span></span>
                    {r.preview && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{r.preview}</span>}
                  </span>
                </label>
              ))}
              {data.notes.map((n) => <p key={n} className="text-xs text-amber-600 dark:text-amber-400">• {n}</p>)}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              disabled={busy || !data || sections.size === 0}
              onClick={() => { if (data) { onApply(data, sections); setOpen(false); toast.success('Details applied — review each step and click Save.'); } }}
              className="gap-1.5"
            >
              <CheckCircle2 className="size-4" /> Approve &amp; apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
