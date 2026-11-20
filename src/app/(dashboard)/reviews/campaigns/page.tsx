'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Pause, Play, Plus, QrCode, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BusinessPicker, Card, Empty, ErrorPanel, Field, fmtDate, Modal, PageHead, Pill, Skeleton, SmallInput, useApi, type ReviewCampaign } from '@/components/reviews/shared';
import { api } from '@/lib/campaigns/api';

const SUGGESTIONS = ['Reception', 'Billing Counter', 'Customer Thank You', 'WhatsApp Follow-up', 'Website', 'Printed Invoice'];

function CampaignForm({ onClose, onSaved, defaultBusiness }: { onClose: () => void; onSaved: () => void; defaultBusiness: string }) {
  const [businessId, setBusinessId] = useState(defaultBusiness);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!businessId) return setError('Choose a business.');
    if (name.trim().length < 2) return setError('Give the campaign a name.');
    setBusy(true);
    setError(null);
    try {
      await api('/api/reviews/campaigns', { method: 'POST', json: { businessId, name, description: description || null } });
      toast.success('Campaign created.');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="New review campaign" subtitle="A campaign groups QR codes so you can compare where reviews come from." onClose={onClose} busy={busy}>
      <div className="space-y-3">
        <Field label="Business *"><BusinessPicker value={businessId} onChange={setBusinessId} allowAll={false} className="w-full" /></Field>
        <Field label="Campaign name *"><SmallInput autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="e.g. Billing Counter" /></Field>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => setName(s)} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">{s}</button>)}
        </div>
        <Field label="Description"><SmallInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></Field>
      </div>
      {error && <p className="mt-3 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" role="alert">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={save} disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" />} Create campaign</Button>
      </div>
    </Modal>
  );
}

export default function CampaignsPage() {
  const [businessId, setBusinessId] = useState('');
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<ReviewCampaign[]>(`/api/reviews/campaigns${businessId ? `?businessId=${businessId}` : ''}`);

  const act = async (c: ReviewCampaign, kind: 'toggle' | 'delete') => {
    if (kind === 'delete' && !window.confirm(`Delete "${c.name}"? Its QR codes stop working.`)) return;
    setBusyId(c.id);
    try {
      if (kind === 'delete') await api(`/api/reviews/campaigns/${c.id}`, { method: 'DELETE' });
      else await api(`/api/reviews/campaigns/${c.id}`, { method: 'PATCH', json: { status: c.status === 'active' ? 'paused' : 'active' } });
      toast.success(kind === 'delete' ? 'Campaign deleted.' : c.status === 'active' ? 'Campaign paused. Its QR codes now show "not found".' : 'Campaign resumed.');
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHead title="Review campaigns" subtitle="Track reviews by placement: reception, billing counter, invoices, WhatsApp and more." actions={<Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen(true)}><Plus className="size-3.5" /> New campaign</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2.5"><BusinessPicker value={businessId} onChange={setBusinessId} /></div>
        {error ? <div className="p-3"><ErrorPanel message={error} onRetry={reload} /></div> : loading && !data ? <Skeleton /> : !data?.length ? (
          <Empty title="No campaigns yet" body="Create one per placement, then generate a QR code for it." action={<Button size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>New campaign</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-2.5 pl-4 pr-3">Campaign</th><th className="px-3 py-2.5">Business</th><th className="px-3 py-2.5">QR codes</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Created</th><th className="py-2.5 pl-3 pr-4 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/40">
                    <td className="py-2.5 pl-4 pr-3"><p className="text-[13px] font-medium">{c.name}</p>{c.description && <p className="truncate text-[11px] text-muted-foreground">{c.description}</p>}</td>
                    <td className="px-3 py-2.5">{c.business.name}</td>
                    <td className="px-3 py-2.5 tabular-nums">{c.qrCount}</td>
                    <td className="px-3 py-2.5">{c.status === 'active' ? <Pill tone="green">Active</Pill> : <Pill tone="amber">Paused</Pill>}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(c.createdAt)}</td>
                    <td className="py-2.5 pl-3 pr-4">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" render={<Link href={`/reviews/qr-codes?businessId=${c.businessId}&campaignId=${c.id}`} />}><QrCode className="size-3.5" /> QR</Button>
                        <Button size="icon-sm" variant="ghost" className="size-7" aria-label={c.status === 'active' ? 'Pause' : 'Resume'} disabled={busyId === c.id} onClick={() => act(c, 'toggle')}>{c.status === 'active' ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</Button>
                        <Button size="icon-sm" variant="ghost" className="size-7 text-destructive" aria-label="Delete" disabled={busyId === c.id} onClick={() => act(c, 'delete')}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <CampaignForm onClose={() => setOpen(false)} onSaved={reload} defaultBusiness={businessId} />}
    </div>
  );
}