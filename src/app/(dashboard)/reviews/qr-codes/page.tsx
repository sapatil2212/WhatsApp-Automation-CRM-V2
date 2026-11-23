'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, Download, Loader2, Megaphone, Plus, Printer, Share2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { BusinessPicker, Card, copyText, Empty, ErrorPanel, Field, Modal, PageHead, Pill, selectCls, Skeleton, SmallInput, useApi, type ReviewCampaign, type ReviewQr } from '@/components/reviews/shared';
import { api } from '@/lib/campaigns/api';
import { QR_PLACEMENTS } from '@/lib/reviews/constants';

function QrForm({ onClose, onSaved, defaults }: { onClose: () => void; onSaved: () => void; defaults: { businessId: string; campaignId: string } }) {
  const [businessId, setBusinessId] = useState(defaults.businessId);
  const [campaignId, setCampaignId] = useState(defaults.campaignId);
  const [label, setLabel] = useState('');
  const [placement, setPlacement] = useState('reception');
  const [fgColor, setFg] = useState('#0f172a');
  const [bgColor, setBg] = useState('#ffffff');
  const [includeLogo, setLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campaigns = useApi<ReviewCampaign[]>(businessId ? `/api/reviews/campaigns?businessId=${businessId}` : null);

  const save = async () => {
    if (!businessId) return setError('Choose a business.');
    if (label.trim().length < 2) return setError('Give the QR code a name.');
    setBusy(true);
    setError(null);
    try {
      await api('/api/reviews/qr/generate', { method: 'POST', json: { businessId, campaignId: campaignId || null, label, placement, fgColor, bgColor, includeLogo } });
      toast.success('QR code created.');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="New QR code" subtitle="Each QR code has its own secure link, so scans are tracked per placement." onClose={onClose} busy={busy}>
      <div className="space-y-3">
        <Field label="Business *"><BusinessPicker value={businessId} onChange={(id) => { setBusinessId(id); setCampaignId(''); }} allowAll={false} className="w-full" /></Field>
        <Field label="Campaign (optional)">
          <select className={selectCls} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={!businessId}>
            <option value="">No campaign</option>
            {(campaigns.data ?? []).filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name *"><SmallInput autoFocus value={label} onChange={(e) => setLabel(e.target.value)} maxLength={160} placeholder="Front desk standee" /></Field>
          <Field label="Placement">
            <select className={selectCls} value={placement} onChange={(e) => setPlacement(e.target.value)}>
              {QR_PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="QR color"><input type="color" value={fgColor} onChange={(e) => setFg(e.target.value)} className="h-8 w-full cursor-pointer rounded-md border border-input bg-background" /></Field>
          <Field label="Background"><input type="color" value={bgColor} onChange={(e) => setBg(e.target.value)} className="h-8 w-full cursor-pointer rounded-md border border-input bg-background" /></Field>
        </div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={includeLogo} onChange={(e) => setLogo(e.target.checked)} className="size-4 rx-check" /> Put the business logo in the centre (SVG and poster)</label>
        <p className="text-[10px] text-muted-foreground">Keep strong contrast between the two colors so every phone can scan it.</p>
      </div>
      {error && <p className="mt-3 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" role="alert">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" className="gap-1.5" onClick={save} disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" />} Create QR code</Button>
      </div>
    </Modal>
  );
}

function printPoster(q: ReviewQr) {
  const w = window.open('', '_blank', 'width=720,height=960');
  if (!w) return toast.error('Allow pop-ups to print the poster.');
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
  w.document.write(`<!doctype html><html><head><title>${esc(q.label)}</title><style>
    body{font-family:system-ui,sans-serif;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#0f172a}
    .p{width:520px;text-align:center;border:2px solid #e2e8f0;border-radius:24px;padding:40px}
    h1{font-size:30px;margin:0 0 6px}h2{font-size:18px;font-weight:500;margin:0 0 24px;color:#475569}
    img{width:340px;height:340px}p{font-size:14px;color:#475569;margin:20px 0 0}.u{font-size:11px;word-break:break-all;color:#94a3b8;margin-top:12px}
    @media print{.p{border:none}}</style></head><body><div class="p">
    <h1>${esc(q.business.name)}</h1><h2>Enjoyed your visit? Tell us honestly.</h2>
    <img src="/api/reviews/qr/${q.id}/image?format=svg" alt="QR code" onload="setTimeout(()=>print(),300)"/>
    <p>Scan with your phone camera to share your experience.</p><div class="u">${esc(q.url)}</div></div></body></html>`);
  w.document.close();
}

function QrInner() {
  const params = useSearchParams();
  const [businessId, setBusinessId] = useState(params.get('businessId') ?? '');
  const [open, setOpen] = useState(Boolean(params.get('campaignId')));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ReviewQr | null>(null);
  const { data, error, loading, reload } = useApi<ReviewQr[]>(`/api/reviews/qr${businessId ? `?businessId=${businessId}` : ''}`);

  const remove = async (q: ReviewQr) => {
    setBusyId(q.id);
    try {
      await api(`/api/reviews/qr/${q.id}`, { method: 'DELETE' });
      toast.success('QR code deleted.');
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const share = (q: ReviewQr) => {
    const text = `We'd love to hear about your visit to ${q.business.name}. Please share your honest feedback: ${q.url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <div className="space-y-4">
      <PageHead title="QR codes" subtitle="Each QR code has its own review link. Print it, share it on WhatsApp or add it to invoices." actions={<><Button size="sm" variant="outline" className="gap-1.5" render={<Link href="/reviews/campaigns" />}><Megaphone className="size-3.5" /> Campaigns</Button><Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}><Plus className="size-3.5" /> New QR code</Button></>} />
      <div className="flex flex-wrap items-center gap-2"><BusinessPicker value={businessId} onChange={setBusinessId} /></div>
      {error ? <ErrorPanel message={error} onRetry={reload} /> : loading && !data ? <Card><Skeleton /></Card> : !data?.length ? (
        <Card><Empty title="No QR codes yet" body="Generate one for each place customers see you: the front desk, billing counter, invoice or your website." action={<Button size="sm" onClick={() => setOpen(true)}>New QR code</Button>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((q) => (
            <Card key={q.id} className="flex gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/reviews/qr/${q.id}/image?format=svg`} alt={`QR code for ${q.label}`} className="size-24 shrink-0 rounded-md border bg-white p-1" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{q.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">{q.business.name}{q.campaign ? ` · ${q.campaign.name}` : ''}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {q.placement && <Pill>{QR_PLACEMENTS.find((p) => p.value === q.placement)?.label ?? q.placement}</Pill>}
                  <Pill tone="sky">{q.scans} scans</Pill>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="icon-sm" variant="outline" className="size-7" title="Copy link" aria-label="Copy link" onClick={async () => (await copyText(q.url)) ? toast.success('Link copied.') : toast.error(q.url)}><Copy className="size-3.5" /></Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" render={<a href={`/api/reviews/qr/${q.id}/image?format=png&download=1`} />}><Download className="size-3" /> PNG</Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" render={<a href={`/api/reviews/qr/${q.id}/image?format=svg&download=1`} />}><Download className="size-3" /> SVG</Button>
                  <Button size="icon-sm" variant="outline" className="size-7" title="Share on WhatsApp" aria-label="Share on WhatsApp" onClick={() => share(q)}><Share2 className="size-3.5" /></Button>
                  <Button size="icon-sm" variant="outline" className="size-7" title="Print poster" aria-label="Print poster" onClick={() => printPoster(q)}><Printer className="size-3.5" /></Button>
                  <Button size="icon-sm" variant="ghost" className="size-7 text-destructive" title="Delete" aria-label="Delete" disabled={busyId === q.id} onClick={() => setToDelete(q)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <ConfirmationDialog
        isOpen={!!toDelete}
        onOpenChange={(o) => { if (!o) setToDelete(null); }}
        title="Delete this QR code?"
        description="Its review link stops working straight away."
        details={toDelete ? <span><span className="font-medium">{toDelete.label}</span> · {toDelete.business.name}</span> : undefined}
        notes={['Printed copies of this QR code will show "not found".']}
        confirmText="Delete QR code"
        variant="destructive"
        onConfirm={async () => { const q = toDelete; setToDelete(null); if (q) await remove(q); }}
      />
      {open && <QrForm onClose={() => setOpen(false)} onSaved={reload} defaults={{ businessId, campaignId: params.get('campaignId') ?? '' }} />}
    </div>
  );
}

export default function QrCodesPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <QrInner />
    </Suspense>
  );
}