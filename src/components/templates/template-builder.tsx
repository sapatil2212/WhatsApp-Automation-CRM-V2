'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertTriangle, AlignLeft, ArrowLeft, ArrowRight, BrainCircuit, Check, CheckCircle2, ChevronRight,
  Clock, FileText, Image as ImageIcon, Info, KeyRound, Lightbulb, Link2, Loader2, MessageSquareReply,
  Phone, Plus, RotateCcw, Send, ShieldCheck, Sparkles, Trash2, Upload, Video, Wand2, XCircle,
} from 'lucide-react';

import type { ReviewResult } from '@/app/api/ai/template-review/route';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PhonePreview } from '@/components/templates/phone-preview';
import {
  authBodyPreview,
  authFooterPreview,
  DEFAULT_AUTH_OPTIONS,
  hasBlockingIssues,
  LIMITS,
  maxPlaceholder,
  normalizeTemplateName,
  TEMPLATE_CATEGORIES,
  templateFingerprint,
  validateTemplate,
  type TemplateButtonType,
  type TemplateCategory,
  type TemplateDraft,
  type TemplateHeaderType,
  type TemplateIssue,
} from '@/lib/whatsapp/template-rules';

// ─── constants ─────────────────────────────────────────────────────

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'en_GB', label: 'English (UK)' },
  { code: 'hi', label: 'Hindi' },
  { code: 'mr', label: 'Marathi' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'kn', label: 'Kannada' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'bn', label: 'Bengali' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ur', label: 'Urdu' },
  { code: 'ar', label: 'Arabic' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt_BR', label: 'Portuguese (Brazil)' },
  { code: 'id', label: 'Indonesian' },
];

const CATEGORY_HELP: Record<TemplateCategory, string> = {
  Marketing: 'Offers, announcements, newsletters, re-engagement.',
  Utility: 'Transactional: orders, bookings, payments, account updates.',
  Authentication: 'One-time passcodes only. Meta supplies the wording.',
};

const AI_EXAMPLES = [
  'Order shipped with tracking number and delivery date',
  'Appointment reminder for tomorrow with reschedule option',
  'Payment received receipt with invoice number and amount',
  'Festive sale: 20% off this weekend, shop now',
  'Welcome message for a new member with next steps',
  'Login verification code',
];

export const EMPTY_DRAFT: TemplateDraft = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_type: 'none',
  header_text: '',
  header_example: '',
  header_text_example: '',
  body_text: '',
  body_example: [],
  footer_text: '',
  buttons: [],
};

const STEPS = [
  { id: 1, label: 'Compose', desc: 'AI or manual' },
  { id: 2, label: 'Review', desc: 'Policy check' },
  { id: 3, label: 'Submit', desc: 'Send to Meta' },
];

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'done'; status: string; resubmitted: boolean; name: string; language: string }
  | { phase: 'error'; message: string };

// ─── small pieces ──────────────────────────────────────────────────

function Counter({ value, max }: { value: number; max: number }) {
  const over = value > max;
  const near = value > max * 0.9;
  return (
    <span className={`text-[10px] tabular-nums ${over ? 'font-bold text-red-500' : near ? 'text-amber-500' : 'text-muted-foreground'}`}>
      {value}/{max}
    </span>
  );
}

function FieldIssues({ issues }: { issues: TemplateIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1">
      {issues.map((i) => (
        <li
          key={i.id}
          className={`flex items-start gap-1.5 text-[11px] leading-snug ${i.severity === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
        >
          {i.severity === 'error' ? <XCircle className="mt-0.5 size-3 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3 shrink-0" />}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function Section({ icon: Icon, title, hint, right, children }: {
  icon: React.ElementType; title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function StepBar({ step }: { step: number }) {
  return (
    <ol className="flex items-center" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center">
          <div className="flex items-center gap-2" aria-current={step === s.id ? 'step' : undefined}>
            <span
              className={`flex size-7 items-center justify-center rounded-full text-[11px] font-bold transition-all ${
                step > s.id
                  ? 'bg-emerald-600 text-white'
                  : step === s.id
                    ? 'bg-emerald-600 text-white ring-4 ring-emerald-500/15'
                    : 'border border-slate-200 bg-slate-50 text-muted-foreground dark:border-slate-700 dark:bg-slate-800'
              }`}
            >
              {step > s.id ? <Check className="size-3.5" /> : s.id}
            </span>
            <span className="hidden text-left md:block">
              <span className={`block text-xs font-semibold ${step >= s.id ? 'text-slate-800 dark:text-slate-100' : 'text-muted-foreground'}`}>{s.label}</span>
              <span className="block text-[10px] leading-none text-muted-foreground">{s.desc}</span>
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <span className={`mx-3 h-0.5 w-6 rounded-full md:w-12 ${step > s.id ? 'bg-emerald-600' : 'bg-slate-200 dark:bg-slate-800'}`} />
          )}
        </li>
      ))}
    </ol>
  );
}

// ─── builder ───────────────────────────────────────────────────────

interface TemplateBuilderProps {
  initial: TemplateDraft;
  /** "edit" = resubmitting an existing (rejected) template: name/language are locked. */
  mode: 'new' | 'edit';
  existingKeys: Set<string>;
  /** Prefills the AI description (e.g. a brief handed over by the campaign planner). */
  initialAiDescription?: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function TemplateBuilder({ initial, mode, existingKeys, initialAiDescription, onClose, onSubmitted }: TemplateBuilderProps) {
  const [form, setForm] = useState<TemplateDraft>(initial);
  const [step, setStep] = useState(1);
  const [composeMode, setComposeMode] = useState<'ai' | 'manual'>(mode === 'edit' || initial.body_text ? 'manual' : 'ai');

  // AI drafting
  const [aiDescription, setAiDescription] = useState((initialAiDescription ?? '').slice(0, 1500));
  const [aiCategory, setAiCategory] = useState<'auto' | TemplateCategory>('auto');
  const [aiLanguage, setAiLanguage] = useState(initial.language || 'en_US');
  const [aiBusiness, setAiBusiness] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<{ rationale: string; warnings: string[] } | null>(null);
  const [aiDraftError, setAiDraftError] = useState<string | null>(null);

  // Review
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewedPrint, setReviewedPrint] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Media
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{ url: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => () => { if (mediaPreview) URL.revokeObjectURL(mediaPreview.url); }, [mediaPreview]);

  const isAuth = form.category === 'Authentication';
  const bodyVarCount = useMemo(() => maxPlaceholder(form.body_text), [form.body_text]);
  const headerHasVar = form.header_type === 'text' && /\{\{\s*1\s*\}\}/.test(form.header_text);
  const issues = useMemo(() => {
    const list = validateTemplate(form);
    if (mode === 'new' && form.name && existingKeys.has(`${form.name}:${form.language}`)) {
      list.unshift({ id: 'NAME_TAKEN', field: 'name', severity: 'error', message: 'You already have a template with this name and language.' });
    }
    return list;
  }, [form, mode, existingKeys]);
  const blocking = hasBlockingIssues(issues);
  const fieldIssues = (field: TemplateIssue['field']) => (showErrors ? issues : issues.filter((i) => i.severity === 'warning' || i.id.endsWith('LENGTH') || i.id.includes('EMOJI') || i.id.includes('FMT')))
    .filter((i) => i.field === field);
  const fingerprint = templateFingerprint(form);
  const reviewIsCurrent = Boolean(review && reviewedPrint === fingerprint);

  function update(patch: Partial<TemplateDraft>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  // Keep the samples array the same length as the number of variables.
  useEffect(() => {
    setForm((prev) => {
      if (prev.body_example.length === bodyVarCount) return prev;
      return { ...prev, body_example: Array.from({ length: bodyVarCount }, (_, i) => prev.body_example[i] ?? '') };
    });
  }, [bodyVarCount]);

  function setCategory(category: TemplateCategory) {
    update({ category, auth: category === 'Authentication' ? form.auth ?? DEFAULT_AUTH_OPTIONS : undefined });
  }

  function insertVariable() {
    const el = bodyRef.current;
    const token = `{{${bodyVarCount + 1}}}`;
    if (!el) return update({ body_text: `${form.body_text}${token}` });
    const start = el.selectionStart ?? form.body_text.length;
    const end = el.selectionEnd ?? start;
    const next = form.body_text.slice(0, start) + token + form.body_text.slice(end);
    update({ body_text: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function wrapSelection(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    if (s === e) return;
    update({ body_text: form.body_text.slice(0, s) + marker + form.body_text.slice(s, e) + marker + form.body_text.slice(e) });
  }

  function addButton(type: TemplateButtonType) {
    if (form.buttons.length >= LIMITS.maxButtons) return toast.error(`Up to ${LIMITS.maxButtons} buttons are allowed.`);
    if (type === 'URL' && form.buttons.filter((b) => b.type === 'URL').length >= LIMITS.maxUrlButtons) return toast.error('Up to 2 website buttons are allowed.');
    if (type === 'PHONE_NUMBER' && form.buttons.some((b) => b.type === 'PHONE_NUMBER')) return toast.error('Only one call button is allowed.');
    const btn = { type, text: '', url: '', phone_number: '', example: '' };
    // Keep quick replies grouped before call-to-action buttons.
    setForm((prev) => {
      const quick = prev.buttons.filter((b) => b.type === 'QUICK_REPLY');
      const ctas = prev.buttons.filter((b) => b.type !== 'QUICK_REPLY');
      return { ...prev, buttons: type === 'QUICK_REPLY' ? [...quick, btn, ...ctas] : [...quick, ...ctas, btn] };
    });
  }
  function updateButton(index: number, patch: Partial<TemplateDraft['buttons'][number]>) {
    setForm((prev) => ({ ...prev, buttons: prev.buttons.map((b, i) => (i === index ? { ...b, ...patch } : b)) }));
  }
  function removeButton(index: number) {
    setForm((prev) => ({ ...prev, buttons: prev.buttons.filter((_, i) => i !== index) }));
  }

  async function uploadMedia(file: File) {
    const kind = form.header_type;
    setMediaUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const res = await fetch('/api/whatsapp/templates/media', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      update({ header_example: data.handle });
      setMediaPreview({ url: URL.createObjectURL(file), name: file.name });
      toast.success('Sample uploaded to Meta');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setMediaUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function generateAiDraft() {
    if (aiDescription.trim().length < 3) return;
    setAiDrafting(true);
    setAiDraftError(null);
    try {
      const res = await fetch('/api/ai/template-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: aiDescription.trim(),
          category: aiCategory,
          language: aiLanguage,
          businessContext: aiBusiness.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `AI drafting failed (HTTP ${res.status})`);
      const draft = data?.data?.draft;
      if (!draft) throw new Error('The AI returned an empty draft. Please try again.');

      const name = mode === 'edit' ? form.name : draft.name;
      setForm({
        ...EMPTY_DRAFT,
        name,
        category: draft.category,
        language: mode === 'edit' ? form.language : draft.language,
        header_type: draft.header_type,
        header_text: draft.header_text ?? '',
        header_text_example: draft.header_text_example ?? '',
        body_text: draft.body_text ?? '',
        body_example: draft.body_example ?? [],
        footer_text: draft.footer_text ?? '',
        buttons: draft.buttons ?? [],
        auth: draft.category === 'Authentication' ? DEFAULT_AUTH_OPTIONS : undefined,
      });
      setAiNote({ rationale: draft.rationale, warnings: draft.warnings ?? [] });
      setMediaPreview(null);
      setComposeMode('manual');
      toast.success('Draft ready — review and edit anything below.');
    } catch (err) {
      setAiDraftError(err instanceof Error ? err.message : 'AI drafting failed');
    } finally {
      setAiDrafting(false);
    }
  }

  async function runReview(): Promise<ReviewResult | null> {
    setReviewing(true);
    setReviewError(null);
    const print = templateFingerprint(form);
    try {
      const res = await fetch('/api/ai/template-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Review failed (HTTP ${res.status})`);
      setReview(data);
      setReviewedPrint(print);
      return data as ReviewResult;
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Review failed');
      return null;
    } finally {
      setReviewing(false);
    }
  }

  async function goToReview() {
    setShowErrors(true);
    if (blocking) {
      toast.error('Fix the highlighted issues first.');
      return;
    }
    setStep(2);
    if (!reviewIsCurrent) await runReview();
  }

  async function handleSubmit() {
    let current = reviewIsCurrent ? review : null;
    if (!current) current = await runReview();
    if (!current?.passed) {
      setStep(2);
      toast.error('The review found issues to fix before submitting.');
      return;
    }
    setSubmit({ phase: 'submitting' });
    try {
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, name: normalizeTemplateName(form.name) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Submission failed (HTTP ${res.status})`);
      setSubmit({
        phase: 'done',
        status: String(data.meta_status ?? 'PENDING').toUpperCase(),
        resubmitted: Boolean(data.resubmitted),
        name: data.template?.name ?? form.name,
        language: data.template?.language ?? form.language,
      });
      onSubmitted();
    } catch (err) {
      setSubmit({ phase: 'error', message: err instanceof Error ? err.message : 'Submission failed' });
    }
  }

  const previewBody = isAuth ? authBodyPreview(form.auth) : form.body_text;
  const previewFooter = isAuth ? authFooterPreview(form.auth) : form.footer_text;
  const previewButtons = isAuth
    ? [{ type: 'QUICK_REPLY' as const, text: form.auth?.button_text || 'Copy code' }]
    : form.buttons.filter((b) => b.text.trim());

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.length - errorCount;

  return (
    <div className="fixed bottom-0 left-0 right-0 top-14 z-30 flex flex-col overflow-hidden bg-slate-50/60 dark:bg-background lg:left-60">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950 md:px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 gap-1.5 text-xs text-muted-foreground">
            <ArrowLeft className="size-3.5" /> Templates
          </Button>
          <div className="hidden h-5 w-px bg-slate-200 dark:bg-slate-800 sm:block" />
          <StepBar step={step} />
        </div>
        <div className="flex items-center gap-2">
          {step > 1 && submit.phase !== 'done' && (
            <Button variant="outline" size="sm" onClick={() => setStep(step - 1)} className="h-9 text-xs">
              Back
            </Button>
          )}
          {step === 1 && (
            <Button onClick={goToReview} disabled={!form.body_text.trim() && !isAuth} className="h-9 gap-1.5 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700">
              Review <ChevronRight className="size-4" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={!review?.passed || reviewing || !reviewIsCurrent} className="h-9 gap-1.5 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700">
              Continue <ChevronRight className="size-4" />
            </Button>
          )}
          {step === 3 && submit.phase !== 'done' && (
            <Button onClick={handleSubmit} disabled={submit.phase === 'submitting' || reviewing} className="h-9 gap-1.5 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700">
              {submit.phase === 'submitting' || reviewing ? (
                <><Loader2 className="size-4 animate-spin" /> {reviewing ? 'Re-checking…' : 'Submitting…'}</>
              ) : (
                <><Send className="size-4" /> {mode === 'edit' ? 'Resubmit to Meta' : 'Submit to Meta'}</>
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <div className="mx-auto max-w-2xl">
            <AnimatePresence mode="wait">
              {/* ───────────── STEP 1: COMPOSE ───────────── */}
              {step === 1 && (
                <motion.div key="s1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      {mode === 'edit' ? `Fix & resubmit ${form.name}` : 'Create a message template'}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground dark:text-slate-400">
                      Templates are required to message customers outside the 24-hour window. Meta reviews each one before it can be sent.
                    </p>
                  </div>

                  {/* Mode switch */}
                  <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900/40">
                    {([
                      ['ai', 'Write with AI', Sparkles],
                      ['manual', 'Build manually', AlignLeft],
                    ] as const).map(([key, label, Icon]) => (
                      <button
                        key={key}
                        role="tab"
                        aria-selected={composeMode === key}
                        onClick={() => setComposeMode(key)}
                        className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors ${
                          composeMode === key
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-muted-foreground hover:bg-slate-50 hover:text-slate-800 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
                        }`}
                      >
                        <Icon className="size-3.5" /> {label}
                      </button>
                    ))}
                  </div>

                  {composeMode === 'ai' && (
                    <section className="space-y-4 rounded-xl border border-emerald-200/80 bg-gradient-to-b from-emerald-50/70 to-white p-5 dark:border-emerald-500/20 dark:from-emerald-500/[0.06] dark:to-transparent">
                      <div className="flex items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
                          <Wand2 className="size-4" />
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-slate-800 dark:text-white">Describe the message you want to send</h3>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground dark:text-slate-400">
                            Gemini picks the right category, adds variables with sample values and follows Meta&apos;s rules. You can edit everything afterwards.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Textarea
                          value={aiDescription}
                          onChange={(e) => setAiDescription(e.target.value.slice(0, 1500))}
                          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generateAiDraft(); }}
                          placeholder="e.g. Tell customers their order has shipped, include the order number, courier and expected delivery date, with a button to track it."
                          rows={4}
                          className="resize-none bg-white text-[13px] dark:bg-slate-950"
                          aria-label="Describe your template"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {AI_EXAMPLES.map((ex) => (
                            <button
                              key={ex}
                              type="button"
                              onClick={() => setAiDescription(ex)}
                              className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] text-emerald-800 transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-500/20 dark:bg-slate-950 dark:text-emerald-300"
                            >
                              {ex}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-[11px] font-semibold text-muted-foreground dark:text-slate-300">Category</Label>
                          <Select value={aiCategory} onValueChange={(v) => setAiCategory((v || 'auto') as 'auto' | TemplateCategory)}>
                            <SelectTrigger className="h-9 bg-white text-xs dark:bg-slate-950"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">Let AI decide</SelectItem>
                              {TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] font-semibold text-muted-foreground dark:text-slate-300">Language</Label>
                          <Select value={aiLanguage} onValueChange={(v) => setAiLanguage(v || 'en_US')} disabled={mode === 'edit'}>
                            <SelectTrigger className="h-9 bg-white text-xs dark:bg-slate-950"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-muted-foreground dark:text-slate-300">
                          Website / phone for buttons <span className="font-normal text-muted-foreground">(optional)</span>
                        </Label>
                        <Input
                          value={aiBusiness}
                          onChange={(e) => setAiBusiness(e.target.value.slice(0, 500))}
                          placeholder="e.g. https://shop.example.com/track, +919876543210"
                          className="h-9 bg-white text-xs dark:bg-slate-950"
                        />
                        <p className="text-[10px] text-muted-foreground">AI never invents links or numbers — buttons are only added from what you provide here.</p>
                      </div>

                      {aiDraftError && (
                        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/5 dark:text-red-400">
                          <XCircle className="mt-0.5 size-3.5 shrink-0" />
                          <span className="flex-1">{aiDraftError}</span>
                          <button onClick={generateAiDraft} className="font-semibold underline-offset-2 hover:underline">Retry</button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          onClick={generateAiDraft}
                          disabled={aiDrafting || aiDescription.trim().length < 3}
                          className="h-9 gap-1.5 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          {aiDrafting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                          {aiDrafting ? 'Writing your template…' : 'Generate template'}
                        </Button>
                        <span className="text-[10px] text-muted-foreground">Ctrl + Enter · nothing is sent to Meta yet</span>
                      </div>
                    </section>
                  )}

                  {composeMode === 'manual' && (
                    <>
                      {aiNote && (
                        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/5">
                          <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-300">AI draft applied</p>
                            <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-400/80">{aiNote.rationale}</p>
                            {aiNote.warnings.length > 0 && (
                              <ul className="list-disc pl-4 text-[11px] text-amber-700 dark:text-amber-400">
                                {aiNote.warnings.map((w) => <li key={w}>{w}</li>)}
                              </ul>
                            )}
                          </div>
                          <button onClick={() => setComposeMode('ai')} className="shrink-0 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
                            Regenerate
                          </button>
                        </div>
                      )}

                      {/* Basics */}
                      <Section icon={Info} title="Basics">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="tpl-name" className="text-[11px] font-semibold text-muted-foreground dark:text-slate-300">Template name</Label>
                            <Counter value={form.name.length} max={LIMITS.nameMaxLength} />
                          </div>
                          <Input
                            id="tpl-name"
                            placeholder="order_shipped_update"
                            value={form.name}
                            disabled={mode === 'edit'}
                            onChange={(e) => update({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_{2,}/g, '_') })}
                            className="h-9 font-mono text-xs"
                          />
                          <FieldIssues issues={fieldIssues('name')} />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-[11px] font-semibold text-muted-foreground dark:text-slate-300">Language</Label>
                            <Select value={form.language} onValueChange={(v) => update({ language: v || 'en_US' })} disabled={mode === 'edit'}>
                              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label} <span className="text-muted-foreground">· {l.code}</span></SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[11px] font-semibold text-muted-foreground dark:text-slate-300">Category</Label>
                            <Select value={form.category} onValueChange={(v) => setCategory((v || 'Marketing') as TemplateCategory)}>
                              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground dark:text-slate-400">{CATEGORY_HELP[form.category]}</p>
                        <FieldIssues issues={fieldIssues('category')} />
                      </Section>

                      {isAuth ? (
                        <Section icon={KeyRound} title="One-time passcode settings">
                          <p className="text-[11px] leading-relaxed text-muted-foreground dark:text-slate-400">
                            Meta writes the message for authentication templates. You choose the security note, expiry and button label; your app supplies the code when sending.
                          </p>
                          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                            <span>
                              <span className="block text-xs font-semibold text-muted-foreground dark:text-slate-200">Add security recommendation</span>
                              <span className="block text-[11px] text-muted-foreground">&ldquo;For your security, do not share this code.&rdquo;</span>
                            </span>
                            <Switch
                              checked={form.auth?.add_security_recommendation ?? true}
                              onCheckedChange={(v) => update({ auth: { ...(form.auth ?? DEFAULT_AUTH_OPTIONS), add_security_recommendation: Boolean(v) } })}
                            />
                          </label>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-[11px] font-semibold text-muted-foreground dark:text-slate-300">Code expires after (minutes)</Label>
                              <Input
                                type="number"
                                min={0}
                                max={90}
                                value={form.auth?.code_expiration_minutes ?? ''}
                                onChange={(e) => update({ auth: { ...(form.auth ?? DEFAULT_AUTH_OPTIONS), code_expiration_minutes: e.target.value === '' ? undefined : Number(e.target.value) } })}
                                className="h-9 text-xs"
                                placeholder="Leave empty for no expiry"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px] font-semibold text-muted-foreground dark:text-slate-300">Copy-code button label</Label>
                              <Input
                                value={form.auth?.button_text ?? ''}
                                maxLength={LIMITS.buttonTextMaxLength}
                                onChange={(e) => update({ auth: { ...(form.auth ?? DEFAULT_AUTH_OPTIONS), button_text: e.target.value } })}
                                className="h-9 text-xs"
                              />
                            </div>
                          </div>
                          <FieldIssues issues={[...fieldIssues('footer'), ...fieldIssues('buttons')]} />
                        </Section>
                      ) : (
                        <>
                          {/* Header */}
                          <Section icon={FileText} title="Header" hint="optional">
                            <div className="grid grid-cols-5 gap-2">
                              {([
                                ['none', 'None', null],
                                ['text', 'Text', AlignLeft],
                                ['image', 'Image', ImageIcon],
                                ['video', 'Video', Video],
                                ['document', 'PDF', FileText],
                              ] as const).map(([type, label, Icon]) => (
                                <button
                                  key={type}
                                  type="button"
                                  aria-pressed={form.header_type === type}
                                  onClick={() => { update({ header_type: type as TemplateHeaderType, header_example: '' }); setMediaPreview(null); }}
                                  className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-[11px] transition-all ${
                                    form.header_type === type
                                      ? 'border-emerald-500 bg-emerald-500/5 font-semibold text-emerald-700 dark:text-emerald-400'
                                      : 'border-slate-200 text-muted-foreground hover:border-slate-300 dark:border-slate-800 dark:text-slate-400'
                                  }`}
                                >
                                  {Icon && <Icon className="size-3.5" />}
                                  {label}
                                </button>
                              ))}
                            </div>

                            {form.header_type === 'text' && (
                              <div className="space-y-2">
                                <div className="relative">
                                  <Input
                                    placeholder="e.g. Your order is on its way"
                                    value={form.header_text}
                                    onChange={(e) => update({ header_text: e.target.value.replace(/\n/g, '') })}
                                    className="h-9 pr-14 text-xs"
                                  />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2"><Counter value={form.header_text.length} max={LIMITS.headerTextMaxLength} /></span>
                                </div>
                                {headerHasVar && (
                                  <Input
                                    placeholder="Sample value for header {{1}}"
                                    value={form.header_text_example}
                                    onChange={(e) => update({ header_text_example: e.target.value })}
                                    className="h-9 text-xs"
                                  />
                                )}
                              </div>
                            )}

                            {(form.header_type === 'image' || form.header_type === 'video' || form.header_type === 'document') && (
                              <div className="space-y-2">
                                <input
                                  ref={fileRef}
                                  type="file"
                                  className="hidden"
                                  accept={form.header_type === 'image' ? 'image/jpeg,image/png' : form.header_type === 'video' ? 'video/mp4,video/3gpp' : 'application/pdf'}
                                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f); }}
                                />
                                <button
                                  type="button"
                                  onClick={() => fileRef.current?.click()}
                                  disabled={mediaUploading}
                                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-xs text-muted-foreground transition-colors hover:border-emerald-500 hover:text-emerald-700 dark:border-slate-700"
                                >
                                  {mediaUploading ? <Loader2 className="size-4 animate-spin" /> : form.header_example ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Upload className="size-4" />}
                                  {mediaUploading
                                    ? 'Uploading sample to Meta…'
                                    : form.header_example
                                      ? `${mediaPreview?.name ?? 'Sample uploaded'} — click to replace`
                                      : `Upload a sample ${form.header_type === 'document' ? 'PDF' : form.header_type} (${form.header_type === 'image' ? 'JPG/PNG, ≤5 MB' : form.header_type === 'video' ? 'MP4, ≤16 MB' : '≤16 MB'})`}
                                </button>
                                <p className="text-[10px] text-muted-foreground">Meta reviews this sample. When sending, you can attach a different file each time.</p>
                              </div>
                            )}
                            <FieldIssues issues={fieldIssues('header')} />
                          </Section>

                          {/* Body */}
                          <Section
                            icon={AlignLeft}
                            title="Message body"
                            right={<Counter value={form.body_text.length} max={LIMITS.bodyMaxLength} />}
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Button type="button" variant="outline" size="sm" onClick={insertVariable} className="h-7 gap-1 text-[11px]">
                                <Plus className="size-3" /> Add variable
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => wrapSelection('*')} className="h-7 w-7 p-0 text-[11px] font-bold" aria-label="Bold">B</Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => wrapSelection('_')} className="h-7 w-7 p-0 text-[11px] italic" aria-label="Italic">I</Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => wrapSelection('~')} className="h-7 w-7 p-0 text-[11px] line-through" aria-label="Strikethrough">S</Button>
                            </div>
                            <Textarea
                              ref={bodyRef}
                              placeholder="Hi {{1}}, your order {{2}} has shipped and should arrive by {{3}}."
                              value={form.body_text}
                              onChange={(e) => update({ body_text: e.target.value })}
                              rows={6}
                              className="resize-y text-[13px] leading-relaxed"
                              aria-label="Message body"
                            />
                            <FieldIssues issues={fieldIssues('body')} />

                            {bodyVarCount > 0 && (
                              <div className="space-y-2.5 rounded-lg border border-slate-100 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
                                <div>
                                  <p className="text-[11px] font-semibold text-muted-foreground dark:text-slate-200">Sample values</p>
                                  <p className="text-[10px] text-muted-foreground">Meta reviewers see these in place of the variables. Use realistic examples.</p>
                                </div>
                                {Array.from({ length: bodyVarCount }).map((_, i) => (
                                  <div key={i} className="flex items-center gap-2.5">
                                    <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded-md bg-white font-mono text-[11px] font-semibold text-muted-foreground ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">{`{{${i + 1}}}`}</span>
                                    <Input
                                      placeholder={['e.g. Priya', 'e.g. ORD-48213', 'e.g. 12 Dec'][i] ?? 'Sample value'}
                                      value={form.body_example[i] ?? ''}
                                      onChange={(e) => {
                                        const next = [...form.body_example];
                                        next[i] = e.target.value;
                                        update({ body_example: next });
                                      }}
                                      className="h-8 bg-white text-xs dark:bg-slate-950"
                                    />
                                  </div>
                                ))}
                                <FieldIssues issues={fieldIssues('variables')} />
                              </div>
                            )}
                          </Section>

                          {/* Footer */}
                          <Section icon={Info} title="Footer" hint="optional" right={<Counter value={form.footer_text.length} max={LIMITS.footerMaxLength} />}>
                            <Input
                              placeholder={form.category === 'Marketing' ? 'e.g. Reply STOP to unsubscribe' : 'e.g. Thanks for shopping with us'}
                              value={form.footer_text}
                              onChange={(e) => update({ footer_text: e.target.value })}
                              className="h-9 text-xs"
                            />
                            <FieldIssues issues={fieldIssues('footer')} />
                          </Section>

                          {/* Buttons */}
                          <Section icon={MessageSquareReply} title="Buttons" hint="optional · up to 10">
                            <div className="grid grid-cols-3 gap-2">
                              {([
                                ['QUICK_REPLY', 'Quick reply', MessageSquareReply],
                                ['URL', 'Website', Link2],
                                ['PHONE_NUMBER', 'Call', Phone],
                              ] as const).map(([type, label, Icon]) => (
                                <button
                                  key={type}
                                  type="button"
                                  onClick={() => addButton(type)}
                                  className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2 py-2 text-[11px] text-muted-foreground transition-colors hover:border-emerald-500 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-400"
                                >
                                  <Icon className="size-3.5" /> {label}
                                </button>
                              ))}
                            </div>
                            {form.buttons.map((btn, i) => (
                              <div key={i} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                                <div className="flex items-center justify-between">
                                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    {btn.type === 'URL' ? <Link2 className="size-3" /> : btn.type === 'PHONE_NUMBER' ? <Phone className="size-3" /> : <MessageSquareReply className="size-3" />}
                                    {btn.type === 'URL' ? 'Website' : btn.type === 'PHONE_NUMBER' ? 'Call' : 'Quick reply'}
                                  </span>
                                  <button type="button" onClick={() => removeButton(i)} aria-label="Remove button" className="text-muted-foreground hover:text-red-500">
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </div>
                                <div className="relative">
                                  <Input
                                    placeholder="Button label"
                                    value={btn.text}
                                    maxLength={LIMITS.buttonTextMaxLength}
                                    onChange={(e) => updateButton(i, { text: e.target.value })}
                                    className="h-8 pr-12 text-xs"
                                  />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2"><Counter value={btn.text.length} max={LIMITS.buttonTextMaxLength} /></span>
                                </div>
                                {btn.type === 'URL' && (
                                  <>
                                    <Input
                                      placeholder="https://example.com/track/{{1}}"
                                      value={btn.url ?? ''}
                                      onChange={(e) => updateButton(i, { url: e.target.value.trim() })}
                                      className="h-8 font-mono text-xs"
                                    />
                                    {/\{\{\s*1\s*\}\}/.test(btn.url ?? '') ? (
                                      <Input
                                        placeholder="Sample value for {{1}}, e.g. ORD-48213"
                                        value={btn.example ?? ''}
                                        onChange={(e) => updateButton(i, { example: e.target.value })}
                                        className="h-8 text-xs"
                                      />
                                    ) : (
                                      <p className="text-[10px] text-muted-foreground">End the link with {'{{1}}'} to make it different for each customer.</p>
                                    )}
                                  </>
                                )}
                                {btn.type === 'PHONE_NUMBER' && (
                                  <Input
                                    placeholder="+919876543210"
                                    value={btn.phone_number ?? ''}
                                    onChange={(e) => updateButton(i, { phone_number: e.target.value.replace(/[^\d+]/g, '') })}
                                    className="h-8 font-mono text-xs"
                                  />
                                )}
                              </div>
                            ))}
                            <FieldIssues issues={fieldIssues('buttons')} />
                          </Section>
                        </>
                      )}
                    </>
                  )}
                </motion.div>
              )}

              {/* ───────────── STEP 2: REVIEW ───────────── */}
              {step === 2 && (
                <motion.div key="s2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                        <BrainCircuit className="size-5 text-emerald-600" /> Policy review
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground dark:text-slate-400">
                        Meta&apos;s format rules plus a Gemini check for category fit, tone and policy — to catch rejections before they happen.
                      </p>
                    </div>
                    {!reviewing && review && (
                      <Button size="sm" variant="outline" onClick={runReview} className="h-8 shrink-0 gap-1.5 text-xs">
                        <RotateCcw className="size-3" /> Re-run
                      </Button>
                    )}
                  </div>

                  {reviewing && (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white py-14 dark:border-slate-800 dark:bg-slate-900/40">
                      <Loader2 className="size-8 animate-spin text-emerald-600" />
                      <p className="text-sm font-semibold text-muted-foreground dark:text-slate-200">Reviewing your template…</p>
                      <p className="text-xs text-muted-foreground">This usually takes 5–15 seconds.</p>
                    </div>
                  )}

                  {reviewError && !reviewing && (
                    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-500/20 dark:bg-red-500/5">
                      <p className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400"><XCircle className="size-4" /> Review failed</p>
                      <p className="text-xs text-red-600/90 dark:text-red-400/80">{reviewError}</p>
                      <Button size="sm" variant="outline" onClick={runReview} className="gap-1.5 text-xs"><RotateCcw className="size-3.5" /> Try again</Button>
                    </div>
                  )}

                  {review && !reviewing && (
                    <>
                      {!reviewIsCurrent && (
                        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-300">
                          <AlertTriangle className="size-3.5" /> The template changed since this review.
                          <button className="ml-auto font-semibold hover:underline" onClick={runReview}>Re-run</button>
                        </div>
                      )}
                      <div className={`flex items-center gap-4 rounded-xl border p-5 ${review.passed ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/5' : 'border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/5'}`}>
                        <div className={`flex size-14 shrink-0 items-center justify-center rounded-full border-4 text-lg font-black ${review.passed ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'border-red-500 text-red-700 dark:text-red-400'}`}>
                          {review.score}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`flex items-center gap-1.5 text-sm font-bold ${review.passed ? 'text-emerald-800 dark:text-emerald-400' : 'text-red-800 dark:text-red-400'}`}>
                            {review.passed ? <ShieldCheck className="size-4" /> : <XCircle className="size-4" />}
                            {review.passed ? 'Ready to submit' : 'Fix these issues first'}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground dark:text-slate-300">{review.summary}</p>
                        </div>
                      </div>

                      {review.suggestedCategory && (
                        <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3.5 dark:border-sky-500/20 dark:bg-sky-500/5">
                          <Lightbulb className="size-4 shrink-0 text-sky-600" />
                          <p className="flex-1 text-xs text-sky-900 dark:text-sky-300">
                            This reads like a <strong>{review.suggestedCategory}</strong> template. Meta may recategorise it.
                          </p>
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => { setCategory(review.suggestedCategory!); setStep(1); }}>
                            Switch to {review.suggestedCategory}
                          </Button>
                        </div>
                      )}

                      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900/40">
                        {review.checks.map((c) => (
                          <div key={c.id} className={`flex items-start gap-3 px-4 py-3 ${!c.passed && c.severity === 'error' ? 'bg-red-50/60 dark:bg-red-500/[0.04]' : ''}`}>
                            <span className="mt-0.5 shrink-0">
                              {c.passed && c.severity !== 'warning' ? <CheckCircle2 className="size-4 text-emerald-500" /> : c.severity === 'error' ? <XCircle className="size-4 text-red-500" /> : <AlertTriangle className="size-4 text-amber-500" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                                {c.label}
                                <span className="rounded bg-slate-100 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground dark:bg-slate-800">{c.source === 'ai' ? 'AI' : 'Rule'}</span>
                              </p>
                              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground dark:text-slate-400">{c.message}</p>
                              {!c.passed && c.suggestion && (
                                <p className="mt-1 flex items-start gap-1.5 text-[11px] font-medium text-muted-foreground dark:text-slate-300">
                                  <ArrowRight className="mt-0.5 size-3 shrink-0 text-emerald-600" /> {c.suggestion}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {review.improvements.length > 0 && (
                        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
                          <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground dark:text-slate-200"><Lightbulb className="size-3.5 text-amber-500" /> Suggestions</p>
                          <ul className="list-disc space-y-1 pl-5 text-[11px] text-muted-foreground dark:text-slate-400">
                            {review.improvements.map((tip) => <li key={tip}>{tip}</li>)}
                          </ul>
                        </div>
                      )}

                      {!review.passed && (
                        <Button variant="outline" onClick={() => setStep(1)} className="w-full gap-1.5 text-xs">
                          <ArrowLeft className="size-3.5" /> Back to editor
                        </Button>
                      )}
                    </>
                  )}
                </motion.div>
              )}

              {/* ───────────── STEP 3: SUBMIT ───────────── */}
              {step === 3 && (
                <motion.div key="s3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="space-y-4">
                  {submit.phase === 'done' ? (
                    <div className="space-y-5 rounded-xl border border-emerald-200 bg-white p-6 text-center dark:border-emerald-500/20 dark:bg-slate-900/40">
                      <span className={`mx-auto flex size-14 items-center justify-center rounded-full ${submit.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'} dark:bg-emerald-500/10`}>
                        {submit.status === 'APPROVED' ? <CheckCircle2 className="size-7" /> : <Clock className="size-7" />}
                      </span>
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                          {submit.status === 'APPROVED' ? 'Approved and ready to send' : submit.resubmitted ? 'Resubmitted for review' : 'Submitted to Meta'}
                        </h2>
                        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground dark:text-slate-400">
                          <span className="font-mono">{submit.name}</span> ({submit.language}) is {submit.status === 'APPROVED' ? 'approved' : 'in Meta’s review queue'}.
                          {submit.status !== 'APPROVED' && ' Most reviews finish within minutes (up to 24 hours). The status updates automatically on the templates page.'}
                        </p>
                      </div>
                      <ol className="mx-auto grid max-w-sm gap-2 text-left">
                        {[
                          ['Submitted to Meta', true],
                          ['Meta review', submit.status === 'APPROVED'],
                          ['Ready for broadcasts & inbox', submit.status === 'APPROVED'],
                        ].map(([label, done], i) => (
                          <li key={String(label)} className="flex items-center gap-2.5 text-xs">
                            <span className={`flex size-5 items-center justify-center rounded-full text-[10px] font-bold ${done ? 'bg-emerald-600 text-white' : i === 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10' : 'bg-slate-100 text-muted-foreground dark:bg-slate-800'}`}>
                              {done ? <Check className="size-3" /> : i + 1}
                            </span>
                            <span className={done || i === 1 ? 'text-muted-foreground dark:text-slate-200' : 'text-muted-foreground'}>{label}</span>
                            {!done && i === 1 && <Loader2 className="size-3 animate-spin text-amber-500" />}
                          </li>
                        ))}
                      </ol>
                      <Button onClick={onClose} className="bg-emerald-600 text-xs text-white hover:bg-emerald-700">Back to templates</Button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Submit to Meta</h2>
                        <p className="mt-1 text-xs text-muted-foreground dark:text-slate-400">Check the summary, then submit. You&apos;ll see the review status on the templates page.</p>
                      </div>

                      <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white text-xs dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900/40">
                        {[
                          ['Name', <span key="n" className="font-mono">{form.name}</span>],
                          ['Category', form.category],
                          ['Language', LANGUAGES.find((l) => l.code === form.language)?.label ?? form.language],
                          ['Header', isAuth ? '—' : form.header_type === 'none' ? 'None' : form.header_type === 'text' ? form.header_text : `${form.header_type} (sample uploaded)`],
                          ['Variables', isAuth ? 'Verification code' : bodyVarCount ? form.body_example.map((v, i) => `{{${i + 1}}} = ${v}`).join(', ') : 'None'],
                          ['Buttons', previewButtons.length ? previewButtons.map((b) => b.text).join(', ') : 'None'],
                        ].map(([k, v]) => (
                          <div key={String(k)} className="flex items-start justify-between gap-4 px-4 py-2.5">
                            <dt className="w-24 shrink-0 text-muted-foreground">{k}</dt>
                            <dd className="text-right font-medium text-slate-800 dark:text-slate-100">{v}</dd>
                          </div>
                        ))}
                      </dl>

                      {review?.passed && reviewIsCurrent && (
                        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-400">
                          <ShieldCheck className="size-4 shrink-0" /> Review passed · score {review.score}/100
                        </div>
                      )}

                      {submit.phase === 'error' && (
                        <div className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/5">
                          <p className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400"><XCircle className="size-4" /> Meta did not accept the submission</p>
                          <p className="text-[11px] leading-relaxed text-red-600/90 dark:text-red-400/80">{submit.message}</p>
                          <button onClick={() => setStep(1)} className="text-[11px] font-semibold text-red-700 hover:underline dark:text-red-400">Edit template</button>
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Preview + checklist */}
        <aside className="hidden w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-200/70 bg-white/60 p-5 dark:border-slate-800 dark:bg-slate-900/20 lg:flex">
          <PhonePreview
            headerType={isAuth ? 'none' : form.header_type}
            headerText={form.header_type === 'text' ? form.header_text : undefined}
            headerSample={form.header_text_example}
            bodyText={previewBody}
            bodySamples={isAuth ? ['123456'] : form.body_example}
            footerText={previewFooter}
            buttons={previewButtons}
            mediaPreviewUrl={mediaPreview?.url}
            theme="light"
          />
          {step === 1 && composeMode === 'manual' && (
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
              <p className="mb-2 flex items-center justify-between text-[11px] font-semibold text-muted-foreground dark:text-slate-200">
                Meta checklist
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${errorCount ? 'bg-red-50 text-red-600 dark:bg-red-500/10' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10'}`}>
                  {errorCount ? `${errorCount} to fix` : 'All rules met'}
                  {warnCount ? ` · ${warnCount} tip${warnCount === 1 ? '' : 's'}` : ''}
                </span>
              </p>
              {issues.length ? <FieldIssues issues={issues.slice(0, 8)} /> : (
                <p className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3.5" /> Name, lengths, variables and buttons look good.</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
