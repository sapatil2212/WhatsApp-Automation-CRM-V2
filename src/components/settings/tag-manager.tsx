'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, Plus, Search, Tag as TagIcon, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/campaigns/api';
import { cn } from '@/lib/utils';

interface TagRow { id: string; name: string; color: string; contactCount: number | null }

const PRESET_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Slate', value: '#64748b' },
];

function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ backgroundColor: `${color}1f`, color, border: `1px solid ${color}40` }}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Contact tags, backed by /api/tags (unique names per workspace). */
export function TagManager() {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TagRow | 'new' | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[3].value);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<TagRow | null>(null);

  const load = useCallback(async () => {
    try {
      setTags((await api<TagRow[]>('/api/tags')).data);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load tags');
      setTags([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tags ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [tags, search]);

  const openNew = () => {
    setName('');
    setColor(PRESET_COLORS[3].value);
    setFormError(null);
    setEditing('new');
  };
  const openEdit = (t: TagRow) => {
    setName(t.name);
    setColor(t.color);
    setFormError(null);
    setEditing(t);
  };

  const save = async () => {
    if (!name.trim()) return setFormError('Tag name is required.');
    setSaving(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await api('/api/tags', { method: 'POST', json: { name: name.trim(), color } });
        toast.success('Tag created');
      } else if (editing) {
        const patch: Record<string, string> = {};
        if (name.trim() !== editing.name) patch.name = name.trim();
        if (color !== editing.color) patch.color = color;
        if (Object.keys(patch).length) await api(`/api/tags/${editing.id}`, { method: 'PATCH', json: patch });
        toast.success('Tag updated');
      }
      setEditing(null);
      await load();
    } catch (e) {
      setFormError((e as Error).message || 'Could not save the tag');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: TagRow) => {
    try {
      await api(`/api/tags/${t.id}`, { method: 'DELETE' });
      toast.success('Tag deleted');
      setTags((prev) => (prev ?? []).filter((x) => x.id !== t.id));
    } catch (e) {
      toast.error((e as Error).message || 'Failed to delete tag');
    }
  };

  return (
    <section className="rounded-xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Tags</h3>
          <p className="text-xs text-muted-foreground">Colour-coded labels for organising contacts and targeting campaigns.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tags" className="h-8 w-44 pl-8 text-[13px] md:text-[13px]" aria-label="Search tags" />
          </div>
          <Button size="sm" className="gap-1.5" onClick={openNew}><Plus className="size-3.5" /> New tag</Button>
        </div>
      </div>

      {tags === null ? (
        <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-md bg-muted/60" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <TagIcon className="mx-auto mb-2 size-7 text-muted-foreground/40" />
          <p className="text-[13px] font-medium">{search ? 'No tags match your search' : 'No tags yet'}</p>
          {!search && <p className="mt-0.5 text-xs text-muted-foreground">Create tags like &quot;VIP&quot;, &quot;New patient&quot; or &quot;Follow up&quot;.</p>}
          {!search && <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={openNew}><Plus className="size-3.5" /> New tag</Button>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-border bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-2 pl-4 pr-3">Tag</th><th className="px-3 py-2">Contacts</th><th className="w-24 py-2 pl-3 pr-4 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-muted/30">
                  <td className="max-w-0 py-2 pl-4 pr-3"><TagChip name={t.name} color={t.color} /></td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{t.contactCount ?? 0}</td>
                  <td className="py-2 pl-3 pr-4">
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" title="Edit" aria-label={`Edit ${t.name}`} onClick={() => openEdit(t)}><Pencil className="size-3.5" /></Button>
                      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" title="Delete" aria-label={`Delete ${t.name}`} onClick={() => setToDelete(t)}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o && !saving) setEditing(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'New tag' : 'Edit tag'}</DialogTitle>
            <DialogDescription>{editing === 'new' ? 'Pick a short name and a colour.' : 'Changes apply to every contact with this tag.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Name</span>
              <Input autoFocus maxLength={60} placeholder="e.g. VIP customer" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} className="h-8 text-[13px] md:text-[13px]" />
            </label>
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Colour</span>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    title={c.name}
                    aria-label={c.name}
                    aria-pressed={color === c.value}
                    className={cn('flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110', color === c.value && 'ring-2')}
                    style={{ backgroundColor: c.value, ['--tw-ring-color' as string]: c.value }}
                  >
                    {color === c.value && <Check className="size-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Preview</span>
              <div><TagChip name={name.trim() || 'Tag name'} color={color} /></div>
            </div>
            {formError && <p role="alert" className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>{saving && <Loader2 className="size-3.5 animate-spin" />} {editing === 'new' ? 'Create tag' : 'Save changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={!!toDelete}
        onOpenChange={(o) => { if (!o) setToDelete(null); }}
        title="Delete this tag?"
        description="It is removed from every contact that has it."
        details={toDelete ? <span className="flex items-center gap-2"><TagChip name={toDelete.name} color={toDelete.color} /> <span className="text-muted-foreground">{toDelete.contactCount ?? 0} contact{toDelete.contactCount === 1 ? '' : 's'}</span></span> : undefined}
        notes={['Campaign audiences that use this tag will no longer match these contacts.', 'This cannot be undone.']}
        confirmText="Delete tag"
        variant="destructive"
        onConfirm={async () => { const t = toDelete; setToDelete(null); if (t) await remove(t); }}
      />
    </section>
  );
}
