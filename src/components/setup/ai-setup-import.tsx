'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Building2, CheckCircle2, Clock, HelpCircle, Loader2, Package, PenLine, Sparkles, Stethoscope, Upload, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
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
  const [typeOpen, setTypeOpen] = useState(false);
  const [typed, setTyped] = useState('');

  async function analyse(source: File | string) {
    if (typeof source !== 'string' && source.size > 50 * 1024 * 1024) return toast.error('Documents must be 50 MB or smaller.');
    if (typeof source === 'string' && source.trim().length < 20) return toast.error('Write a little more about the business first.');
    setFileName(typeof source === 'string' ? 'your typed details' : source.name);
    setTypeOpen(false);
    setBusy(true);
    setOpen(true);
    setData(null);
    try {
      const fd = new FormData();
      if (typeof source === 'string') fd.append('text', source.trim());
      else fd.append('file', source);
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
      if (!s.size) toast.warning('No business details were found.');
      if (typeof source === 'string') setTyped('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Analysis failed');
      setOpen(false);
      if (typeof source === 'string') setTypeOpen(true); // keep the text so nothing typed is lost
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
      <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-3.5 py-3 sm:flex-row sm:items-center">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">Train the AI on your business</p>
          <p className="text-[11px] text-muted-foreground">
            Upload a brochure, {isHealthcare ? 'doctor roster, OPD timetable' : 'rate card, menu, prospectus'} or website export (PDF, Word, Excel, image · up to 50 MB), or just type the details. AI fills every step below; you approve before anything is saved.
          </p>
        </div>
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) analyse(f); e.target.value = ''; }} />
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => setTypeOpen(true)} disabled={busy} className="gap-1.5">
            <PenLine className="size-3.5" /> Type details
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Upload document
          </Button>
        </div>
      </div>

      <Dialog open={typeOpen} onOpenChange={setTypeOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PenLine className="size-4 text-primary" /> Describe your business</DialogTitle>
            <DialogDescription>
              Write or paste anything: {isHealthcare ? 'doctors and their timings, departments, fees, services, clinic hours, address, policies' : 'team, services and prices, opening hours, address, policies'}. The AI sorts it into the setup steps.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            rows={12}
            autoFocus
            className="text-[13px] leading-relaxed"
            placeholder={isHealthcare
              ? 'e.g. Sunrise Clinic, 12 MG Road, Pune. Open Mon-Sat 9 AM-8 PM, Sunday closed.\nDr. Asha Patil, MD (Paediatrics), Mon-Fri 10 AM-2 PM, fee ₹600.\nBlood test from ₹300. Free parking. We accept cards and UPI. Cancellations free up to 2 hours before.'
              : 'e.g. Business name, address, opening hours, services with prices, team members, policies…'}
          />
          <p className="text-[11px] text-muted-foreground">{typed.trim() ? `${typed.trim().split(/\s+/).length.toLocaleString()} words` : 'Tip: more detail gives better answers on WhatsApp.'}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTypeOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => analyse(typed)} disabled={typed.trim().length < 20} className="gap-1.5">
              <Sparkles className="size-3.5" /> Analyse with AI
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Review extracted details</DialogTitle>
            <DialogDescription>{busy ? `Reading ${fileName}…` : `From ${fileName}. Choose what to apply. The chosen sections are saved straight away; you can edit them in each step afterwards.`}</DialogDescription>
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
                  <input type="checkbox" disabled={!r.count} checked={sections.has(r.key)} onChange={() => toggle(r.key)} className="mt-1 size-4 rx-check" />
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
              onClick={() => { if (data) { onApply(data, sections); setOpen(false);  } }}
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
