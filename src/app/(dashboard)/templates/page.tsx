'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  CheckCircle2, Clock, LayoutTemplate, Loader2, Plus, RefreshCw, Search, Sparkles, XCircle,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { TemplateCard, type TemplateMetaDetail } from '@/components/templates/template-card';
import { EMPTY_DRAFT, TemplateBuilder } from '@/components/templates/template-builder';
import { STARTER_TEMPLATES, type StarterTemplate } from '@/components/templates/starter-templates';
import { DEFAULT_AUTH_OPTIONS, type TemplateDraft } from '@/lib/whatsapp/template-rules';
import type { MessageTemplate } from '@/types';

type StatusFilter = 'all' | 'Approved' | 'Pending' | 'Rejected';

/** How often to re-check Meta while something is still in review. */
const PENDING_POLL_MS = 30_000;

function timeAgo(date: Date | null): string {
  if (!date) return 'never';
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** Turn a stored template back into an editable draft (edit / duplicate). */
function templateToDraft(t: MessageTemplate, copy: boolean): TemplateDraft {
  const buttons = (Array.isArray(t.buttons) ? t.buttons : [])
    .map((b) => b as Record<string, unknown>)
    .filter((b) => ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(String(b.type)))
    .map((b) => {
      const ex = Array.isArray(b.example) ? String(b.example[0] ?? '') : String(b.example ?? '');
      return {
        type: b.type as 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER',
        text: String(b.text ?? ''),
        url: String(b.url ?? ''),
        phone_number: String(b.phone_number ?? ''),
        example: ex,
      };
    });
  const isAuth = t.category === 'Authentication';
  return {
    ...EMPTY_DRAFT,
    name: copy ? `${t.name}_copy`.slice(0, 512) : t.name,
    category: t.category,
    language: t.language || 'en_US',
    header_type: isAuth ? 'none' : (t.header_type ?? 'none'),
    header_text: t.header_type === 'text' ? t.header_content ?? '' : '',
    body_text: isAuth ? '' : t.body_text ?? '',
    footer_text: isAuth ? '' : t.footer_text ?? '',
    buttons: isAuth ? [] : buttons,
    auth: isAuth ? DEFAULT_AUTH_OPTIONS : undefined,
  };
}

function starterToDraft(s: StarterTemplate): TemplateDraft {
  return {
    ...EMPTY_DRAFT,
    name: s.name,
    category: s.category,
    language: s.language,
    header_type: s.header_type,
    header_text: s.header_text,
    body_text: s.body_text,
    footer_text: s.footer_text,
    buttons: s.buttons,
    auth: s.category === 'Authentication' ? DEFAULT_AUTH_OPTIONS : undefined,
  };
}

export default function TemplatesPage() {
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [details, setDetails] = useState<Record<string, TemplateMetaDetail>>({});
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  const [builder, setBuilder] = useState<{ draft: TemplateDraft; mode: 'new' | 'edit'; key: number; aiBrief?: string } | null>(null);

  // Deep link from the campaign planner: /templates?ai=<brief> opens the AI builder prefilled.
  useEffect(() => {
    const brief = new URLSearchParams(window.location.search).get('ai');
    if (brief) {
      setBuilder({ draft: EMPTY_DRAFT, mode: 'new', key: Date.now(), aiBrief: brief });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [pendingDelete, setPendingDelete] = useState<MessageTemplate | null>(null);
  const syncingRef = useRef(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/templates', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load templates');
      setTemplates(data.templates || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Pull statuses from Meta. `silent` = background refresh (no success toast). */
  const syncFromMeta = useCallback(async (silent: boolean) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);

      const map: Record<string, TemplateMetaDetail> = {};
      for (const d of data.details ?? []) map[`${d.name}:${d.language}`] = d;
      setDetails(map);
      setLastSynced(new Date());
      setSyncError(null);

      for (const c of (data.changes ?? []) as Array<{ name: string; from: string | null; to: string }>) {
        if (!c.from) continue;
        if (c.to === 'Approved') toast.success(`“${c.name}” was approved by Meta`);
        else if (c.to === 'Rejected') toast.error(`“${c.name}” was rejected by Meta`);
      }
      if (!silent) {
        toast.success(`Synced ${data.total} template${data.total === 1 ? '' : 's'} from Meta`);
      }
      await fetchTemplates();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sync templates';
      setSyncError(message);
      if (!silent) toast.error(message);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [fetchTemplates]);

  // Initial load, then a silent sync so statuses are fresh.
  useEffect(() => {
    if (authLoading) return;
    fetchTemplates().then(() => syncFromMeta(true));
  }, [authLoading, user?.id, fetchTemplates, syncFromMeta]);

  // While anything is in review, re-check periodically (visible tab only).
  const pendingCount = templates.filter((t) => t.status === 'Pending').length;
  useEffect(() => {
    if (!pendingCount || builder) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') syncFromMeta(true);
    }, PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [pendingCount, builder, syncFromMeta]);

  // Keep "synced x ago" fresh.
  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  async function confirmDelete() {
    const t = pendingDelete;
    if (!t) return;
    try {
      const res = await fetch(`/api/whatsapp/templates?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to delete template');
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      if (data.meta_warning) toast.warning(`Removed locally. Meta said: ${data.meta_warning}`);
      else toast.success('Template deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setPendingDelete(null);
    }
  }

  const openBuilder = (draft: TemplateDraft, mode: 'new' | 'edit' = 'new') =>
    setBuilder({ draft, mode, key: Date.now() });

  const existingKeys = useMemo(() => new Set(templates.map((t) => `${t.name}:${t.language}`)), [templates]);

  const counts = useMemo(() => ({
    all: templates.length,
    Approved: templates.filter((t) => t.status === 'Approved').length,
    Pending: pendingCount,
    Rejected: templates.filter((t) => t.status === 'Rejected').length,
  }), [templates, pendingCount]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) =>
      (filter === 'all' || t.status === filter) &&
      (!q || t.name.toLowerCase().includes(q) || t.body_text?.toLowerCase().includes(q)),
    );
  }, [templates, filter, search]);

  if (builder) {
    return (
      <TemplateBuilder
        key={builder.key}
        initial={builder.draft}
        mode={builder.mode}
        existingKeys={existingKeys}
        initialAiDescription={builder.aiBrief}
        onClose={() => setBuilder(null)}
        onSubmitted={() => { fetchTemplates(); }}
      />
    );
  }

  const FILTERS: Array<{ key: StatusFilter; label: string; icon: React.ElementType; tone: string }> = [
    { key: 'all', label: 'All templates', icon: LayoutTemplate, tone: 'text-muted-foreground dark:text-slate-300' },
    { key: 'Approved', label: 'Approved', icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'Pending', label: 'In review', icon: Clock, tone: 'text-amber-600 dark:text-amber-400' },
    { key: 'Rejected', label: 'Rejected', icon: XCircle, tone: 'text-red-600 dark:text-red-400' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <LayoutTemplate className="size-6 text-emerald-600" /> Message templates
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground dark:text-slate-400">
            Create templates with AI or by hand, get them approved by Meta, and use them in broadcasts and the inbox.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline" title={lastSynced?.toLocaleString()}>
            {syncing ? 'Syncing with Meta…' : `Synced ${timeAgo(lastSynced)}`}
          </span>
          <Button variant="outline" onClick={() => syncFromMeta(false)} disabled={syncing} className="h-9 gap-2 text-xs font-semibold">
            <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sync from Meta
          </Button>
          <Button variant="outline" render={<a href="/connections/whatsapp-templates" />} className="h-9 gap-2 text-xs font-semibold">
            Appointment templates
          </Button>
          <Button onClick={() => openBuilder(EMPTY_DRAFT)} className="h-9 gap-2 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700">
            <Plus className="size-4" /> New template
          </Button>
        </div>
      </div>

      {syncError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-300">
          <XCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">Couldn&apos;t reach Meta: {syncError}</span>
        </div>
      )}

      {/* Status filters */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
              filter === f.key
                ? 'border-emerald-500/60 bg-emerald-50/60 ring-1 ring-emerald-500/20 dark:bg-emerald-500/5'
                : 'border-slate-200/70 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/40'
            }`}
          >
            <f.icon className={`size-4 ${f.tone}`} />
            <span>
              <span className="block text-lg font-bold leading-none text-slate-800 dark:text-slate-100">{counts[f.key]}</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{f.label}</span>
            </span>
            {f.key === 'Pending' && counts.Pending > 0 && <Loader2 className="ml-auto size-3.5 animate-spin text-amber-500" />}
          </button>
        ))}
      </div>

      {/* AI CTA + starters */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <button
          onClick={() => openBuilder(EMPTY_DRAFT)}
          className="group flex items-start gap-3 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 text-left transition-shadow hover:shadow-md dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-transparent"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"><Sparkles className="size-4" /></span>
          <span>
            <span className="block text-sm font-bold text-slate-800 dark:text-white">Write a template with AI</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground dark:text-slate-400">
              Describe the message in plain words — get a Meta-ready template with variables, samples and buttons.
            </span>
          </span>
        </button>
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Or start from a proven template</p>
          <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2">
            {STARTER_TEMPLATES.map((s) => (
              <button
                key={s.id}
                onClick={() => openBuilder(starterToDraft(s))}
                className="flex min-w-[190px] max-w-[190px] flex-col items-start gap-1.5 rounded-xl border border-slate-200/80 bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-500/50 dark:border-slate-800 dark:bg-slate-900/40"
              >
                <span className="flex items-center gap-2">
                  <span className="text-lg">{s.emoji}</span>
                  <span className="text-[10px] font-semibold text-muted-foreground">{s.category}</span>
                </span>
                <span className="w-full truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{s.label}</span>
                <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground dark:text-slate-400">{s.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Library */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">
            Your templates {filter !== 'all' && <span className="font-normal text-muted-foreground">· {FILTERS.find((f) => f.key === filter)?.label}</span>}
          </h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name or text…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-56 pl-8 text-xs"
              aria-label="Search templates"
            />
          </div>
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-200/60 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-900/40" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/50 px-4 py-14 text-center dark:border-slate-800 dark:bg-slate-900/20">
            <LayoutTemplate className="mb-3 size-9 text-foreground/90 dark:text-slate-700" />
            {templates.length === 0 ? (
              <>
                <p className="text-sm font-semibold text-muted-foreground dark:text-slate-300">No templates yet</p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">Create one with AI, start from a starter above, or sync templates you already have in Meta.</p>
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => openBuilder(EMPTY_DRAFT)} className="h-9 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"><Plus className="size-4" /> New template</Button>
                  <Button variant="outline" onClick={() => syncFromMeta(false)} disabled={syncing} className="h-9 gap-1.5 text-xs"><RefreshCw className="size-3.5" /> Sync from Meta</Button>
                </div>
              </>
            ) : (
              <p className="text-xs font-semibold text-muted-foreground">No templates match these filters.</p>
            )}
          </div>
        ) : (
          <motion.div layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence>
              {visible.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  detail={details[`${t.name}:${t.language}`]}
                  onDelete={setPendingDelete}
                  onEdit={(tpl) => openBuilder(templateToDraft(tpl, false), 'edit')}
                  onDuplicate={(tpl) => openBuilder(templateToDraft(tpl, true))}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <ConfirmationDialog
        isOpen={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={`Delete “${pendingDelete?.name ?? ''}”?`}
        description="This deletes the template from Meta (all languages with this name) and from this workspace. Broadcasts using it will stop working. This cannot be undone."
        confirmText="Delete template"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
