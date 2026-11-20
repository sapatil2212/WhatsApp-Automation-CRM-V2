'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/campaigns/api';
import { AiModalShell } from './ai-modal-shell';
import type { Suggestion } from './voice-dictation';

export interface ComplaintFields {
  complaint?: string;
  symptoms?: string;
  duration?: string;
  severity?: string;
}

/**
 * "AI Prescription": the doctor enters the chief complaint details (the same
 * fields as section A of the form) and the AI drafts the rest. Whatever the
 * doctor typed here wins over anything the AI would write for those fields.
 * Everything lands in the form as unconfirmed suggestions.
 */
export function AiPrescriptionModal({ consultationId, initial, onClose, onSuggestion }: { consultationId: string; initial?: ComplaintFields; onClose: () => void; onSuggestion: (s: Suggestion) => void }) {
  const [complaint, setComplaint] = useState(initial?.complaint ?? '');
  const [symptoms, setSymptoms] = useState(initial?.symptoms ?? '');
  const [duration, setDuration] = useState(initial?.duration ?? '');
  const [severity, setSeverity] = useState(initial?.severity ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    const main = complaint.trim();
    if (main.length < 3) return setError('Enter the main reason for the visit.');
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ suggestion: Suggestion }>(`/api/healthcare/consultations/${consultationId}/suggest`, {
        method: 'POST',
        json: { complaint: main, symptoms: symptoms.trim() || undefined, duration: duration.trim() || undefined, severity: severity || undefined },
      });
      const typed: Record<string, string> = { complaint: main };
      if (symptoms.trim()) typed.symptoms = symptoms.trim();
      if (duration.trim()) typed.duration = duration.trim();
      if (severity) typed.severity = severity;
      const s = res.data.suggestion;
      onSuggestion({ ...s, chiefComplaint: { ...s.chiefComplaint, ...typed } });
      toast.success('Prescription drafted — review and confirm each line.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const label = 'text-[11px] font-medium text-muted-foreground';

  return (
    <AiModalShell title="AI Prescription" subtitle="Enter the chief complaint. AI drafts the rest of the prescription for your review." icon={<Sparkles className="size-4" />} busy={busy} onClose={onClose}>
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className={label}>Main reason for visit *</span>
          <Input autoFocus value={complaint} maxLength={500} disabled={busy} onChange={(e) => setComplaint(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void generate(); }} placeholder="e.g. Fever and sore throat" className="h-8 text-xs md:text-xs" />
        </label>
        <label className="block space-y-1">
          <span className={label}>Symptoms</span>
          <Textarea rows={2} value={symptoms} maxLength={1000} disabled={busy} onChange={(e) => setSymptoms(e.target.value)} placeholder="e.g. Body ache, chills, dry cough" className="min-h-0 py-1.5 text-xs md:text-xs" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={label}>Duration</span>
            <Input value={duration} maxLength={120} disabled={busy} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 3 days" className="h-8 text-xs md:text-xs" />
          </label>
          <label className="block space-y-1">
            <span className={label}>Severity</span>
            <select value={severity} disabled={busy} onChange={(e) => setSeverity(e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
              <option value="">—</option>
              <option>Mild</option>
              <option>Moderate</option>
              <option>Severe</option>
            </select>
          </label>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" role="alert">{error}</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        AI also uses the patient&apos;s age, sex, allergies, conditions and current medicines. The draft is a suggestion only: every diagnosis and medicine stays unconfirmed until you review it.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={generate} disabled={busy || complaint.trim().length < 3}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} {busy ? 'Drafting…' : 'Generate prescription'}
        </Button>
      </div>
    </AiModalShell>
  );
}