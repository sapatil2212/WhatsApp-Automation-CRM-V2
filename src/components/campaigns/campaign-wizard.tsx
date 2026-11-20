'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BrainCircuit, CalendarClock, Check, CheckCircle2, ChevronRight,
  FileText, Info, LayoutTemplate, Lightbulb, Loader2, Megaphone, RefreshCw, Rocket, Save, Search, Send,
  ShieldCheck, Sparkles, Tag, Upload, Users, Wand2, XCircle, Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PhonePreview } from '@/components/templates/phone-preview';
import {
  api,
  type Audience,
  type AudiencePreview,
  type BroadcastDto,
  type CampaignSetup,
  type TemplateDto,
} from '@/lib/campaigns/api';
import {
  renderBody,
  resolveMapping,
  SOURCE_LABELS,
  templateSlots,
  validatePersonalization,
  type ContactData,
  type MappingSource,
  type Personalization,
  type SlotInfo,
  type SlotMapping,
} from '@/lib/campaigns/personalization';
import type { CampaignPlan, CampaignReview } from '@/lib/ai/campaign-assist';

// ─── types & constants ─────────────────────────────────────────────

type AudienceMode = 'all' | 'tags' | 'csv';
type StepKey = 'goal' | 'template' | 'audience' | 'personalize' | 'launch';

const STEPS: Array<{ key: StepKey; label: string; desc: string; icon: React.ElementType }> = [
  { key: 'goal', label: 'Goal', desc: 'AI plans it for you', icon: Sparkles },
  { key: 'template', label: 'Template', desc: 'Approved message', icon: LayoutTemplate },
  { key: 'audience', label: 'Audience', desc: 'Who receives it', icon: Users },
  { key: 'personalize', label: 'Personalize', desc: 'Fill the variables', icon: Wand2 },
  { key: 'launch', label: 'Review & launch', desc: 'Checks, test, send', icon: Rocket },
];

const GOAL_EXAMPLES = [
  'Announce our weekend sale — 20% off everything until Sunday — to all customers except unsubscribed',
  'Remind VIP customers that their loyalty points expire at the end of this month',
  'Invite leads tagged "webinar" to our product demo this Thursday at 6 PM',
  'Tell customers our store will be closed on Sunday for maintenance',
];

const DRAFT_KEY = 'campaign-wizard-draft-v1';

interface WizardState {
  goal: string;
  name: string;
  templateId: string | null;
  audienceMode: AudienceMode;
  tagIds: string[];
  excludeTagIds: string[];
  csv: { fileName: string; contactIds: string[]; summary: string } | null;
  personalization: Personalization;
  scheduleMode: 'now' | 'later';
  scheduledLocal: string; // yyyy-MM-ddTHH:mm in the browser's timezone
}

const INITIAL: WizardState = {
  goal: '',
  name: '',
  templateId: null,
  audienceMode: 'all',
  tagIds: [],
  excludeTagIds: [],
  csv: null,
  personalization: {},
  scheduleMode: 'now',
  scheduledLocal: '',
};

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultLater(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setHours(10, 30, 0, 0);
  return toLocalInput(d);
}

/** Minimal CSV parser: header detection, quotes, comma/semicolon/tab. */
function parseCsv(text: string): Array<{ phone: string; name?: string }> {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = [',', ';', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === delim && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const first = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = first.some((h) => /phone|mobile|number|whatsapp|name/.test(h));
  const phoneIdx = hasHeader ? Math.max(0, first.findIndex((h) => /phone|mobile|number|whatsapp/.test(h))) : 0;
  const nameIdx = hasHeader ? first.findIndex((h) => /name/.test(h)) : 1;
  return (hasHeader ? lines.slice(1) : lines)
    .map(split)
    .map((cols) => ({ phone: cols[phoneIdx] ?? '', name: nameIdx >= 0 ? cols[nameIdx] || undefined : undefined }))
    .filter((r) => r.phone);
}

// ─── small UI helpers ──────────────────────────────────────────────

function Panel({ title, icon: Icon, desc, right, children }: {
  title: string; icon?: React.ElementType; desc?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {Icon && <Icon className="size-4 text-primary" />} {title}
          </h3>
          {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function AiHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs text-foreground/90">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

type CheckItem = { id: string; ok: boolean; level: 'error' | 'warning' | 'info'; label: string; step?: StepKey };

// ─── wizard ────────────────────────────────────────────────────────

export function CampaignWizard() {
  const router = useRouter();
  const [setup, setSetup] = useState<CampaignSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>(INITIAL);
  const [step, setStep] = useState<StepKey>('goal');
  const [restored, setRestored] = useState(false);

  // AI
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [review, setReview] = useState<CampaignReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewedKey, setReviewedKey] = useState<string | null>(null);

  // Audience preview
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [countryCode, setCountryCode] = useState('91');
  const csvRef = useRef<HTMLInputElement>(null);

  // Launch
  const [templateQuery, setTemplateQuery] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [testedKey, setTestedKey] = useState<string | null>(null);
  const [launching, setLaunching] = useState<null | 'launch' | 'draft'>(null);
  const [sampleIndex, setSampleIndex] = useState(0);

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  // ── load workspace data + restore draft ──
  const loadSetup = useCallback(async () => {
    setSetupError(null);
    try {
      const res = await api<CampaignSetup>('/api/broadcasts/setup');
      setSetup(res.data);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Could not load campaign data');
    }
  }, []);

  useEffect(() => {
    loadSetup();
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { state: WizardState; step: StepKey };
        if (saved?.state && (saved.state.goal || saved.state.templateId)) {
          setState({ ...INITIAL, ...saved.state });
          setStep(saved.step ?? 'goal');
          toast.info('Restored your unfinished campaign.', {
            action: { label: 'Start over', onClick: () => { setState(INITIAL); setStep('goal'); localStorage.removeItem(DRAFT_KEY); } },
          });
        }
      }
    } catch { /* storage unavailable */ }
    setRestored(true);
  }, [loadSetup]);

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ state, step })); } catch { /* ignore */ }
  }, [state, step, restored]);

  const template = useMemo(
    () => setup?.templates.find((t) => t.id === state.templateId) ?? null,
    [setup, state.templateId],
  );
  const slots: SlotInfo[] = useMemo(() => (template ? templateSlots(template) : []), [template]);
  const mappingIssues = useMemo(() => validatePersonalization(slots, state.personalization), [slots, state.personalization]);

  // Keep personalization keys in sync with the chosen template.
  useEffect(() => {
    if (!template) return;
    setState((s) => {
      const next: Personalization = {};
      let changed = false;
      for (const slot of slots) {
        if (s.personalization[slot.key]) next[slot.key] = s.personalization[slot.key];
        else {
          changed = true;
          next[slot.key] =
            slot.kind === 'body' && /^(hi|hello|dear|hey|namaste)\b/i.test(slot.context.replace(/^…/, '').trim())
              ? { source: 'first_name', fallback: 'there' }
              : { source: 'static', value: '' };
        }
      }
      if (Object.keys(s.personalization).length !== slots.length) changed = true;
      return changed ? { ...s, personalization: next } : s;
    });
  }, [template, slots]);

  const audience: Audience | null = useMemo(() => {
    if (state.audienceMode === 'tags') {
      return state.tagIds.length ? { type: 'tags', tagIds: state.tagIds, excludeTagIds: state.excludeTagIds } : null;
    }
    if (state.audienceMode === 'csv') {
      return state.csv?.contactIds.length ? { type: 'contacts', contactIds: state.csv.contactIds, excludeTagIds: state.excludeTagIds } : null;
    }
    return { type: 'all', excludeTagIds: state.excludeTagIds };
  }, [state.audienceMode, state.tagIds, state.excludeTagIds, state.csv]);

  // Debounced live reach.
  useEffect(() => {
    if (!audience) { setPreview(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await api<AudiencePreview>('/api/broadcasts/preview-audience', { method: 'POST', json: { audience } });
        if (!cancelled) setPreview(res.data);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [audience]);

  const sampleContact: ContactData = useMemo(() => {
    const s = preview?.sample?.[sampleIndex % Math.max(1, preview?.sample?.length ?? 1)];
    return s ? { name: s.name, phone: s.phone } : { name: 'Priya Sharma', phone: '919876543210' };
  }, [preview, sampleIndex]);

  const renderedBody = template ? renderBody(template, state.personalization, sampleContact) : '';
  const renderedHeader = template?.headerType === 'text' && template.headerContent
    ? template.headerContent.replace(/\{\{\s*1\s*\}\}/, resolveMapping(state.personalization.header_1, sampleContact) || '{{1}}')
    : undefined;

  // ── AI plan ──
  async function runPlan(opts?: { lockTemplate?: boolean }) {
    if (state.goal.trim().length < 5) {
      toast.error('Describe what this campaign should achieve first.');
      setStep('goal');
      return;
    }
    setPlanning(true);
    setPlanError(null);
    try {
      const res = await api<{ plan: CampaignPlan }>('/api/broadcasts/assist', {
        method: 'POST',
        json: { mode: 'plan', goal: state.goal.trim(), timezone: tz(), templateId: opts?.lockTemplate ? state.templateId ?? undefined : undefined },
      });
      applyPlan(res.data.plan, opts?.lockTemplate ?? false);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'AI planning failed');
    } finally {
      setPlanning(false);
    }
  }

  function applyPlan(p: CampaignPlan, onlyPersonalization: boolean) {
    setPlan(p);
    if (onlyPersonalization) {
      update({ personalization: { ...state.personalization, ...p.personalization } });
      toast.success('AI filled in the variables.');
      return;
    }
    update({
      name: p.name,
      templateId: p.templateId,
      audienceMode: p.audience.type === 'tags' ? 'tags' : 'all',
      tagIds: p.audience.tagIds,
      excludeTagIds: p.audience.excludeTagIds,
      csv: null,
      personalization: p.personalization,
      scheduleMode: p.schedule.mode,
      scheduledLocal: p.schedule.at ? toLocalInput(new Date(p.schedule.at)) : '',
    });
    if (!p.templateId) {
      toast.warning('No approved template fits this goal yet — create one first.');
      setStep('template');
    } else {
      toast.success('Campaign planned. Review each step, then launch.');
      setStep('template');
    }
  }

  // ── CSV ──
  async function importCsv(file: File) {
    setCsvImporting(true);
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error('No phone numbers found. Include a "phone" column.');
      if (rows.length > 10_000) throw new Error('Upload at most 10,000 rows per campaign.');
      const res = await api<{ contactIds: string[]; created: number; matched: number; duplicates: number; invalidCount: number }>(
        '/api/broadcasts/import-audience',
        { method: 'POST', json: { rows, defaultCountryCode: countryCode || undefined } },
      );
      const d = res.data;
      const summary = `${d.contactIds.length} contacts (${d.created} new, ${d.matched} existing)${d.duplicates ? `, ${d.duplicates} duplicates removed` : ''}${d.invalidCount ? `, ${d.invalidCount} invalid numbers skipped` : ''}`;
      update({ csv: { fileName: file.name, contactIds: d.contactIds, summary } });
      toast.success(`Imported ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setCsvImporting(false);
      if (csvRef.current) csvRef.current.value = '';
    }
  }

  // ── schedule & checks ──
  const scheduledAt = useMemo(
    () => (state.scheduleMode === 'later' && state.scheduledLocal ? new Date(state.scheduledLocal) : null),
    [state.scheduleMode, state.scheduledLocal],
  );
  const scheduleHour = (scheduledAt ?? new Date()).getHours();
  const draftKey = JSON.stringify([state.templateId, state.personalization, audience, state.name, state.scheduledLocal, state.scheduleMode]);

  const checks: CheckItem[] = useMemo(() => {
    const list: CheckItem[] = [];
    list.push({ id: 'wa', ok: Boolean(setup?.whatsappConnected), level: 'error', label: setup?.whatsappConnected ? 'WhatsApp Business is connected' : 'Connect WhatsApp in Settings before launching' });
    list.push({ id: 'tpl', ok: Boolean(template), level: 'error', label: template ? `Approved template “${template.name}” selected` : 'Choose an approved template', step: 'template' });
    list.push({
      id: 'aud', ok: Boolean(preview && preview.reach > 0 && preview.reach <= 50_000), level: 'error', step: 'audience',
      label: !audience ? 'Choose who should receive this campaign' : preview ? (preview.reach > 0 ? `${preview.reach.toLocaleString()} recipients` : 'This audience matches no contacts') : 'Calculating audience…',
    });
    list.push({ id: 'vars', ok: mappingIssues.length === 0, level: 'error', step: 'personalize', label: mappingIssues.length ? mappingIssues[0].message : 'All variables have values and fallbacks' });
    const placeholders = Object.values(state.personalization).some((m) => /\[(add|insert|enter)[^\]]*\]/i.test(`${m.value ?? ''} ${m.fallback ?? ''}`));
    if (placeholders) list.push({ id: 'ph', ok: false, level: 'error', step: 'personalize', label: 'Replace the AI placeholders like “[add date]” with real values' });
    list.push({ id: 'name', ok: state.name.trim().length > 0, level: 'error', step: 'launch', label: state.name.trim() ? 'Campaign named' : 'Give the campaign a name' });
    if (state.scheduleMode === 'later') {
      const valid = scheduledAt && scheduledAt.getTime() > Date.now() + 60_000;
      list.push({ id: 'when', ok: Boolean(valid), level: 'error', step: 'launch', label: valid ? `Scheduled for ${scheduledAt!.toLocaleString()}` : 'Pick a send time in the future' });
    }
    if (template?.category === 'Marketing' && (scheduleHour >= 21 || scheduleHour < 9)) {
      list.push({ id: 'quiet', ok: false, level: 'warning', step: 'launch', label: 'Sending marketing messages between 9 PM and 9 AM hurts read rates and can trigger blocks' });
    }
    if (template?.category === 'Marketing' && state.audienceMode === 'all' && state.excludeTagIds.length === 0 && (setup?.tags.length ?? 0) > 0) {
      list.push({ id: 'optout', ok: false, level: 'warning', step: 'audience', label: 'Consider excluding unsubscribed / do-not-contact tags from a marketing blast' });
    }
    if ((preview?.reach ?? 0) > 1000) {
      list.push({ id: 'tier', ok: true, level: 'info', label: 'Large send — make sure your WhatsApp messaging tier allows this many unique recipients per day' });
    }
    list.push({ id: 'test', ok: testedKey === draftKey, level: 'warning', step: 'launch', label: testedKey === draftKey ? 'Test message sent' : 'Send yourself a test message (recommended)' });
    return list;
  }, [setup, template, preview, audience, mappingIssues, state, scheduledAt, scheduleHour, testedKey, draftKey]);

  const blockers = checks.filter((c) => !c.ok && c.level === 'error');

  // ── AI review (auto on entering the launch step) ──
  const runReview = useCallback(async () => {
    if (!template || !preview || !setup?.aiAvailable) return;
    setReviewing(true);
    try {
      const res = await api<{ review: CampaignReview }>('/api/broadcasts/assist', {
        method: 'POST',
        json: {
          mode: 'review',
          timezone: tz(),
          draft: {
            name: state.name || 'Untitled campaign',
            goal: state.goal || undefined,
            templateId: template.id,
            audienceSummary: state.audienceMode === 'tags'
              ? `Tags: ${setup.tags.filter((t) => state.tagIds.includes(t.id)).map((t) => t.name).join(', ')}`
              : state.audienceMode === 'csv' ? `Uploaded list ${state.csv?.fileName ?? ''}` : 'All contacts',
            reach: preview.reach,
            personalization: state.personalization,
            sampleMessage: renderedBody.slice(0, 2000),
            scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
          },
        },
      });
      setReview(res.data.review);
      setReviewedKey(draftKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI review failed');
    } finally {
      setReviewing(false);
    }
  }, [template, preview, setup, state, renderedBody, scheduledAt, draftKey]);

  useEffect(() => {
    if (step === 'launch' && blockers.length === 0 && reviewedKey !== draftKey && !reviewing) runReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, blockers.length, draftKey]);

  async function sendTest() {
    if (!template) return;
    setTesting(true);
    try {
      await api('/api/broadcasts/test-send', {
        method: 'POST',
        json: { templateName: template.name, templateLanguage: template.language, personalization: state.personalization, phone: testPhone },
      });
      setTestedKey(draftKey);
      toast.success('Test message sent — check WhatsApp.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test send failed');
    } finally {
      setTesting(false);
    }
  }

  async function launch(kind: 'launch' | 'draft') {
    if (!template || !audience) return;
    if (kind === 'launch' && blockers.length) {
      toast.error(blockers[0].label);
      if (blockers[0].step) setStep(blockers[0].step);
      return;
    }
    if (kind === 'draft' && !state.name.trim()) {
      toast.error('Name the campaign before saving.');
      return;
    }
    setLaunching(kind);
    try {
      const created = await api<BroadcastDto>('/api/broadcasts', {
        method: 'POST',
        json: {
          name: state.name.trim(),
          templateName: template.name,
          templateLanguage: template.language,
          personalization: state.personalization,
          audience,
          ...(kind === 'launch' && state.scheduleMode === 'later' && scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
        },
      });
      const id = created.data.id;
      if (kind === 'launch' && state.scheduleMode === 'now') {
        await api(`/api/broadcasts/${id}/start`, { method: 'POST' });
        toast.success('Campaign launched — sending now.');
      } else if (kind === 'launch') {
        toast.success(`Campaign scheduled for ${scheduledAt?.toLocaleString()}.`);
      } else {
        toast.success('Draft saved.');
      }
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      router.push(`/campaigns/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the campaign');
    } finally {
      setLaunching(null);
    }
  }

  // ── navigation ──
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const stepDone: Record<StepKey, boolean> = {
    goal: Boolean(plan) || state.goal.trim().length > 0 || Boolean(template),
    template: Boolean(template),
    audience: Boolean(preview && preview.reach > 0),
    personalize: Boolean(template) && mappingIssues.length === 0,
    launch: false,
  };
  const canNext: Record<StepKey, boolean> = {
    goal: true,
    template: Boolean(template),
    audience: Boolean(audience && preview && preview.reach > 0),
    personalize: mappingIssues.length === 0,
    launch: true,
  };
  const go = (dir: 1 | -1) => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, stepIndex + dir))].key);

  const filteredTemplates = (setup?.templates ?? []).filter((t) => {
    const q = templateQuery.trim().toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || t.bodyText.toLowerCase().includes(q);
  });

  // ── render ──
  if (setupError) {
    return (
      <div className="mx-auto max-w-lg space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <XCircle className="mx-auto size-8 text-destructive" />
        <p className="text-sm font-semibold">Couldn&apos;t load your workspace</p>
        <p className="text-xs text-muted-foreground">{setupError}</p>
        <Button size="sm" variant="outline" onClick={loadSetup}><RefreshCw className="size-3.5" /> Retry</Button>
      </div>
    );
  }
  if (!setup) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/campaigns" className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Campaigns
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Megaphone className="size-5 text-primary" /> New campaign
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Describe your goal and AI sets up every step — you review and launch.</p>
        </div>
        {!setup.whatsappConnected && (
          <Link href="/settings" className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5" /> WhatsApp not connected — connect in Settings
          </Link>
        )}
      </div>

      {/* Stepper */}
      <nav aria-label="Campaign steps" className="grid grid-cols-5 gap-1.5 rounded-2xl border border-border/70 bg-card p-1.5">
        {STEPS.map((s, i) => {
          const active = s.key === step;
          const done = stepDone[s.key] && !active;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => setStep(s.key)}
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors sm:px-3 ${active ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent/60'}`}
            >
              <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${done ? 'bg-primary text-primary-foreground' : active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                {done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
              </span>
              <span className="hidden min-w-0 md:block">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Step {i + 1}</span>
                <span className={`block truncate text-xs font-semibold ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* ───────────── GOAL ───────────── */}
          {step === 'goal' && (
            <>
              <Panel title="What should this campaign achieve?" icon={BrainCircuit} desc="Write it like you'd brief a colleague: the offer, the people, and any dates or details.">
                <Textarea
                  value={state.goal}
                  onChange={(e) => update({ goal: e.target.value.slice(0, 1500) })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runPlan(); }}
                  rows={4}
                  placeholder="e.g. Announce our Diwali sale — 20% off everything until 5 Nov — to loyal customers, and skip anyone unsubscribed."
                  className="resize-none text-sm"
                  aria-label="Campaign goal"
                />
                <div className="flex flex-wrap gap-1.5">
                  {GOAL_EXAMPLES.map((g) => (
                    <button key={g} onClick={() => update({ goal: g })} className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
                      {g.length > 60 ? `${g.slice(0, 58)}…` : g}
                    </button>
                  ))}
                </div>
                {planError && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    <XCircle className="size-3.5" /> <span className="flex-1">{planError}</span>
                    <button className="font-semibold hover:underline" onClick={() => runPlan()}>Retry</button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => runPlan()} disabled={planning || !setup.aiAvailable || state.goal.trim().length < 5} className="gap-1.5">
                    {planning ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {planning ? 'Planning your campaign…' : 'Plan with AI'}
                  </Button>
                  <Button variant="ghost" onClick={() => setStep('template')} className="gap-1.5 text-muted-foreground">
                    Set up manually <ArrowRight className="size-3.5" />
                  </Button>
                  {!setup.aiAvailable && <span className="text-[11px] text-muted-foreground">AI is unavailable (GEMINI_API_KEY missing).</span>}
                </div>
              </Panel>

              {plan && (
                <Panel title="AI campaign plan" icon={Sparkles} desc={plan.summary}>
                  <ul className="grid gap-2 text-xs sm:grid-cols-2">
                    <li className="rounded-xl border border-border/70 p-3"><p className="font-semibold">Template</p><p className="mt-0.5 text-muted-foreground">{template ? template.name : 'None fits — create one'}{plan.templateReason ? ` · ${plan.templateReason}` : ''}</p></li>
                    <li className="rounded-xl border border-border/70 p-3"><p className="font-semibold">Audience</p><p className="mt-0.5 text-muted-foreground">{plan.audience.type === 'tags' ? setup.tags.filter((t) => plan.audience.tagIds.includes(t.id)).map((t) => t.name).join(', ') : 'All contacts'}{plan.audience.reason ? ` · ${plan.audience.reason}` : ''}</p></li>
                    <li className="rounded-xl border border-border/70 p-3"><p className="font-semibold">Personalization</p><p className="mt-0.5 text-muted-foreground">{Object.keys(plan.personalization).length} variable(s) mapped</p></li>
                    <li className="rounded-xl border border-border/70 p-3"><p className="font-semibold">Timing</p><p className="mt-0.5 text-muted-foreground">{plan.schedule.at ? new Date(plan.schedule.at).toLocaleString() : 'Send now'}{plan.schedule.reason ? ` · ${plan.schedule.reason}` : ''}</p></li>
                  </ul>
                  {plan.tips.length > 0 && (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {plan.tips.map((t) => <li key={t} className="flex gap-1.5"><Lightbulb className="mt-0.5 size-3 shrink-0 text-amber-500" />{t}</li>)}
                    </ul>
                  )}
                  <Button size="sm" onClick={() => setStep('template')} className="gap-1.5">Review step by step <ChevronRight className="size-3.5" /></Button>
                </Panel>
              )}
            </>
          )}

          {/* ───────────── TEMPLATE ───────────── */}
          {step === 'template' && (
            <Panel
              title="Choose an approved template"
              icon={LayoutTemplate}
              desc="Only templates Meta has approved can be broadcast."
              right={<Link href="/templates" className="text-xs font-medium text-primary hover:underline">Manage templates</Link>}
            >
              {plan?.newTemplateBrief && !template && (
                <AiHint>
                  <p className="font-semibold">None of your approved templates fits this goal.</p>
                  <p className="mt-0.5 text-muted-foreground">{plan.newTemplateBrief}</p>
                  <Link href={`/templates?ai=${encodeURIComponent(plan.newTemplateBrief.slice(0, 600))}`} className="mt-1.5 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                    Create this template with AI <ArrowRight className="size-3" />
                  </Link>
                </AiHint>
              )}
              {plan?.templateReason && template && plan.templateId === template.id && <AiHint>{plan.templateReason}</AiHint>}

              {setup.templates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center">
                  <FileText className="mx-auto mb-2 size-7 text-muted-foreground" />
                  <p className="text-sm font-semibold">No approved templates yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">Create a template and get it approved by Meta, or sync existing ones.</p>
                  <Link href="/templates" className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">Go to templates</Link>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input value={templateQuery} onChange={(e) => setTemplateQuery(e.target.value)} placeholder="Search templates…" className="h-9 pl-8 text-xs" />
                  </div>
                  <div className="grid max-h-[460px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {filteredTemplates.map((t: TemplateDto) => {
                      const selected = t.id === state.templateId;
                      return (
                        <button
                          key={t.id}
                          onClick={() => update({ templateId: t.id, personalization: selected ? state.personalization : {} })}
                          aria-pressed={selected}
                          className={`rounded-xl border p-3 text-left transition-all ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border/70 hover:border-primary/40'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs font-semibold">{t.name}</span>
                            {selected ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : <span className="text-[10px] text-muted-foreground">{t.language}</span>}
                          </div>
                          <span className="mt-1 inline-block rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{t.category}</span>
                          <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{t.bodyText}</p>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </Panel>
          )}

          {/* ───────────── AUDIENCE ───────────── */}
          {step === 'audience' && (
            <Panel title="Who should receive it?" icon={Users} desc="Recipients are frozen when the campaign is created, so the count you see is the count that sends.">
              {plan?.audience.reason && <AiHint>{plan.audience.reason}</AiHint>}
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['all', 'All contacts', `${setup.totalContacts.toLocaleString()} reachable`, Users],
                  ['tags', 'By tags', `${setup.tags.length} segments`, Tag],
                  ['csv', 'Upload CSV', 'Phone list', Upload],
                ] as const).map(([mode, label, sub, Icon]) => (
                  <button
                    key={mode}
                    onClick={() => update({ audienceMode: mode })}
                    aria-pressed={state.audienceMode === mode}
                    className={`rounded-xl border p-3 text-left transition-all ${state.audienceMode === mode ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border/70 hover:border-primary/40'}`}
                  >
                    <Icon className="size-4 text-primary" />
                    <p className="mt-1.5 text-xs font-semibold">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{sub}</p>
                  </button>
                ))}
              </div>

              {state.audienceMode === 'tags' && (
                <div className="space-y-2">
                  <Label className="text-xs">Include contacts with any of these tags</Label>
                  {setup.tags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tags yet. Tag contacts in the Contacts page to build segments.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {setup.tags.map((t) => {
                        const on = state.tagIds.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            onClick={() => update({ tagIds: on ? state.tagIds.filter((x) => x !== t.id) : [...state.tagIds, t.id], excludeTagIds: state.excludeTagIds.filter((x) => x !== t.id) })}
                            aria-pressed={on}
                            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-primary bg-primary/10 font-semibold text-foreground' : 'border-border text-muted-foreground hover:border-primary/40'}`}
                          >
                            <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
                            <span className="text-[10px] text-muted-foreground">{t.contactCount}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {state.audienceMode === 'csv' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Default country code</Label>
                      <Input value={countryCode} onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className="h-9 w-24 text-xs" placeholder="91" />
                    </div>
                    <input ref={csvRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); }} />
                    <Button variant="outline" onClick={() => csvRef.current?.click()} disabled={csvImporting} className="gap-1.5">
                      {csvImporting ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      {state.csv ? 'Replace CSV' : 'Upload CSV'}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Columns: <code>phone</code> (required), <code>name</code> (optional). New numbers are added to your contacts; numbers without a country code get the default above.</p>
                  {state.csv && (
                    <p className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs"><CheckCircle2 className="size-3.5 text-primary" /> <b>{state.csv.fileName}</b> — {state.csv.summary}</p>
                  )}
                </div>
              )}

              {setup.tags.length > 0 && (
                <div className="space-y-2 border-t border-border/60 pt-3">
                  <Label className="text-xs">Exclude contacts with these tags</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {setup.tags.filter((t) => !state.tagIds.includes(t.id)).map((t) => {
                      const on = state.excludeTagIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => update({ excludeTagIds: on ? state.excludeTagIds.filter((x) => x !== t.id) : [...state.excludeTagIds, t.id] })}
                          aria-pressed={on}
                          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-destructive/50 bg-destructive/10 font-semibold text-destructive' : 'border-border text-muted-foreground hover:border-destructive/40'}`}
                        >
                          {on && <XCircle className="size-3" />} {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 rounded-xl bg-muted/60 px-4 py-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recipients</p>
                  <p className="text-2xl font-bold tabular-nums">{previewLoading ? <Loader2 className="size-5 animate-spin" /> : (preview?.reach ?? 0).toLocaleString()}</p>
                </div>
                {preview && preview.excluded > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Excluded</p>
                    <p className="text-lg font-semibold tabular-nums text-muted-foreground">{preview.excluded.toLocaleString()}</p>
                  </div>
                )}
                {preview && preview.sample.length > 0 && (
                  <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">e.g. {preview.sample.map((s) => s.name || `+${s.phone}`).join(', ')}</p>
                )}
              </div>
            </Panel>
          )}

          {/* ───────────── PERSONALIZE ───────────── */}
          {step === 'personalize' && (
            <Panel
              title="Fill in the variables"
              icon={Wand2}
              desc="Each placeholder gets the same text for everyone, or data from each contact with a fallback."
              right={setup.aiAvailable && template && slots.length > 0 ? (
                <Button size="sm" variant="outline" onClick={() => runPlan({ lockTemplate: true })} disabled={planning} className="gap-1.5">
                  {planning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} AI fill
                </Button>
              ) : undefined}
            >
              {!template ? (
                <p className="text-xs text-muted-foreground">Choose a template first.</p>
              ) : slots.length === 0 ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-4 text-primary" /> This template has no variables — nothing to fill in.</p>
              ) : (
                <div className="space-y-3">
                  {slots.map((slot) => {
                    const m: SlotMapping = state.personalization[slot.key] ?? { source: 'static', value: '' };
                    const issue = mappingIssues.find((i) => i.key === slot.key);
                    const set = (patch: Partial<SlotMapping>) => update({ personalization: { ...state.personalization, [slot.key]: { ...m, ...patch } } });
                    return (
                      <div key={slot.key} className={`space-y-2 rounded-xl border p-3 ${issue ? 'border-amber-500/40' : 'border-border/70'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold">{slot.label}</p>
                            <p className="truncate text-[11px] text-muted-foreground" title={slot.context}>{slot.context}</p>
                          </div>
                          {!issue && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
                        </div>
                        {slot.kind === 'header_media' ? (
                          <Input value={m.value ?? ''} onChange={(e) => set({ source: 'static', value: e.target.value.trim() })} placeholder="https://… public link to the image / video / PDF" className="h-9 text-xs" />
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
                            <Select value={m.source} onValueChange={(raw) => { const v = (raw ?? 'static') as string; set({ source: v as MappingSource, value: v === 'static' ? m.value : v === 'custom_field' ? setup.customFields[0]?.id : undefined, fallback: v === 'static' ? undefined : m.fallback || (v.includes('name') ? 'there' : '') }); }}>
                              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {(Object.keys(SOURCE_LABELS) as MappingSource[])
                                  .filter((s) => s !== 'custom_field' || setup.customFields.length > 0)
                                  .map((s) => <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {m.source === 'static' ? (
                              <Input value={m.value ?? ''} onChange={(e) => set({ value: e.target.value })} placeholder="Value for everyone" className="h-9 text-xs sm:col-span-2" />
                            ) : (
                              <>
                                {m.source === 'custom_field' ? (
                                  <Select value={m.value ?? ''} onValueChange={(v) => set({ value: v ?? undefined })}>
                                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Field" /></SelectTrigger>
                                    <SelectContent>{setup.customFields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                                  </Select>
                                ) : (
                                  <div className="flex h-9 items-center rounded-md bg-muted px-3 text-[11px] text-muted-foreground">e.g. “{resolveMapping({ ...m, fallback: '' }, sampleContact) || '—'}”</div>
                                )}
                                <Input value={m.fallback ?? ''} onChange={(e) => set({ fallback: e.target.value })} placeholder="Fallback if missing" className="h-9 text-xs" />
                              </>
                            )}
                          </div>
                        )}
                        {issue && <p className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3" /> {issue.message}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {/* ───────────── LAUNCH ───────────── */}
          {step === 'launch' && (
            <>
              <Panel title="Name & timing" icon={CalendarClock}>
                <div className="space-y-1.5">
                  <Label htmlFor="cmp-name" className="text-xs">Campaign name</Label>
                  <Input id="cmp-name" value={state.name} onChange={(e) => update({ name: e.target.value.slice(0, 160) })} placeholder="e.g. Diwali Sale – Loyal Customers" className="h-9 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {([['now', 'Send now', Zap], ['later', 'Schedule', CalendarClock]] as const).map(([mode, label, Icon]) => (
                    <button
                      key={mode}
                      onClick={() => update({ scheduleMode: mode, scheduledLocal: mode === 'later' && !state.scheduledLocal ? defaultLater() : state.scheduledLocal })}
                      aria-pressed={state.scheduleMode === mode}
                      className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold transition-all ${state.scheduleMode === mode ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border/70 hover:border-primary/40'}`}
                    >
                      <Icon className="size-4 text-primary" /> {label}
                    </button>
                  ))}
                </div>
                {state.scheduleMode === 'later' && (
                  <div className="space-y-1">
                    <Input type="datetime-local" value={state.scheduledLocal} min={toLocalInput(new Date())} onChange={(e) => update({ scheduledLocal: e.target.value })} className="h-9 w-auto text-sm" />
                    <p className="text-[11px] text-muted-foreground">Your timezone: {tz()}{plan?.schedule.reason ? ` · AI: ${plan.schedule.reason}` : ''}</p>
                  </div>
                )}
              </Panel>

              <Panel
                title="Launch checklist"
                icon={ShieldCheck}
                right={<span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${blockers.length ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>{blockers.length ? `${blockers.length} to fix` : 'Ready'}</span>}
              >
                <ul className="space-y-1.5">
                  {checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-xs">
                      {c.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" /> : c.level === 'error' ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : c.level === 'warning' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" /> : <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                      <span className={`flex-1 ${c.ok ? 'text-muted-foreground' : ''}`}>{c.label}</span>
                      {!c.ok && c.step && c.step !== 'launch' && <button onClick={() => setStep(c.step!)} className="shrink-0 font-semibold text-primary hover:underline">Fix</button>}
                    </li>
                  ))}
                </ul>
              </Panel>

              {setup.aiAvailable && (
                <Panel
                  title="AI pre-launch review"
                  icon={BrainCircuit}
                  right={!reviewing && review ? <Button size="sm" variant="ghost" onClick={runReview} className="h-7 gap-1 text-xs"><RefreshCw className="size-3" /> Re-run</Button> : undefined}
                >
                  {reviewing ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Reading your campaign like a recipient would…</p>
                  ) : review ? (
                    <div className="space-y-2">
                      <p className={`flex items-center gap-1.5 text-xs font-semibold ${review.verdict === 'ready' ? 'text-primary' : review.verdict === 'blocked' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`}>
                        {review.verdict === 'ready' ? <ShieldCheck className="size-4" /> : <AlertTriangle className="size-4" />}
                        {review.verdict === 'ready' ? 'Looks good to send' : review.verdict === 'blocked' ? 'Fix before sending' : 'Worth a second look'}
                        {reviewedKey !== draftKey && <span className="font-normal text-muted-foreground">· out of date</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{review.summary}</p>
                      {review.findings.length > 0 && (
                        <ul className="space-y-1">
                          {review.findings.map((f, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs">
                              {f.severity === 'error' ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : f.severity === 'warning' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" /> : <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                              <span className="flex-1">{f.message}</span>
                              {f.step !== 'general' && f.step !== 'schedule' && <button onClick={() => setStep(f.step as StepKey)} className="shrink-0 font-semibold text-primary hover:underline">Open</button>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{blockers.length ? 'Runs automatically once the checklist has no blockers.' : 'Starting…'}</p>
                  )}
                </Panel>
              )}

              <Panel title="Send a test" icon={Send} desc="Delivers this exact template to one number using the fallback values. The number must be able to receive messages from your WhatsApp Business number.">
                <div className="flex flex-wrap gap-2">
                  <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+919876543210" className="h-9 w-56 text-sm" />
                  <Button variant="outline" onClick={sendTest} disabled={testing || !template || mappingIssues.length > 0 || testPhone.replace(/\D/g, '').length < 8} className="gap-1.5">
                    {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send test
                  </Button>
                </div>
              </Panel>
            </>
          )}

          {/* Footer nav */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button variant="ghost" onClick={() => (stepIndex === 0 ? router.push('/campaigns') : go(-1))} className="gap-1.5">
              <ArrowLeft className="size-4" /> {stepIndex === 0 ? 'Cancel' : 'Back'}
            </Button>
            {step !== 'launch' ? (
              <Button onClick={() => go(1)} disabled={!canNext[step]} className="gap-1.5">
                Continue <ArrowRight className="size-4" />
              </Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => launch('draft')} disabled={Boolean(launching) || !template || !audience || mappingIssues.length > 0} className="gap-1.5">
                  {launching === 'draft' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save draft
                </Button>
                <Button onClick={() => launch('launch')} disabled={Boolean(launching) || blockers.length > 0} className="gap-1.5">
                  {launching === 'launch' ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                  {state.scheduleMode === 'later' ? 'Schedule campaign' : `Launch to ${(preview?.reach ?? 0).toLocaleString()} contacts`}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Live preview */}
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">Live preview</p>
            {preview && preview.sample.length > 1 && (
              <button onClick={() => setSampleIndex((i) => i + 1)} className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                <RefreshCw className="size-3" /> Next contact
              </button>
            )}
          </div>
          {template ? (
            <>
              <PhonePreview
                headerType={template.headerType}
                headerText={renderedHeader}
                bodyText={renderedBody}
                footerText={template.footerText ?? undefined}
                buttons={template.buttons.map((b) => ({ type: b.type, text: b.text, url: b.url ?? undefined }))}
                mediaPreviewUrl={template.headerType === 'image' && /^https:/.test(state.personalization.header_media?.value ?? '') ? state.personalization.header_media?.value : undefined}
                theme="light"
              />
              <p className="text-center text-[11px] text-muted-foreground">As seen by {sampleContact.name || `+${sampleContact.phone}`}</p>
            </>
          ) : (
            <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center">
              <LayoutTemplate className="mb-2 size-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Pick a template to preview the message.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
