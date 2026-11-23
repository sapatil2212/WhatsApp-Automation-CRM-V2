'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle, BellRing, CheckCircle2, Clock, Eye, FileText, Info, Loader2, MoreHorizontal, Pencil, Power, RefreshCw,
  RotateCcw, Send, Trash2, X, XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { IntegrationsHeader } from '@/components/integrations/integrations-tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api } from '@/lib/campaigns/api';
import { lintUtilityBody, VARIABLE_SOURCES, type TemplateVariable, type VariableSource } from '@/lib/whatsapp/appointment-template-library';

interface Tpl {
  id: string;
  name: string;
  event: string;
  eventLabel: string;
  category: string;
  language: string;
  bodyText: string;
  footerText: string | null;
  headerType?: string | null;
  variables: TemplateVariable[];
  status: string;
  displayStatus: string;
  issues: string[];
  version: number;
  isEnabled: boolean;
  metaTemplateId: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  updatedAt: string;
  inUse: boolean;
}
interface Data {
  vertical: string;
  verticalLabel: string;
  whatsapp: { connected: boolean; wabaId: string | null };
  stats: { total: number; approved: number; pending: number; rejected: number; draft: number; active: number };
  reminders: Record<string, boolean>;
  reminderOptions: Array<{ key: string; label: string }>;
  items: Tpl[];
}
interface LogRow {
  id: string;
  eventType: string;
  channel: string;
  templateName: string | null;
  status: string;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  appointment: { patientName: string | null; appointmentDate: string; appointmentTime: string } | null;
}

const STATUS: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  Draft: { label: 'Draft', cls: 'bg-muted text-muted-foreground', icon: FileText },
  Ready: { label: 'Ready to submit', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400', icon: Send },
  Pending: { label: 'Pending approval', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', icon: Clock },
  Approved: { label: 'Approved', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  Rejected: { label: 'Rejected', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', icon: XCircle },
  Paused: { label: 'Paused', cls: 'bg-orange-500/10 text-orange-700 dark:text-orange-400', icon: AlertTriangle },
  Disabled: { label: 'Disabled by Meta', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', icon: XCircle },
};
const LOG_STATUS: Record<string, string> = {
  sent: 'Sent',
  failed: 'Failed',
  blocked_no_template: 'Blocked — no approved template',
  skipped_no_consent: 'Skipped — no consent',
  skipped_window: 'Skipped — outside 24h',
  pending: 'Sending…',
};
const SOURCE_LABEL: Record<VariableSource, string> = {
  customer_name: 'Customer name',
  business_name: 'Business name',
  appointment_date: 'Appointment date',
  appointment_time: 'Appointment time',
  service_name: 'Service / doctor',
  appointment_ref: 'Booking ID',
  token_number: 'Clinic queue no.',
  doctor_name: 'Doctor name',
};
const SUBMITTABLE = ['Draft', 'Rejected', 'Paused', 'Disabled'];
const canSubmit = (t: { status: string; issues: string[] }) => SUBMITTABLE.includes(t.status) && t.issues.length === 0;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fill = (body: string, vars: TemplateVariable[]) => body.replace(/\{\{(\d+)\}\}/g, (m, n) => vars.find((v) => v.position === Number(n))?.example || m);

function StatusBadge({ status }: { status: string }) {
  const m = STATUS[status] ?? STATUS.Draft;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>
      <m.icon className="size-3" /> {m.label}
    </span>
  );
}

function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex max-h-[92dvh] w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} flex-col overflow-hidden rounded-t-2xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 sm:rounded-2xl`}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><X className="size-4" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** WhatsApp-style bubble with sample values filled in. */
function Bubble({ body, footer, vars }: { body: string; footer: string | null; vars: TemplateVariable[] }) {
  return (
    <div className="rounded-xl bg-[#e5ddd5] p-4 dark:bg-[#0b141a]">
      <div className="max-w-[320px] rounded-lg rounded-tl-none bg-white p-3 text-[13px] leading-relaxed text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
        <p className="whitespace-pre-wrap">{fill(body, vars)}</p>
        {footer && <p className="mt-1.5 text-[11px] text-[#667781] dark:text-[#8696a0]">{footer}</p>}
        <p className="mt-1 text-right text-[10px] text-[#667781] dark:text-[#8696a0]">10:30 AM</p>
      </div>
    </div>
  );
}

export default function WhatsappTemplatesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Tpl | null>(null);
  const [editing, setEditing] = useState<Tpl | null>(null);
  const [reasonFor, setReasonFor] = useState<Tpl | null>(null);
  const [reminders, setReminders] = useState<Record<string, boolean>>({});
  const [savingReminders, setSavingReminders] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'submit' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Tpl[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, logRes] = await Promise.all([api<Data>('/api/whatsapp/utility-templates'), api<LogRow[]>('/api/whatsapp/utility-templates/logs?limit=20')]);
      setData(res.data);
      setReminders(res.data.reminders);
      setLogs(logRes.data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error((e as Error).message, { duration: 8000 });
    } finally {
      setBusy(null);
    }
  };
  const submit = (t: Tpl) => run(t.id, () => api(`/api/whatsapp/utility-templates/${t.id}/submit`, { method: 'POST' }), 'Submitted to Meta. Approval usually takes a few minutes to a few hours.');
  const sync = () => run('sync', () => api('/api/whatsapp/utility-templates/sync', { method: 'POST' }), 'Statuses updated from Meta.');
  const toggle = (t: Tpl) => run(t.id, () => api(`/api/whatsapp/utility-templates/${t.id}`, { method: 'PATCH', json: { action: 'enable', enabled: !t.isEnabled } }), t.isEnabled ? 'Template disabled.' : 'Template enabled.');
  const reset = (t: Tpl) => run(t.id, () => api(`/api/whatsapp/utility-templates/${t.id}`, { method: 'PATCH', json: { action: 'reset' } }), 'Default wording restored as a new draft.');

  const runBulk = async (action: 'submit' | 'delete', ids: string[]) => {
    if (!ids.length) return;
    setBulkBusy(action);
    try {
      const res = await api<{ results: Array<{ id: string; name: string; ok: boolean; error?: string }>; succeeded: number; failed: number }>('/api/whatsapp/utility-templates/bulk', {
        method: 'POST',
        json: { action, ids },
      });
      const { succeeded, failed, results } = res.data;
      const verb = action === 'submit' ? 'submitted to Meta' : 'deleted';
      if (succeeded) toast.success(`${succeeded} template${succeeded === 1 ? '' : 's'} ${verb}.`);
      if (failed) {
        const first = results.find((x) => !x.ok);
        toast.error(`${failed} failed${first ? ` — ${first.name}: ${first.error}` : ''}`, { duration: 10000 });
      }
      setSelected(new Set());
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkBusy(null);
    }
  };

  const saveReminders = async () => {
    setSavingReminders(true);
    try {
      await api('/api/whatsapp/utility-templates/reminders', { method: 'PUT', json: reminders });
      toast.success('Reminder schedule saved.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingReminders(false);
    }
  };

  const items = useMemo(() => data?.items ?? [], [data]);
  // Items arrive newest version first within each event.
  const latestIds = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of items) if (!seen.has(i.event)) seen.set(i.event, i.id);
    return new Set(seen.values());
  }, [items]);
  const remindersChanged = data && JSON.stringify(reminders) !== JSON.stringify(data.reminders);
  const selectedRows = items.filter((i) => selected.has(i.id));
  const submittable = selectedRows.filter(canSubmit);
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const toggleOne = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  const actions = (t: Tpl) => {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Template actions" disabled={busy === t.id} />}>
          {busy === t.id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setPreview(t)}><Eye className="size-4" /> Preview</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditing(t)}><Pencil className="size-4" /> {t.status === 'Draft' ? 'Edit' : 'Edit (new version)'}</DropdownMenuItem>
          {canSubmit(t) && <DropdownMenuItem onClick={() => submit(t)}><Send className="size-4" /> {t.status === 'Draft' ? 'Submit for approval' : 'Resubmit'}</DropdownMenuItem>}
          {t.rejectionReason && <DropdownMenuItem onClick={() => setReasonFor(t)}><Info className="size-4" /> View rejection reason</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => toggle(t)}><Power className="size-4" /> {t.isEnabled ? 'Disable' : 'Enable'}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => reset(t)}><RotateCcw className="size-4" /> Restore default wording</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete([t])}><Trash2 className="size-4" /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="space-y-4">
      <Suspense fallback={<div className="h-[104px] animate-pulse rounded-xl bg-muted/50" />}>
        <IntegrationsHeader
          actions={
            <Button size="sm" variant="outline" onClick={sync} disabled={busy === 'sync' || !data?.whatsapp.connected} className="gap-1.5">
              <RefreshCw className={`size-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Sync with Meta
            </Button>
          }
        />
      </Suspense>
      <div>
        <h2 className="text-base font-semibold">Appointment message templates</h2>
        <p className="text-xs text-muted-foreground">Meta-approved utility templates for appointment confirmations, reminders and updates{data ? ` · ${data.verticalLabel}` : ''}.</p>
      </div>

      <div className="flex gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm">
        <Info className="mt-0.5 size-5 shrink-0 text-sky-600" />
        <div className="space-y-1">
          <p className="font-medium">Why approval matters</p>
          <p className="text-muted-foreground">
            WhatsApp only lets you send free-form messages within <strong>24 hours</strong> of the customer&apos;s last message. Reminders and updates sent later must use a
            template <strong>approved by Meta</strong>. Submit each template once — when it&apos;s approved we send it automatically whenever the 24-hour window has closed. Until then those messages are held and
            logged below, never sent as plain text.
          </p>
        </div>
      </div>

      {data && !data.whatsapp.connected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <span className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-600" /> Connect your WhatsApp Business account to submit templates.</span>
          <Button size="sm" render={<Link href="/connections" />}>Connect WhatsApp</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Templates', value: data?.stats.total, icon: FileText },
          { label: 'Approved', value: data?.stats.approved, icon: CheckCircle2 },
          { label: 'Pending approval', value: data?.stats.pending, icon: Clock },
          { label: 'Rejected', value: data?.stats.rejected, icon: XCircle },
          { label: 'Draft', value: data?.stats.draft, icon: Pencil },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <s.icon className="size-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{s.value ?? '—'}</p>
          </div>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-xs text-muted-foreground">
            {submittable.length === selected.size ? '' : `· ${submittable.length} can be submitted (approved, pending or incomplete ones are skipped)`}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" disabled={!submittable.length || bulkBusy !== null || !data?.whatsapp.connected} onClick={() => runBulk('submit', submittable.map((t) => t.id))}>
              {bulkBusy === 'submit' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Submit {submittable.length || ''} for approval
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={bulkBusy !== null} onClick={() => setConfirmDelete(selectedRows)}>
              {bulkBusy === 'delete' ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Delete {selected.size}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] table-fixed text-sm">
            <colgroup>
              <col className="w-12" />
              <col className="w-[24%]" />
              <col className="w-[16%]" />
              <col className="w-[9%]" />
              <col className="w-[8%]" />
              <col className="w-[16%]" />
              <col className="w-[18%]" />
              <col className="w-14" />
            </colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">
                  <input type="checkbox" className="size-4 cursor-pointer rx-check align-middle" checked={allSelected} onChange={toggleAll} disabled={!items.length} aria-label="Select all templates" />
                </th>
                <th className="px-3 py-3">Template</th>
                <th className="px-3 py-3">Business event</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Language</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Last update</th>
                <th className="px-3 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-9 animate-pulse rounded-lg bg-muted/70" /></td></tr>)
              ) : (
                items.map((t) => {
                  const older = !latestIds.has(t.id);
                  return (
                    <tr key={t.id} onClick={() => setPreview(t)} className={`cursor-pointer transition-colors ${selected.has(t.id) ? 'bg-primary/5' : 'hover:bg-muted/50'}`}>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="size-4 cursor-pointer rx-check align-middle" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} aria-label={`Select ${t.name}`} />
                      </td>
                      <td className={`px-3 py-3 ${older ? 'opacity-60' : ''}`}>
                        <p className="truncate font-mono text-xs font-medium">{t.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          v{t.version}
                          {t.inUse && <span className="ml-1.5 rounded bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">in use</span>}
                          {!t.isEnabled && <span className="ml-1.5 rounded bg-muted px-1.5 text-[10px]">disabled</span>}
                          {older && <span className="ml-1.5 text-[10px]">older version</span>}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-foreground/80">{t.eventLabel}</td>
                      <td className="px-3 py-3 text-xs">{t.category}</td>
                      <td className="px-3 py-3 font-mono text-xs">{t.language}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={t.displayStatus} />
                        {t.issues.length > 0 && <p className="mt-1 truncate text-[11px] text-amber-600" title={t.issues.join('\n')}>{t.issues[0]}</p>}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {t.approvedAt ? `Approved ${fmt(t.approvedAt)}` : t.submittedAt ? `Submitted ${fmt(t.submittedAt)}` : `Edited ${fmt(t.updatedAt)}`}
                        {t.metaTemplateId && <p className="truncate font-mono text-[10px]">ID {t.metaTemplateId}</p>}
                      </td>
                      <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {canSubmit(t) && latestIds.has(t.id) && data?.whatsapp.connected && (
                            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy === t.id} onClick={() => submit(t)}>
                              {busy === t.id ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />} {t.status === 'Draft' ? 'Submit' : 'Resubmit'}
                            </Button>
                          )}
                          {actions(t)}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <section className="rounded-2xl border border-border/70 bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><BellRing className="size-4 text-primary" /> Reminder schedule</h2>
          <p className="mt-1 text-xs text-muted-foreground">When to remind customers before their appointment (your clinic&apos;s time zone). Reminders follow reschedules automatically and stop when an appointment is cancelled.</p>
          <div className="mt-4 space-y-3">
            {data?.reminderOptions.map((o) => (
              <label key={o.key} className="flex items-center justify-between gap-3 text-sm">
                {o.label}
                <Switch checked={Boolean(reminders[o.key])} onCheckedChange={(v: boolean) => setReminders((r) => ({ ...r, [o.key]: v }))} aria-label={o.label} />
              </label>
            ))}
          </div>
          <Button className="mt-4 w-full" disabled={!remindersChanged || savingReminders} onClick={saveReminders}>
            {savingReminders ? <Loader2 className="size-4 animate-spin" /> : null} Save schedule
          </Button>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card p-5">
          <h2 className="font-semibold">Recent deliveries</h2>
          <p className="mt-1 text-xs text-muted-foreground">Every appointment message attempt, and how it was sent.</p>
          {logs.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">No appointment messages yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/70">
              {logs.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{l.appointment?.patientName || 'Patient'} · <span className="capitalize">{l.eventType}</span></p>
                    <p className="truncate text-xs text-muted-foreground">
                      {fmt(l.createdAt)} · {l.channel === 'template' ? `template ${l.templateName}` : l.channel === 'text' ? 'free-form (within 24h)' : 'not sent'}
                    </p>
                    {l.errorMessage && l.status !== 'sent' && <p className="truncate text-xs text-amber-600" title={l.errorMessage}>{l.errorMessage}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${l.status === 'sent' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : l.status === 'failed' || l.status === 'blocked_no_template' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400' : 'bg-muted text-muted-foreground'}`}>
                    {LOG_STATUS[l.status] ?? l.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {preview && (
        <Modal
          title={`${preview.eventLabel} · v${preview.version}`}
          onClose={() => setPreview(null)}
          wide
          footer={
            <>
              <Button variant="outline" onClick={() => { setEditing(preview); setPreview(null); }} className="gap-1.5"><Pencil className="size-4" /> Edit</Button>
              {['Draft', 'Rejected', 'Paused', 'Disabled'].includes(preview.status) && preview.issues.length === 0 && (
                <Button onClick={() => { void submit(preview); setPreview(null); }} disabled={!data?.whatsapp.connected} className="gap-1.5"><Send className="size-4" /> {preview.status === 'Draft' ? 'Submit for approval' : 'Resubmit'}</Button>
              )}
            </>
          }
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Bubble body={preview.bodyText} footer={preview.footerText} vars={preview.variables} />
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[110px_1fr] gap-y-2">
                <dt className="text-muted-foreground">Meta name</dt><dd className="font-mono text-xs">{preview.name}</dd>
                <dt className="text-muted-foreground">Category</dt><dd>{preview.category}</dd>
                <dt className="text-muted-foreground">Language</dt><dd className="font-mono text-xs">{preview.language}</dd>
                <dt className="text-muted-foreground">Status</dt><dd><StatusBadge status={preview.displayStatus} /></dd>
                <dt className="text-muted-foreground">Meta ID</dt><dd className="font-mono text-xs">{preview.metaTemplateId ?? '—'}</dd>
                <dt className="text-muted-foreground">Submitted</dt><dd>{fmt(preview.submittedAt)}</dd>
                {preview.approvedAt && (<><dt className="text-muted-foreground">Approved</dt><dd>{fmt(preview.approvedAt)}</dd></>)}
                <dt className="text-muted-foreground">Header</dt><dd className="text-muted-foreground">{preview.headerType === 'document' ? 'PDF document (attached when sent)' : 'None'}</dd>
              </dl>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Variables</p>
                <ul className="space-y-1">
                  {preview.variables.map((v) => (
                    <li key={v.position} className="flex justify-between gap-2 text-xs">
                      <span><span className="font-mono">{`{{${v.position}}}`}</span> {v.name}</span>
                      <span className="truncate text-muted-foreground">{v.example}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {preview.rejectionReason && <p className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-400"><strong>Meta:</strong> {preview.rejectionReason}</p>}
              {preview.issues.length > 0 && <ul className="list-disc space-y-1 rounded-lg bg-amber-500/10 p-3 pl-6 text-xs text-amber-700 dark:text-amber-400">{preview.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
            </div>
          </div>
        </Modal>
      )}

      {reasonFor && (
        <Modal title="Why Meta rejected this template" onClose={() => setReasonFor(null)} footer={<Button onClick={() => { setEditing(reasonFor); setReasonFor(null); }} className="gap-1.5"><Pencil className="size-4" /> Edit and resubmit</Button>}>
          <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">{reasonFor.rejectionReason}</p>
          <p className="mt-3 text-xs text-muted-foreground">Common fixes: remove promotional wording, make sure the message is about the customer&apos;s own appointment, and give realistic sample values for every variable.</p>
        </Modal>
      )}

      <ConfirmationDialog
        isOpen={Boolean(confirmDelete)}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={confirmDelete?.length === 1 ? `Delete ${confirmDelete[0].name}?` : `Delete ${confirmDelete?.length ?? 0} templates?`}
        description={(() => {
          const list = confirmDelete ?? [];
          const live = list.filter((t) => t.status !== 'Draft' || t.submittedAt);
          const inUse = list.filter((t) => t.inUse);
          return [
            live.length ? `${live.length} submitted template${live.length === 1 ? '' : 's'} will also be deleted from your WhatsApp account at Meta, and the name can't be reused for about 30 days.` : 'These drafts were never submitted to Meta.',
            inUse.length ? `${inUse.length} ${inUse.length === 1 ? 'is' : 'are'} currently used for automatic messages — those messages will be held outside the 24-hour window until another version is approved.` : '',
            'If no version is left for an event, a fresh draft with the default wording is created.',
          ].filter(Boolean).join(' ');
        })()}
        confirmText="Delete"
        variant="destructive"
        onConfirm={async () => {
          const ids = (confirmDelete ?? []).map((t) => t.id);
          setConfirmDelete(null);
          await runBulk('delete', ids);
        }}
      />

      {editing && <EditModal tpl={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
    </div>
  );
}

function EditModal({ tpl, onClose, onSaved }: { tpl: Tpl; onClose: () => void; onSaved: () => void }) {
  const [body, setBody] = useState(tpl.bodyText);
  const [footer, setFooter] = useState(tpl.footerText ?? '');
  const [language, setLanguage] = useState(tpl.language);
  const [vars, setVars] = useState<TemplateVariable[]>(tpl.variables);
  const [saving, setSaving] = useState(false);

  // Keep the variable list in step with the {{n}} placeholders in the body.
  const count = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  const synced: TemplateVariable[] = Array.from({ length: count }, (_, i) => vars.find((v) => v.position === i + 1) ?? { position: i + 1, name: `Variable ${i + 1}`, source: 'customer_name', fallback: '', example: '' });
  const issues = lintUtilityBody(body, synced).concat(synced.filter((v) => !v.example.trim()).map((v) => `Add a sample value for {{${v.position}}}.`));
  const setVar = (pos: number, patch: Partial<TemplateVariable>) => setVars(synced.map((v) => (v.position === pos ? { ...v, ...patch } : v)));
  const willVersion = tpl.status !== 'Draft' || Boolean(tpl.submittedAt);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/whatsapp/utility-templates/${tpl.id}`, { method: 'PATCH', json: { action: 'update', bodyText: body, footerText: footer || null, language, variables: synced } });
      toast.success(willVersion ? 'Saved as a new version — submit it for approval.' : 'Template saved.');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Edit · ${tpl.eventLabel}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || issues.length > 0} onClick={save} className="gap-1.5">{saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} {willVersion ? 'Save as new version' : 'Save'}</Button>
        </>
      }
    >
      {willVersion && (
        <p className="mb-4 flex gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          This template has already been submitted. Changes create a new version that needs Meta approval; the current approved version keeps being used until then.
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-body">Message</Label>
            <Textarea id="tpl-body" rows={10} value={body} maxLength={1024} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
            <p className="text-right text-[11px] text-muted-foreground">{body.length}/1024 · use {'{{1}}'}, {'{{2}}'}… for values</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <div className="space-y-1.5"><Label htmlFor="tpl-footer">Footer (optional)</Label><Input id="tpl-footer" value={footer} maxLength={60} onChange={(e) => setFooter(e.target.value)} placeholder="e.g. Reply STOP to opt out" /></div>
            <div className="space-y-1.5"><Label htmlFor="tpl-lang">Language</Label><Input id="tpl-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className="font-mono" /></div>
          </div>
          <div className="space-y-2">
            <Label>Variables</Label>
            {synced.map((v) => (
              <div key={v.position} className="grid grid-cols-[44px_1fr_1fr] items-center gap-2">
                <span className="font-mono text-xs">{`{{${v.position}}}`}</span>
                <select className="h-9 rounded-lg border border-input bg-background px-2 text-sm" value={v.source} onChange={(e) => setVar(v.position, { source: e.target.value as VariableSource, name: SOURCE_LABEL[e.target.value as VariableSource] })}>
                  {VARIABLE_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
                </select>
                <Input value={v.example} placeholder="Sample value" onChange={(e) => setVar(v.position, { example: e.target.value })} />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Label>Preview</Label>
          <Bubble body={body} footer={footer || null} vars={synced} />
          {issues.length > 0 ? (
            <ul className="list-disc space-y-1 rounded-lg bg-amber-500/10 p-3 pl-6 text-xs text-amber-700 dark:text-amber-400">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3.5" /> Looks good for a Utility template.</p>
          )}
          <p className="text-[11px] text-muted-foreground">Keep it about this customer&apos;s own appointment. Offers, discounts or promotions make Meta reject or re-categorise the template as Marketing.</p>
        </div>
      </div>
    </Modal>
  );
}
