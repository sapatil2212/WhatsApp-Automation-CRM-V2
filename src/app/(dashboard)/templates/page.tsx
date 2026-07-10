'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Plus, RefreshCw, Search, Loader2, Send, Trash2,
  Link2, Phone, MessageSquareReply, Info, ChevronRight,
  LayoutTemplate, Sparkles, CheckCircle2, Clock, Check,
  Sliders, FileText, Image as ImageIcon, Video, AlignLeft,
  Moon, Sun, HelpCircle, XCircle, ShieldCheck, AlertTriangle,
  BrainCircuit, RotateCcw, ArrowRight, Lightbulb,
} from 'lucide-react';
import type { ReviewResult } from '@/app/api/ai/template-review/route';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PhonePreview } from '@/components/templates/phone-preview';
import { TemplateCard } from '@/components/templates/template-card';
import { STARTER_TEMPLATES, type StarterTemplate } from '@/components/templates/starter-templates';
import type { MessageTemplate } from '@/types';

// ─── Constants ───────────────────────────────────────────────
const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
const HEADER_TYPES = ['none', 'text', 'image', 'video', 'document'] as const;
const COMMON_LANGUAGE_CODES = [
  { code: 'en_US', label: 'English (US)' },
  { code: 'en_GB', label: 'English (UK)' },
  { code: 'es_ES', label: 'Spanish (Spain)' },
  { code: 'fr_FR', label: 'French (France)' },
  { code: 'de_DE', label: 'German' },
  { code: 'it_IT', label: 'Italian' },
  { code: 'pt_BR', label: 'Portuguese (Brazil)' },
  { code: 'hi_IN', label: 'Hindi' },
];

type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phone_number?: string;
  example?: string;
}
interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_type: (typeof HEADER_TYPES)[number];
  header_text: string;
  header_example: string;
  header_text_example: string;
  body_text: string;
  body_example: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

const emptyForm: TemplateFormData = {
  name: '', category: 'Marketing', language: 'en_US',
  header_type: 'none', header_text: '', header_example: '',
  header_text_example: '', body_text: '', body_example: [],
  footer_text: '', buttons: [],
};

function maxPlaceholder(text: string): number {
  const nums = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

// ─── Step indicator ──────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Design Content', desc: 'Create copy & actions' },
  { id: 2, label: 'AI Review', desc: 'Smart policy check' },
  { id: 3, label: 'Preview', desc: 'Verify visual format' },
  { id: 4, label: 'Meta Submission', desc: 'Send to Meta APIs' },
];

function StepBar({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center">
      {STEPS.map((step, i) => (
        <div key={step.id} className="flex items-center">
          <div className="flex items-center gap-3">
            <div className={`relative flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
              currentStep > step.id
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                : currentStep === step.id
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 ring-4 ring-emerald-500/10'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}>
              {currentStep > step.id ? <Check className="size-4" /> : step.id}
            </div>
            <div className="hidden md:block text-left">
              <p className={`text-xs font-semibold ${currentStep >= step.id ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}`}>
                {step.label}
              </p>
              <p className="text-[10px] text-slate-400 font-normal leading-none mt-0.5">{step.desc}</p>
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-0.5 w-8 md:w-16 mx-3 rounded-full transition-colors duration-300 ${
              currentStep > step.id ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Starter card ────────────────────────────────────────────
function StarterCard({ starter, onSelect }: { starter: StarterTemplate; onSelect: (s: StarterTemplate) => void }) {
  const categoryColor: Record<string, string> = {
    Marketing: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    Utility: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    Authentication: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  };
  return (
    <motion.button
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={() => onSelect(starter)}
      className="flex min-w-[220px] max-w-[220px] flex-col items-start gap-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4 text-left transition-all hover:border-emerald-500/50 hover:shadow-xl hover:shadow-emerald-500/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
    >
      <div className="flex items-center gap-2">
        <span className="text-xl flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/80">{starter.emoji}</span>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold border ${categoryColor[starter.category]}`}>
          {starter.category}
        </span>
      </div>
      <div>
        <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate w-full">{starter.label}</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug line-clamp-2 h-7">{starter.description}</p>
      </div>
    </motion.button>
  );
}

// ─── Main Page ───────────────────────────────────────────────
export default function TemplatesPage() {
  const { user, loading: authLoading } = useAuth();

  // Data
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  // View state
  const [view, setView] = useState<'list' | 'builder'>('list');
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState('');
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light');

  // AI Review
  const [aiReview, setAiReview] = useState<ReviewResult | null>(null);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Form
  const [form, setForm] = useState<TemplateFormData>(emptyForm);

  const bodyVarCount = useMemo(() => maxPlaceholder(form.body_text), [form.body_text]);
  const headerHasVar = useMemo(
    () => form.header_type === 'text' && maxPlaceholder(form.header_text) === 1,
    [form.header_type, form.header_text],
  );

  useEffect(() => {
    if (authLoading) return;
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchTemplates() {
    try {
      setLoading(true);
      const res = await fetch('/api/whatsapp/templates');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load templates');
      setTemplates(data.templates || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncFromMeta() {
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
      toast.success(
        `Synced ${data.total} template${data.total === 1 ? '' : 's'} from Meta` +
          (data.inserted || data.updated ? ` (${data.inserted} new, ${data.updated} updated)` : ''),
      );
      await fetchTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync templates');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/whatsapp/templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to delete template');
      toast.success('Template deleted');
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete template');
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) return toast.error('Template name is required');
    if (!form.body_text.trim()) return toast.error('Body text is required');

    const payload = {
      name: form.name.trim().toLowerCase().replace(/\s+/g, '_'),
      category: form.category,
      language: form.language.trim() || 'en_US',
      header_type: form.header_type,
      header_text: form.header_text,
      header_example: form.header_example,
      header_text_example: headerHasVar ? [form.header_text_example] : [],
      body_text: form.body_text,
      body_example: form.body_example.slice(0, bodyVarCount),
      footer_text: form.footer_text,
      buttons: form.buttons,
    };

    try {
      setSaving(true);
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to submit template');
      toast.success(
        data.meta_status === 'APPROVED'
          ? '🎉 Template approved by Meta and ready to send!'
          : '📤 Template submitted to Meta for review. You\'ll be notified once approved.',
      );
      setView('list');
      setForm(emptyForm);
      setStep(1);
      await fetchTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit template');
    } finally {
      setSaving(false);
    }
  }

  async function runAiReview() {
    setAiChecking(true);
    setAiError(null);
    setAiReview(null);
    try {
      const res = await fetch('/api/ai/template-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          language: form.language,
          header_type: form.header_type,
          header_text: form.header_text,
          body_text: form.body_text,
          footer_text: form.footer_text,
          buttons: form.buttons,
          body_example: form.body_example,
          header_text_example: form.header_text_example,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'AI review failed');
      setAiReview(data);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI review failed');
    } finally {
      setAiChecking(false);
    }
  }

  function loadStarter(starter: StarterTemplate) {
    setForm({
      name: starter.name,
      category: starter.category,
      language: starter.language,
      header_type: starter.header_type,
      header_text: starter.header_text,
      header_example: '',
      header_text_example: '',
      body_text: starter.body_text,
      body_example: [],
      footer_text: starter.footer_text,
      buttons: starter.buttons,
    });
    setView('builder');
    setStep(1);
    toast.success(`Loaded "${starter.label}" starter template`);
  }

  function updateForm(patch: Partial<TemplateFormData>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function addButton(type: ButtonType) {
    if (form.buttons.length >= 10) { toast.error('Max 10 buttons allowed'); return; }
    setForm((prev) => ({ ...prev, buttons: [...prev.buttons, { type, text: '', url: '', phone_number: '', example: '' }] }));
  }
  function updateButton(index: number, patch: Partial<TemplateButton>) {
    setForm((prev) => ({ ...prev, buttons: prev.buttons.map((b, i) => i === index ? { ...b, ...patch } : b) }));
  }
  function removeButton(index: number) {
    setForm((prev) => ({ ...prev, buttons: prev.buttons.filter((_, i) => i !== index) }));
  }

  const filteredTemplates = useMemo(() =>
    templates.filter(t =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.body_text?.toLowerCase().includes(search.toLowerCase())
    ), [templates, search]);

  const approved = templates.filter(t => t.status === 'Approved').length;
  const pending = templates.filter(t => t.status === 'Pending').length;

  if (view === 'builder') {
    return (
      <div className="fixed top-14 bottom-0 right-0 left-0 lg:left-60 z-30 bg-background flex flex-col overflow-hidden">
        {/* Builder top bar */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/60 dark:border-slate-800/60 bg-white dark:bg-slate-950 px-6 py-3.5">
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setView('list'); setForm(emptyForm); setStep(1); }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800/60 rounded-lg px-2.5 py-1.5"
            >
              ← Back to Templates
            </button>
            <div className="h-5 w-px bg-slate-200 dark:bg-slate-800" />
            <StepBar currentStep={step} />
          </div>
          <div className="flex items-center gap-2">
            {step === 1 && (
              <Button
                onClick={async () => { setStep(2); await runAiReview(); }}
                disabled={!form.name.trim() || !form.body_text.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9"
              >
                AI Review <BrainCircuit className="size-4" />
              </Button>
            )}
            {step === 2 && (
              <Button
                onClick={() => setStep(3)}
                disabled={!aiReview || !aiReview.passed || aiChecking}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 disabled:opacity-50"
              >
                Continue <ChevronRight className="size-4" />
              </Button>
            )}
            {step === 3 && (
              <Button
                onClick={() => setStep(4)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9"
              >
                Continue <ChevronRight className="size-4" />
              </Button>
            )}
            {step === 4 && (
              <Button
                onClick={handleSubmit}
                disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9"
              >
                {saving ? <><Loader2 className="size-4 animate-spin" /> Submitting…</> : <><Send className="size-4" /> Submit to Meta</>}
              </Button>
            )}
          </div>
        </div>

        {/* Builder body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Form panel */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6 max-w-2xl"
                >
                  {/* Title Info */}
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Design template structure</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Configure layout, headers, messaging body copy, and quick actions.</p>
                  </div>

                  {/* Section 1: Basic Info */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/20 p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
                      <Sliders className="size-4 text-emerald-500" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Basic Information</h3>
                    </div>

                    <div className="space-y-3.5">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Template Name *</Label>
                        <Input
                          placeholder="e.g. appointment_reminder"
                          value={form.name}
                          onChange={(e) => updateForm({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                          className="h-9 text-xs border-slate-200 dark:border-slate-800 placeholder:text-slate-400"
                        />
                        <p className="text-[10px] text-slate-400 leading-normal">Lowercase letters, numbers, and underscores only.</p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Language</Label>
                          <Select value={form.language ?? undefined} onValueChange={(v) => updateForm({ language: v || 'en_US' })}>
                            <SelectTrigger className="h-9 text-xs border-slate-200 dark:border-slate-800"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {COMMON_LANGUAGE_CODES.map(l => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Category</Label>
                          <Select value={form.category ?? undefined} onValueChange={(v) => updateForm({ category: (v || 'Marketing') as MessageTemplate['category'] })}>
                            <SelectTrigger className="h-9 text-xs border-slate-200 dark:border-slate-800"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Header Configuration */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/20 p-5 space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800/60">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-emerald-500" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Header Settings <span className="text-[10px] font-normal text-slate-400 lowercase">(optional)</span></h3>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 font-semibold">Header Type</Label>
                      <div className="grid grid-cols-5 gap-2">
                        {HEADER_TYPES.map(type => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => updateForm({ header_type: type })}
                            className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 text-center transition-all ${
                              form.header_type === type
                                ? 'border-emerald-500 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 font-bold shadow-sm'
                                : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300'
                            }`}
                          >
                            {type === 'none' && <span className="text-xs font-semibold">None</span>}
                            {type === 'text' && <><AlignLeft className="size-3.5" /><span className="text-[10px]">Text</span></>}
                            {type === 'image' && <><ImageIcon className="size-3.5" /><span className="text-[10px]">Image</span></>}
                            {type === 'video' && <><Video className="size-3.5" /><span className="text-[10px]">Video</span></>}
                            {type === 'document' && <><FileText className="size-3.5" /><span className="text-[10px]">Doc</span></>}
                          </button>
                        ))}
                      </div>

                      {form.header_type === 'text' && (
                        <div className="space-y-2 pt-2">
                          <Input
                            placeholder="Header text (max 60 chars)"
                            value={form.header_text}
                            onChange={(e) => updateForm({ header_text: e.target.value })}
                            maxLength={60}
                            className="h-9 text-xs border-slate-200 dark:border-slate-800"
                          />
                          {headerHasVar && (
                            <Input
                              placeholder="Sample value for header {{1}} (e.g. swapnil)"
                              value={form.header_text_example}
                              onChange={(e) => updateForm({ header_text_example: e.target.value })}
                              className="h-9 text-xs border-slate-200 dark:border-slate-800"
                            />
                          )}
                        </div>
                      )}

                      {(form.header_type === 'image' || form.header_type === 'video' || form.header_type === 'document') && (
                        <div className="pt-2">
                          <Input
                            placeholder={`Sample ${form.header_type} URL (e.g. https://domain.com/asset.jpg)`}
                            value={form.header_example}
                            onChange={(e) => updateForm({ header_example: e.target.value })}
                            className="h-9 text-xs border-slate-200 dark:border-slate-800"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Section 3: Body & Variables */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/20 p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
                      <AlignLeft className="size-4 text-emerald-500" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Message Body *</h3>
                    </div>

                    <div className="space-y-3">
                      <Textarea
                        placeholder={`Hi {{1}}, your order {{2}} has been shipped!`}
                        value={form.body_text}
                        onChange={(e) => updateForm({ body_text: e.target.value })}
                        rows={5}
                        className="resize-none text-xs border-slate-200 dark:border-slate-800 focus-visible:ring-emerald-500/20"
                      />
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <Info className="size-3.5" />
                        <span>Use brackets to define dynamic text variables like <code>{`{{1}}`}</code>, <code>{`{{2}}`}</code>.</span>
                      </div>

                      {bodyVarCount > 0 && (
                        <div className="space-y-3.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4">
                          <div>
                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Variables mapping</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Define mock values for each placeholder. Required by Meta for security review.</p>
                          </div>
                          <div className="grid gap-2.5">
                            {Array.from({ length: bodyVarCount }).map((_, i) => (
                              <div key={i} className="flex items-center gap-3">
                                <span className="flex h-7 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-200/80 dark:bg-slate-800/80 text-[10px] font-bold font-mono text-slate-600 dark:text-slate-300">{`{{${i + 1}}}`}</span>
                                <Input
                                  placeholder={`e.g. John Doe`}
                                  value={form.body_example[i] ?? ''}
                                  onChange={(e) => {
                                    const next = [...form.body_example];
                                    next[i] = e.target.value;
                                    updateForm({ body_example: next });
                                  }}
                                  className="h-8 text-xs border-slate-200 dark:border-slate-800/80"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Section 4: Footer */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/20 p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
                      <HelpCircle className="size-4 text-emerald-500" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Footer Text <span className="text-[10px] font-normal text-slate-400 lowercase">(optional)</span></h3>
                    </div>
                    <Input
                      placeholder="e.g. Reply STOP to opt out"
                      value={form.footer_text}
                      onChange={(e) => updateForm({ footer_text: e.target.value })}
                      maxLength={60}
                      className="h-9 text-xs border-slate-200 dark:border-slate-800"
                    />
                  </div>

                  {/* Section 5: Buttons */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/20 p-5 space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800/60">
                      <div className="flex items-center gap-2">
                        <MessageSquareReply className="size-4 text-emerald-500" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Call To Action Buttons <span className="text-[10px] font-normal text-slate-400 lowercase">(optional)</span></h3>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex gap-2">
                        {([
                          ['QUICK_REPLY', 'Quick Reply', MessageSquareReply],
                          ['URL', 'Website link', Link2],
                          ['PHONE_NUMBER', 'Phone Call', Phone],
                        ] as const).map(([type, label, Icon]) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => addButton(type)}
                            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                          >
                            <Icon className="size-3.5" />
                            + {label}
                          </button>
                        ))}
                      </div>

                      {form.buttons.length > 0 && (
                        <div className="grid gap-3 pt-1">
                          {form.buttons.map((btn, i) => (
                            <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-4 space-y-2.5 relative">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                  {btn.type === 'URL' ? <Link2 className="size-3.5 text-emerald-500" /> : btn.type === 'PHONE_NUMBER' ? <Phone className="size-3.5 text-emerald-500" /> : <MessageSquareReply className="size-3.5 text-emerald-500" />}
                                  {btn.type === 'URL' ? 'Website Link' : btn.type === 'PHONE_NUMBER' ? 'Phone Call' : 'Quick Reply'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeButton(i)}
                                  className="text-slate-400 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>

                              <Input
                                placeholder="Button Label (e.g. Subscribe Now)"
                                value={btn.text}
                                maxLength={25}
                                onChange={(e) => updateButton(i, { text: e.target.value })}
                                className="h-8 text-xs border-slate-200 dark:border-slate-800"
                              />

                              {btn.type === 'URL' && (
                                <div className="grid gap-2">
                                  <Input
                                    placeholder="URL (e.g. https://domain.com/{{1}})"
                                    value={btn.url}
                                    onChange={(e) => updateButton(i, { url: e.target.value })}
                                    className="h-8 text-xs border-slate-200 dark:border-slate-800"
                                  />
                                  {/\{\{\s*1\s*\}\}/.test(btn.url ?? '') && (
                                    <Input
                                      placeholder="Sample variable URL suffix (e.g. profile)"
                                      value={btn.example}
                                      onChange={(e) => updateButton(i, { example: e.target.value })}
                                      className="h-8 text-xs border-slate-200 dark:border-slate-800"
                                    />
                                  )}
                                </div>
                              )}

                              {btn.type === 'PHONE_NUMBER' && (
                                <Input
                                  placeholder="Phone number with country code (e.g. +14155552671)"
                                  value={btn.phone_number}
                                  onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                                  className="h-8 text-xs border-slate-200 dark:border-slate-800"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div
                  key="step2-ai"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-5 max-w-2xl"
                >
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                      <BrainCircuit className="size-5 text-emerald-500" />
                      AI Policy Review
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Gemini reviews your template against Meta's 12 policy checks before submission to avoid rejections.</p>
                  </div>

                  {/* Loading state */}
                  {aiChecking && (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 py-16 gap-4">
                      <div className="relative">
                        <div className="h-14 w-14 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                        <BrainCircuit className="absolute inset-0 m-auto size-6 text-emerald-500 animate-pulse" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Analyzing your template…</p>
                        <p className="text-xs text-slate-400 mt-1">Checking against 12 Meta policy rules</p>
                      </div>
                    </div>
                  )}

                  {/* Error state */}
                  {aiError && !aiChecking && (
                    <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5 p-5 space-y-3">
                      <div className="flex items-center gap-2">
                        <XCircle className="size-4 text-red-500" />
                        <p className="text-sm font-bold text-red-700 dark:text-red-400">Review Failed</p>
                      </div>
                      <p className="text-xs text-red-600/80 dark:text-red-400/70">{aiError}</p>
                      <Button size="sm" variant="outline" onClick={runAiReview} className="gap-2 text-xs border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50">
                        <RotateCcw className="size-3.5" /> Retry Review
                      </Button>
                    </div>
                  )}

                  {/* Results */}
                  {aiReview && !aiChecking && (
                    <div className="space-y-4">
                      {/* Score banner */}
                      <div className={`rounded-xl border p-5 flex items-center gap-5 ${
                        aiReview.passed
                          ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/5'
                          : 'border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5'
                      }`}>
                        <div className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 ${
                          aiReview.passed ? 'border-emerald-500 bg-emerald-500/10' : 'border-red-500 bg-red-500/10'
                        }`}>
                          <span className={`text-xl font-black ${
                            aiReview.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          }`}>{aiReview.score}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {aiReview.passed
                              ? <ShieldCheck className="size-4 text-emerald-500" />
                              : <XCircle className="size-4 text-red-500" />}
                            <p className={`text-sm font-bold ${
                              aiReview.passed ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                            }`}>{aiReview.passed ? 'Ready for Submission' : 'Issues Found — Fix Before Submitting'}</p>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{aiReview.summary}</p>
                          {/* Score bar */}
                          <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-700 ${
                                aiReview.score >= 80 ? 'bg-emerald-500' : aiReview.score >= 50 ? 'bg-amber-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${aiReview.score}%` }}
                            />
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={runAiReview} className="shrink-0 text-xs text-slate-400 hover:text-slate-600 gap-1.5">
                          <RotateCcw className="size-3" /> Re-run
                        </Button>
                      </div>

                      {/* Checks list */}
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                        <div className="px-4 py-3 flex items-center gap-2">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Policy Checks</p>
                          <span className="ml-auto flex items-center gap-3 text-[10px]">
                            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                              <Check className="size-3" />{aiReview.checks.filter(c => c.passed).length} passed
                            </span>
                            <span className="flex items-center gap-1 text-red-500 font-semibold">
                              <XCircle className="size-3" />{aiReview.checks.filter(c => !c.passed && c.severity === 'error').length} errors
                            </span>
                            <span className="flex items-center gap-1 text-amber-500 font-semibold">
                              <AlertTriangle className="size-3" />{aiReview.checks.filter(c => !c.passed && c.severity === 'warning').length} warnings
                            </span>
                          </span>
                        </div>
                        {aiReview.checks.map((check) => (
                          <div key={check.id} className={`flex items-start gap-3.5 px-4 py-3.5 ${
                            !check.passed && check.severity === 'error' ? 'bg-red-50/50 dark:bg-red-500/[0.03]' : ''
                          }`}>
                            <div className="mt-0.5 shrink-0">
                              {check.passed
                                ? <CheckCircle2 className="size-4 text-emerald-500" />
                                : check.severity === 'error'
                                  ? <XCircle className="size-4 text-red-500" />
                                  : <AlertTriangle className="size-4 text-amber-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold ${
                                check.passed ? 'text-slate-700 dark:text-slate-200' : check.severity === 'error' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'
                              }`}>{check.label}</p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{check.message}</p>
                              {!check.passed && check.suggestion && (
                                <p className="text-[11px] mt-1.5 flex items-start gap-1.5 text-slate-600 dark:text-slate-300 font-medium">
                                  <ArrowRight className="size-3 mt-0.5 shrink-0 text-emerald-500" />
                                  {check.suggestion}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Improvement tips */}
                      {aiReview.improvements.length > 0 && (
                        <div className="rounded-xl border border-sky-200 dark:border-sky-500/20 bg-sky-50 dark:bg-sky-500/5 p-4 space-y-2.5">
                          <div className="flex items-center gap-2">
                            <Lightbulb className="size-4 text-sky-500" />
                            <p className="text-xs font-bold text-sky-700 dark:text-sky-400">Improvement Tips</p>
                          </div>
                          <ul className="space-y-1.5">
                            {aiReview.improvements.map((tip, i) => (
                              <li key={i} className="flex items-start gap-2 text-[11px] text-sky-700/90 dark:text-sky-400/80">
                                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-200 dark:bg-sky-500/20 text-[9px] font-bold text-sky-600 dark:text-sky-400">{i + 1}</span>
                                {tip}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* CTA if errors exist */}
                      {!aiReview.passed && (
                        <div className="flex items-center gap-3 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5 p-4">
                          <XCircle className="size-4 shrink-0 text-red-500" />
                          <p className="text-xs text-red-700 dark:text-red-400 font-medium flex-1">Fix the errors above, then go back to Step 1 to update your template.</p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setStep(1)}
                            className="shrink-0 text-xs gap-1.5 border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400"
                          >
                            ← Go Back
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              {step === 3 && (
                <motion.div
                  key="step3-review"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6 max-w-2xl"
                >
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Verify review draft</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Review the data summary and configuration mapping rules.</p>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
                    {[
                      { label: 'Template Name', value: form.name || '—' },
                      { label: 'Category Selection', value: form.category },
                      { label: 'Selected Language', value: form.language },
                      { label: 'Header Type', value: form.header_type === 'none' ? 'None' : form.header_type === 'text' ? form.header_text || 'Text (empty)' : `${form.header_type.toUpperCase()} file` },
                      { label: 'Action Buttons', value: form.buttons.length > 0 ? form.buttons.map(b => b.text || b.type).join(', ') : 'None' },
                    ].map((row, idx) => (
                      <div key={row.label} className={`flex items-start justify-between px-5 py-3 text-xs ${idx % 2 === 0 ? 'bg-slate-50/50 dark:bg-slate-800/10' : ''}`}>
                        <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0 w-36">{row.label}</span>
                        <span className="text-slate-800 dark:text-slate-200 font-semibold text-right">{row.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5 space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Message Body Copy</p>
                    <p className="whitespace-pre-wrap text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-medium bg-slate-50/50 dark:bg-slate-900/60 p-4 rounded-lg">{form.body_text}</p>
                    {form.footer_text && <p className="text-[11px] text-slate-400 italic">Footer: &ldquo;{form.footer_text}&rdquo;</p>}
                  </div>

                  {aiReview && (
                    <div className="flex items-start gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 p-4">
                      <ShieldCheck className="size-4 shrink-0 text-emerald-500 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-emerald-800 dark:text-emerald-400">AI Review Passed — Score {aiReview.score}/100</p>
                        <p className="text-[11px] text-emerald-700/90 dark:text-emerald-400/80 leading-relaxed">{aiReview.summary}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 p-4">
                    <Info className="size-4 shrink-0 text-amber-500 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-amber-800 dark:text-amber-400">Meta Policy Compliance</p>
                      <p className="text-[11px] text-amber-700/90 dark:text-amber-400/80 leading-relaxed">Meta evaluates incoming submissions against dynamic policies. Avoid pure promotional bait in Utility types. Approved status syncing from dashboard list pulls latest states from live accounts.</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 4 && (
                <motion.div
                  key="step4-meta"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6 max-w-2xl"
                >
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Submit to Meta API</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Review the submission flow timeline. Once confirmed, APIs transmit data immediately.</p>
                  </div>

                  {/* AI Review badge */}
                  {aiReview && (
                    <div className="flex items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 p-4">
                      <ShieldCheck className="size-5 shrink-0 text-emerald-500" />
                      <div>
                        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">AI Review Passed &middot; Score {aiReview.score}/100</p>
                        <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/60">This template passed all Meta policy checks and is ready to submit.</p>
                      </div>
                    </div>
                  )}

                  {/* Submission Flow */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5 space-y-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Lifecycle Timeline</p>
                    <div className="grid gap-3">
                      {[
                        { step: '1', title: 'Local Draft', desc: 'Template stored locally in database', state: 'done' },
                        { step: '2', title: 'AI Policy Check', desc: 'Gemini verified template structure & content', state: 'done' },
                        { step: '3', title: 'Transmit Payload', desc: 'Secure POST to Meta Graph APIs', state: 'active' },
                        { step: '4', title: 'Meta Review Queue', desc: 'Typical delay: 2 minutes to 2 hours', state: 'waiting' },
                        { step: '5', title: 'Status Dispatcher', desc: 'Hook updates local state automatically', state: 'waiting' },
                      ].map((t, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            t.state === 'done'
                              ? 'bg-emerald-500 text-white'
                              : t.state === 'active'
                                ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/40 animate-pulse'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                          }`}>
                            {t.state === 'done' ? <Check className="size-3" /> : t.step}
                          </div>
                          <div>
                            <p className={`text-xs font-bold ${t.state !== 'waiting' ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}`}>{t.title}</p>
                            <p className="text-[10px] text-slate-400 leading-normal mt-0.5">{t.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-xl bg-sky-50 dark:bg-sky-500/5 border border-sky-200 dark:border-sky-500/20 p-4">
                    <Info className="size-4 shrink-0 text-sky-500 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-sky-800 dark:text-sky-400">Review Synchronization</p>
                      <p className="text-[11px] text-sky-700/95 dark:text-sky-400/85 leading-relaxed">After submitting, check your dashboard grid. Click <strong>Sync from Meta</strong> to query Meta&apos;s servers and resolve pending templates instantly.</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Panel: Phone Preview */}
          <div className="hidden lg:flex w-[340px] shrink-0 flex-col items-center border-l border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/20 p-6 pt-8 overflow-y-auto">
            <PhonePreview
              headerType={form.header_type}
              headerText={form.header_type === 'text' ? form.header_text : undefined}
              bodyText={form.body_text}
              footerText={form.footer_text}
              buttons={form.buttons}
              theme="light"
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Render: List view ──
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <LayoutTemplate className="size-6 text-emerald-500" />
            Message Templates
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Create WhatsApp templates, submit them to Meta for approval, and use them in broadcasts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSyncFromMeta}
            disabled={syncing}
            className="h-9 gap-2 border-slate-200 dark:border-slate-700 text-xs font-semibold"
          >
            <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from Meta'}
          </Button>
          <Button
            onClick={() => { setForm(emptyForm); setView('builder'); setStep(1); }}
            className="h-9 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-md shadow-emerald-600/10"
          >
            <Plus className="size-4" />
            New Template
          </Button>
        </div>
      </div>

      {/* Stats row */}
      {!loading && templates.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Total Templates', value: templates.length, icon: LayoutTemplate, color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800' },
            { label: 'Approved', value: approved, icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
            { label: 'Pending Review', value: pending, icon: Clock, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-500/10' },
          ].map(stat => (
            <div key={stat.label} className={`flex items-center gap-3.5 rounded-xl border border-slate-200/60 dark:border-slate-850 bg-white dark:bg-slate-900/40 px-4 py-2.5`}>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${stat.bg}`}>
                <stat.icon className={`size-4.5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{stat.value}</p>
                <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-0.5">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Starter templates */}
      <div className="space-y-3.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4.5 text-emerald-500 animate-pulse" />
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">Starter Templates</h2>
          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0 text-[10px] font-bold">
            {STARTER_TEMPLATES.length} templates
          </Badge>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800 -mx-1 px-1">
          {STARTER_TEMPLATES.map(starter => (
            <StarterCard key={starter.id} starter={starter} onSelect={loadStarter} />
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-slate-200/60 dark:border-slate-800/60" />

      {/* Your templates */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">Your Templates Library</h2>
          {templates.length > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
              <Input
                placeholder="Search templates…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 pr-3 text-xs w-48 border-slate-200 dark:border-slate-800"
              />
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-emerald-500" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 py-16 px-4 text-center">
            {search ? (
              <>
                <Search className="size-8 text-slate-350 dark:text-slate-655 mb-3" />
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">No templates match &ldquo;{search}&rdquo;</p>
              </>
            ) : (
              <>
                <LayoutTemplate className="size-10 text-slate-200 dark:text-slate-800 mb-3.5" />
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">No templates created yet</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 max-w-xs leading-normal">
                  Start by choosing a Starter Template card above or click New Template to define your own.
                </p>
                <Button
                  className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white h-9 text-xs font-semibold"
                  onClick={() => { setForm(emptyForm); setView('builder'); setStep(1); }}
                >
                  <Plus className="size-4" /> Create Custom Template
                </Button>
              </>
            )}
          </div>
        ) : (
          <motion.div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            layout
          >
            <AnimatePresence>
              {filteredTemplates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onDelete={handleDelete}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}
