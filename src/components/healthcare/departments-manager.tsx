'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, type Department } from './api';

const SUGGESTIONS = ['General Medicine', 'Pediatrics', 'Gynecology', 'Orthopedics', 'Dermatology', 'Cardiology', 'ENT', 'Dental', 'Ophthalmology', 'Physiotherapy'];
const fieldCls = 'h-8 text-[13px] md:text-[13px]';
const labelCls = 'text-[11px] font-medium text-muted-foreground';

type Draft = { id: string | null; name: string; description: string };

/** Clinic setup → Departments: add, edit, show/hide and delete departments. */
export function DepartmentsManager({ onChange }: { onChange?: (list: Department[]) => void }) {
  const [list, setList] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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

  const duplicate = (name: string, exceptId: string | null) => list.some((x) => x.id !== exceptId && x.name.toLowerCase() === name.toLowerCase());

  const quickAdd = async (n: string) => {
    if (duplicate(n, null)) return;
    setBusyId(`new:${n}`);
    try {
      await api('/api/healthcare/departments', { method: 'POST', json: { name: n, description: null } });
      toast.success(`Department "${n}" added.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (name.length < 2) return setFormError('Enter a department name (at least 2 characters).');
    if (duplicate(name, draft.id)) return setFormError(`"${name}" already exists.`);
    setSaving(true);
    setFormError(null);
    try {
      const json = { name, description: draft.description.trim() || null };
      if (draft.id) await api(`/api/healthcare/departments/${draft.id}`, { method: 'PATCH', json });
      else await api('/api/healthcare/departments', { method: 'POST', json });
      toast.success(draft.id ? 'Department updated.' : `Department "${name}" added.`);
      setDraft(null);
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (d: Department, isActive: boolean) => {
    setBusyId(d.id);
    try {
      await api(`/api/healthcare/departments/${d.id}`, { method: 'PATCH', json: { isActive } });
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

  const unused = SUGGESTIONS.filter((s) => !duplicate(s, null));
  const empty = list.filter((d) => d.isActive && d.doctorCount === 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">{list.length} department{list.length === 1 ? '' : 's'} · patients choose one when booking.</p>
        <Button size="sm" className="gap-1.5" onClick={() => { setFormError(null); setDraft({ id: null, name: '', description: '' }); }}>
          <Plus className="size-3.5" /> Add department
        </Button>
      </div>

      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11px] text-muted-foreground">Quick add:</span>
          {unused.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              disabled={!!busyId}
              onClick={() => quickAdd(s)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            >
              {busyId === `new:${s}` ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} {s}
            </button>
          ))}
        </div>
      )}

      {empty.length > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
          {empty.map((d) => d.name).join(', ')} {empty.length === 1 ? 'has' : 'have'} no doctors yet, so {empty.length === 1 ? "it isn't" : "they aren't"} shown on the booking page. Assign doctors in the Doctors step.
        </p>
      )}

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />)}</div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Building className="mx-auto mb-2 size-7 text-muted-foreground/50" />
          <p className="text-[13px] font-medium">No departments yet</p>
          <p className="mx-auto mt-0.5 max-w-sm text-xs text-muted-foreground">Add the departments your clinic offers. Patients pick one when booking, and doctors are assigned to them in the next step.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70">
          <table className="w-full text-[13px]">
            <thead className="border-b border-border bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-2 pl-4 pr-3">Department</th><th className="hidden px-3 py-2 sm:table-cell">Doctors</th><th className="px-3 py-2">On booking</th><th className="w-20 py-2 pl-3 pr-4 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {list.map((d) => (
                <tr key={d.id} className={d.isActive ? 'hover:bg-muted/30' : 'opacity-60'}>
                  <td className="max-w-0 py-2 pl-4 pr-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Building className="size-3.5" /></span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.name}</p>
                        {d.description && <p className="truncate text-[11px] text-muted-foreground">{d.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <span className={d.doctorCount ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}>{d.doctorCount} doctor{d.doctorCount === 1 ? '' : 's'}</span>
                  </td>
                  <td className="px-3 py-2"><Switch checked={d.isActive} disabled={busyId === d.id} onCheckedChange={(v: boolean) => toggle(d, v)} aria-label={`Show ${d.name} on the booking page`} /></td>
                  <td className="py-2 pl-3 pr-4">
                    <div className="flex justify-end gap-0.5">
                      <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-foreground" title="Edit" aria-label={`Edit ${d.name}`} onClick={() => { setFormError(null); setDraft({ id: d.id, name: d.name, description: d.description ?? '' }); }}><Pencil className="size-3.5" /></Button>
                      <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" title="Delete" aria-label={`Delete ${d.name}`} onClick={() => setToDelete(d)}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o && !saving) setDraft(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit department' : 'Add department'}</DialogTitle>
            <DialogDescription>Shown to patients when they choose a department on the booking page.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className={labelCls}>Name <span className="text-destructive">*</span></span>
                <Input autoFocus value={draft.name} maxLength={120} placeholder="e.g. Pediatrics" className={fieldCls} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void saveDraft(); }} />
              </label>
              <label className="block space-y-1">
                <span className={labelCls}>Description <span className="font-normal">(optional)</span></span>
                <Textarea rows={2} value={draft.description} maxLength={1000} placeholder="e.g. Care for children from newborn to 16 years" className="min-h-0 text-[13px] md:text-[13px]" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
              {formError && <p role="alert" className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{formError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
            <Button size="sm" className="gap-1.5" onClick={saveDraft} disabled={saving}>{saving && <Loader2 className="size-3.5 animate-spin" />} {draft?.id ? 'Save changes' : 'Add department'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete department?"
        description="It is removed from the booking page and unassigned from its doctors."
        details={toDelete ? <span><span className="font-medium">{toDelete.name}</span> · {toDelete.doctorCount} doctor{toDelete.doctorCount === 1 ? '' : 's'}</span> : undefined}
        notes={['Existing appointments keep their history.']}
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />
    </div>
  );
}
