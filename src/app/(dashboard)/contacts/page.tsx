'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowDownAZ, ArrowUpDown, ChevronLeft, ChevronRight, Download, Eye, Filter, Loader2, Mail, Megaphone,
  Pencil, Plus, Search, Sparkles, Tag as TagIcon, Trash2, UserPlus, Users, X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ContactEditor, type ContactRow, type TagItem } from '@/components/contacts/contact-editor';
import { AiImportDialog } from '@/components/contacts/ai-import-dialog';
import { api } from '@/lib/campaigns/api';

type Sort = 'createdAt:desc' | 'createdAt:asc' | 'name:asc' | 'name:desc' | 'updatedAt:desc';
const SORT_LABEL: Record<Sort, string> = {
  'createdAt:desc': 'Newest first',
  'createdAt:asc': 'Oldest first',
  'name:asc': 'Name A–Z',
  'name:desc': 'Name Z–A',
  'updatedAt:desc': 'Recently updated',
};

interface Stats { total: number; newThisWeek: number; untagged: number; withEmail: number; aiAvailable: boolean }

const AVATAR_COLORS = ['bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-indigo-500'];
function initials(c: ContactRow) {
  const src = (c.name || '').trim();
  if (!src) return '#';
  const parts = src.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function avatarColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function formatPhone(p: string) {
  const d = p.replace(/\D/g, '');
  if (d.startsWith('91') && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.startsWith('1') && d.length === 11) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return `+${d}`;
}

export default function ContactsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tags, setTags] = useState<TagItem[]>([]);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('createdAt:desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | { ids: string[]; label: string }>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadTags = useCallback(async () => {
    try { setTags((await api<TagItem[]>('/api/tags')).data); } catch { /* non-blocking */ }
  }, []);
  const loadStats = useCallback(async () => {
    try { setStats((await api<Stats>('/api/contacts/stats')).data); } catch { /* non-blocking */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [sortBy, sortDirection] = sort.split(':');
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortBy, sortDirection });
    if (debounced) q.set('search', debounced);
    if (tagFilter.length) q.set('tagIds', tagFilter.join(','));
    try {
      const res = await api<ContactRow[]>(`/api/contacts?${q}`);
      setRows(res.data);
      setTotal(res.meta?.pagination?.total ?? res.data.length);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sort, debounced, tagFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTags(); loadStats(); }, [loadTags, loadStats]);

  const refreshAll = useCallback(() => { load(); loadStats(); loadTags(); }, [load, loadStats, loadTags]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s);
      if (allOnPage) rows.forEach((r) => n.delete(r.id));
      else rows.forEach((r) => n.add(r.id));
      return n;
    });
  }

  async function bulk(action: 'delete' | 'addTags' | 'removeTags', ids: string[], tagIds: string[] = []) {
    setBulkBusy(true);
    try {
      const res = await api<{ affected: number }>('/api/contacts/bulk', { method: 'POST', json: { action, ids, tagIds } });
      const n = res.data.affected;
      toast.success(action === 'delete' ? `Deleted ${n} contact${n === 1 ? '' : 's'}` : action === 'addTags' ? `Tagged ${ids.length} contact${ids.length === 1 ? '' : 's'}` : 'Tag removed');
      if (action === 'delete') setSelected(new Set());
      refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBulkBusy(false);
    }
  }

  function exportSelected() {
    const list = rows.filter((r) => selected.has(r.id));
    const csv = [['Name', 'Phone', 'Email', 'Company', 'Tags', 'Created'], ...list.map((r) => [r.name ?? '', `+${r.phone}`, r.email ?? '', r.company ?? '', r.tags.map((t) => t.name).join('; '), r.createdAt])]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts-selected.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const filtersActive = Boolean(debounced) || tagFilter.length > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Your audience for conversations, campaigns and pipelines.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { window.open('/api/contacts/export', '_blank'); }} className="gap-1.5"><Download className="size-3.5" /> Export</Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-1.5"><Sparkles className="size-3.5 text-primary" /> AI import</Button>
          <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true); }} className="gap-1.5"><Plus className="size-3.5" /> Add contact</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: 'Total contacts', value: stats?.total, icon: Users },
          { label: 'Added this week', value: stats?.newThisWeek, icon: UserPlus },
          { label: 'Without tags', value: stats?.untagged, icon: TagIcon, action: () => {} },
          { label: 'With email', value: stats?.withEmail, icon: Mail },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><s.icon className="size-3.5" /></span>
            </div>
            <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{s.value === undefined ? '—' : s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email, company…" className="h-8 pl-8 pr-8 text-[13px]" aria-label="Search contacts" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-4" /></button>}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
            <Filter className="size-3.5" /> Tags{tagFilter.length ? ` (${tagFilter.length})` : ''}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
            {tags.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No tags yet</p>}
            {tags.map((t) => {
              const on = tagFilter.includes(t.id);
              return (
                <DropdownMenuItem key={t.id} closeOnClick={false} onClick={() => { setTagFilter((f) => (on ? f.filter((x) => x !== t.id) : [...f, t.id])); setPage(1); }}>
                  <span className={`flex size-4 items-center justify-center rounded border ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{on && '✓'}</span>
                  <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-[10px] text-muted-foreground">{t.contactCount}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={sort} onValueChange={(v) => { setSort((v ?? 'createdAt:desc') as Sort); setPage(1); }}>
          <SelectTrigger className="h-8 w-[190px] gap-1.5 text-[13px]"><ArrowUpDown className="size-3.5 text-muted-foreground" /><span className="text-muted-foreground">Sort:</span><SelectValue>{SORT_LABEL[sort]}</SelectValue></SelectTrigger>
          <SelectContent>{(Object.keys(SORT_LABEL) as Sort[]).map((s) => <SelectItem key={s} value={s}>{SORT_LABEL[s]}</SelectItem>)}</SelectContent>
        </Select>

        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setTagFilter([]); }} className="text-muted-foreground">Clear filters</Button>
        )}
        <p className="ml-auto text-xs text-muted-foreground">{total.toLocaleString()} {filtersActive ? 'matching' : 'total'}</p>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} className="h-7 text-xs">Clear</Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={bulkBusy} />}>
                <TagIcon className="size-3.5" /> Add tag
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                {tags.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => bulk('addTags', selectedIds, [t.id])}>
                    <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
                  </DropdownMenuItem>
                ))}
                {tags.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Create a tag first</p>}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={bulkBusy} />}>
                <X className="size-3.5" /> Remove tag
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                {tags.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => bulk('removeTags', selectedIds, [t.id])}>
                    <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={exportSelected}><Download className="size-3.5" /> Export</Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => router.push('/campaigns/new')}><Megaphone className="size-3.5" /> Campaign</Button>
            <Button variant="destructive" size="sm" className="h-8 gap-1.5" disabled={bulkBusy} onClick={() => setConfirm({ ids: selectedIds, label: `${selected.size} contacts` })}>
              {bulkBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Delete
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] table-fixed text-[13px]">
            <colgroup>
              <col className="w-12" />
              <col className="w-[30%]" />
              <col className="w-[20%]" />
              <col className="w-[28%]" />
              <col className="w-[14%]" />
              <col className="w-28" />
            </colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">
                  <input type="checkbox" className="size-4 cursor-pointer rx-check align-middle" checked={allOnPage} onChange={toggleAll} aria-label="Select all on this page" />
                </th>
                <th className="px-3 py-2"><button onClick={() => setSort(sort === 'name:asc' ? 'name:desc' : 'name:asc')} className="inline-flex items-center gap-1 hover:text-foreground">Contact <ArrowDownAZ className="size-3" /></button></th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Tags</th>
                <th className="px-3 py-2"><button onClick={() => setSort(sort === 'createdAt:desc' ? 'createdAt:asc' : 'createdAt:desc')} className="inline-flex items-center gap-1 hover:text-foreground">Added <ArrowUpDown className="size-3" /></button></th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && rows.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-3"><div className="h-8 animate-pulse rounded-lg bg-muted/70" /></td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <Users className="mx-auto size-9 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">{filtersActive ? 'No contacts match these filters' : 'No contacts yet'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{filtersActive ? 'Try a different search or tag.' : 'Add one manually or import a file — AI will find the contacts for you.'}</p>
                    {!filtersActive && (
                      <div className="mt-4 flex justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-1.5"><Sparkles className="size-3.5 text-primary" /> AI import</Button>
                        <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true); }} className="gap-1.5"><Plus className="size-3.5" /> Add contact</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const isSel = selected.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setDetailId(c.id)}
                      className={`group cursor-pointer transition-colors ${isSel ? 'bg-primary/5' : 'hover:bg-muted/50'} ${loading ? 'opacity-60' : ''}`}
                    >
                      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="size-4 cursor-pointer rx-check align-middle" checked={isSel} onChange={() => toggle(c.id)} aria-label={`Select ${c.name || c.phone}`} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-foreground ${avatarColor(c.id)}`}>{initials(c)}</span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium">{c.name || <span className="italic text-muted-foreground">Unnamed</span>}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{c.email || '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="truncate px-3 py-2 font-mono text-xs tabular-nums text-foreground/80">{formatPhone(c.phone)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {c.tags.slice(0, 3).map((t) => (
                            <span key={t.id} className="inline-flex max-w-[120px] items-center truncate rounded-full px-2 py-px text-[10px] font-medium" style={{ backgroundColor: `${t.color}1f`, color: t.color }}>{t.name}</span>
                          ))}
                          {c.tags.length > 3 && <span className="text-[11px] text-muted-foreground">+{c.tags.length - 3}</span>}
                          {c.tags.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground">{new Date(c.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-0.5">
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="View details" aria-label={`View ${c.name || c.phone}`} onClick={() => setDetailId(c.id)}><Eye className="size-3.5" /></Button>
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit" aria-label={`Edit ${c.name || c.phone}`} onClick={() => { setEditing(c); setEditorOpen(true); }}><Pencil className="size-3.5" /></Button>
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete ${c.name || c.phone}`} onClick={() => setConfirm({ ids: [c.id], label: c.name || formatPhone(c.phone) })}><Trash2 className="size-3.5" /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v) || 25); setPage(1); }}>
              <SelectTrigger className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
              <SelectContent>{[10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <span>{total === 0 ? '0' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
            <span className="px-2">Page {page} of {totalPages}</span>
            <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
          </div>
        </div>
      </div>

      <ContactEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        contact={editing}
        tags={tags}
        onTagCreated={(t) => setTags((ts) => [...ts, t].sort((a, b) => a.name.localeCompare(b.name)))}
        onSaved={() => refreshAll()}
      />

      <ContactDetailView
        open={Boolean(detailId)}
        onOpenChange={(o) => { if (!o) setDetailId(null); }}
        contactId={detailId}
        onUpdated={refreshAll}
      />

      <AiImportDialog open={importOpen} onOpenChange={setImportOpen} tags={tags} aiAvailable={stats?.aiAvailable ?? true} onImported={refreshAll} />

      <ConfirmationDialog
        isOpen={Boolean(confirm)}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={`Delete ${confirm?.label ?? ''}?`}
        description="Their conversations, notes and tags are removed too. This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={async () => { if (confirm) { await bulk('delete', confirm.ids); setSelected((s) => { const n = new Set(s); confirm.ids.forEach((id) => n.delete(id)); return n; }); } setConfirm(null); }}
      />
    </div>
  );
}
