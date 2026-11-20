'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { api, type Department } from './api';

const SUGGESTIONS = ['General Medicine', 'Pediatrics', 'Gynecology', 'Orthopedics', 'Dermatology', 'Cardiology', 'ENT', 'Dental', 'Ophthalmology', 'Physiotherapy'];

/** Step 2 of clinic setup: create, edit, reorder-free list of departments. */
export function DepartmentsManager({ onChange }: { onChange?: (list: Department[]) => void }) {
  const [list, setList] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', description: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Department | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api<Department[]>('/api/healthcare/departments');
      setList(rows);
      onChange?.(rows);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (n = name, d = description) => {
    const clean = n.trim();
    if (clean.length < 2) return toast.error('Enter a department name (at least 2 characters).');
    if (list.some((x) => x.name.toLowerCase() === clean.toLowerCase())) return toast.error(`"${clean}" already exists.`);
    setAdding(true);
    try {
      await api('/api/healthcare/departments', { method: 'POST', json: { name: clean, description: d.trim() || null } });
      setName('');
      setDescription('');
      toast.success(`Department "${clean}" added.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const save = async (id: string, patch: Partial<Pick<Department, 'name' | 'description' | 'isActive'>>) => {
    setBusyId(id);
    try {
      await api(`/api/healthcare/departments/${id}`, { method: 'PATCH', json: patch });
      setEditing(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (dep: Department) => {
    try {
      await api(`/api/healthcare/departments/${dep.id}`, { method: 'DELETE' });
      toast.success(`Department "${dep.name}" removed.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };

  const unused = SUGGESTIONS.filter((s) => !list.some((x) => x.name.toLowerCase() === s.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="dep-name">Department name *</Label>
            <Input id="dep-name" value={name} placeholder="e.g. Pediatrics" maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dep-desc">Description (optional)</Label>
            <Input id="dep-desc" value={description} placeholder="Shown to patients when they choose a department" maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button onClick={() => create()} disabled={adding} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add department
          </Button>
        </div>
        {unused.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Quick add:</span>
            {unused.slice(0, 8).map((s) => (
              <button key={s} type="button" disabled={adding} onClick={() => create(s, '')} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                + {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <Building className="mx-auto mb-2 h-8 w-8 opacity-50" />
          No departments yet. Add the departments your clinic offers — patients pick one when booking, and doctors are assigned to them in the next step.
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((d) => (
            <li key={d.id} className={`rounded-xl border border-border bg-card p-3 ${d.isActive ? '' : 'opacity-60'}`}>
              {editing === d.id ? (
                <div className="space-y-2">
                  <Input value={draft.name} maxLength={120} onChange={(e) => setDraft((x) => ({ ...x, name: e.target.value }))} />
                  <Textarea rows={2} value={draft.description} maxLength={1000} placeholder="Description" onChange={(e) => setDraft((x) => ({ ...x, description: e.target.value }))} />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /> Cancel</Button>
                    <Button size="sm" disabled={busyId === d.id || draft.name.trim().length < 2} onClick={() => save(d.id, { name: draft.name.trim(), description: draft.description.trim() || null })}>
                      {busyId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{d.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{d.doctorCount} doctor{d.doctorCount === 1 ? '' : 's'}</span>
                      {!d.isActive && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600">Hidden from booking</span>}
                    </div>
                    {d.description && <p className="truncate text-xs text-muted-foreground">{d.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch checked={d.isActive} disabled={busyId === d.id} onCheckedChange={(v: boolean) => save(d.id, { isActive: v })} aria-label="Show in booking" />
                    <Button size="icon" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => { setEditing(d.id); setDraft({ name: d.name, description: d.description ?? '' }); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${d.name}`} className="text-destructive hover:text-destructive" onClick={() => setToDelete(d)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmationDialog
        isOpen={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete department?"
        description={toDelete ? `"${toDelete.name}" will be removed and unassigned from ${toDelete.doctorCount} doctor(s). Existing appointments keep their history.` : ''}
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />
    </div>
  );
}
