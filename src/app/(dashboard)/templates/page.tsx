'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  LayoutTemplate, Plus, RefreshCw, Search, Sparkles, XCircle,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TemplateCard, type TemplateMetaDetail } from '@/components/templates/template-card';
import { EMPTY_DRAFT, TemplateBuilder } from '@/components/templates/template-builder';
import { STARTER_TEMPLATES, type StarterTemplate } from '@/components/templates/starter-templates';
import { DEFAULT_AUTH_OPTIONS, type TemplateDraft } from '@/lib/whatsapp/template-rules';
import type { MessageTemplate } from '@/types';

type StatusFilter = 'all' | 'Approved' | 'Pending' | 'Rejected';

/** How often to re-check Meta while something is still in review. */
const PENDING_POLL_MS = 30_000;

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
  const [syncError, setSyncError] = useState<string | null>(null);

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
    setSyncing(!silent); // background refreshes stay invisible
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);

      const map: Record<string, TemplateMetaDetail> = {};
      for (const d of data.details ?? []) map[`${d.name}:${d.language}`] = d;
      setDetails(map);
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

  const FILTERS: Array<{ key: StatusFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'Approved', label: 'Approved' },
    { key: 'Pending', label: 'In review' },
    { key: 'Rejected', label: 'Rejected' },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Message templates</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Create templates, get them approved by Meta and use them in campaigns and the inbox.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => syncFromMeta(false)} disabled={syncing} className="gap-1.5">
            <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sync
          </Button>
          <Button variant="outline" size="sm" render={<Link href="/connections/whatsapp-templates" />}>
            Appointment templates
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
              <LayoutTemplate className="size-3.5" /> Start from
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
              {STARTER_TEMPLATES.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => openBuilder(starterToDraft(s))} className="flex-col items-start gap-0.5">
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{s.label}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{s.category}</span>
                  </span>
                  <span className="line-clamp-1 text-[11px] text-muted-foreground">{s.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => openBuilder(EMPTY_DRAFT)} className="gap-1.5">
            <Sparkles className="size-3.5" /> New template
          </Button>
        </div>
      </div>

      {syncError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <XCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">Couldn&apos;t reach Meta: {syncError}</span>
        </div>
      )}

      {/* Status tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-border/70 bg-card p-1" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${filter === f.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
            >
              {f.label} <span className="opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or text…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-60 pl-8 text-[13px]"
            aria-label="Search templates"
          />
        </div>
      </div>

      {/* Library */}
      <div>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl border border-border/60 bg-muted/50" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-4 py-14 text-center">
            <LayoutTemplate className="mb-3 size-8 text-muted-foreground/60" />
            {templates.length === 0 ? (
              <>
                <p className="text-sm font-semibold">No templates yet</p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">Create one with AI, start from a ready-made template, or sync templates you already have in Meta.</p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => openBuilder(EMPTY_DRAFT)} className="gap-1.5"><Plus className="size-3.5" /> New template</Button>
                  <Button variant="outline" size="sm" onClick={() => syncFromMeta(false)} disabled={syncing} className="gap-1.5"><RefreshCw className="size-3.5" /> Sync from Meta</Button>
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
