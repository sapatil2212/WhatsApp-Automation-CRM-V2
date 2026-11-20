'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Copy, ExternalLink, HelpCircle, Loader2, Pencil, Plus, Power, Search, Trash2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, copyText, Empty, ErrorPanel, Field, Modal, PageHead, Pill, selectCls, Skeleton, SmallInput, useApi, type ReviewBusiness } from '@/components/reviews/shared';
import { api } from '@/lib/campaigns/api';
import { REVIEW_LANGUAGES } from '@/lib/reviews/constants';
import { GOOGLE_LINK_STEPS, validateGoogleReviewUrl } from '@/lib/reviews/google-url';

type Draft = Omit<ReviewBusiness, 'id' | 'publicToken' | 'createdAt' | 'qrCount' | 'campaignCount'> & { servicesText: string };

const blank: Draft = { name: '', category: '', description: '', address: '', googleReviewUrl: '', website: '', phone: '', logoUrl: null, services: [], servicesText: '', defaultLanguage: 'en', status: 'active' };

function BusinessForm({ initial, onClose, onSaved }: { initial: ReviewBusiness | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(() => (initial ? { ...initial, servicesText: initial.services.join(', ') } : blank));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const url = useMemo(() => (d.googleReviewUrl ? validateGoogleReviewUrl(d.googleReviewUrl) : null), [d.googleReviewUrl]);

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error('Use a PNG, JPEG or WebP image.');
    if (file.size > 300_000) return toast.error('Logo must be under 300 KB.');
    const r = new FileReader();
    r.onload = () => set('logoUrl', String(r.result));
    r.readAsDataURL(file);
  };

  const save = async () => {
    setError(null);
    if (d.name.trim().length < 2) return setError('Business name is required.');
    if (url && !url.valid) return setError(url.reason ?? 'The Google review link is not valid.');
    setBusy(true);
    const body = {
      name: d.name,
      category: d.category,
      description: d.description,
      address: d.address,
      googleReviewUrl: d.googleReviewUrl,
      website: d.website,
      phone: d.phone,
      logoUrl: d.logoUrl,
      services: d.servicesText.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30),
      defaultLanguage: d.defaultLanguage,
      status: d.status,
    };
    try {
      await api(initial ? `/api/reviews/businesses/${initial.id}` : '/api/reviews/businesses', { method: initial ? 'PATCH' : 'POST', json: body });
      toast.success(initial ? 'Business updated.' : 'Business added.');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? 'Edit business' : 'Add business'} subtitle="Each business has its own review link, QR codes, campaigns and analytics." onClose={onClose} busy={busy} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name *"><SmallInput autoFocus value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={160} /></Field>
        <Field label="Category"><SmallInput value={d.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Dental clinic" maxLength={120} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} maxLength={2000} className="min-h-0 py-1.5 text-xs md:text-xs" /></Field>
        <Field label="Address" className="sm:col-span-2"><SmallInput value={d.address ?? ''} onChange={(e) => set('address', e.target.value)} maxLength={300} /></Field>

        <div className="sm:col-span-2">
          <Field
            label="Google review link"
            hint={
              <span className="flex flex-wrap items-center gap-2">
                {url ? url.valid ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-3" /> Looks like a valid Google review link</span> : <span className="flex items-center gap-1 text-destructive"><XCircle className="size-3" /> {url.reason}</span> : 'Customers are sent here to post their review.'}
                <button type="button" className="flex items-center gap-1 text-primary hover:underline" onClick={() => setGuide((g) => !g)}><HelpCircle className="size-3" /> How do I find it?</button>
              </span>
            }
          >
            <SmallInput value={d.googleReviewUrl ?? ''} onChange={(e) => set('googleReviewUrl', e.target.value)} placeholder="https://g.page/r/…/review" />
          </Field>
          {guide && (
            <ol className="mt-2 list-decimal space-y-1 rounded-lg bg-muted/50 py-2.5 pl-8 pr-3 text-[11px]">
              {GOOGLE_LINK_STEPS.map((s) => <li key={s}>{s}</li>)}
            </ol>
          )}
        </div>

        <Field label="Website"><SmallInput value={d.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="https://…" maxLength={300} /></Field>
        <Field label="Phone"><SmallInput value={d.phone ?? ''} onChange={(e) => set('phone', e.target.value)} maxLength={40} /></Field>
        <Field label="Services" hint="Comma separated. Helps the AI understand the context; it never claims a service the customer did not mention." className="sm:col-span-2">
          <SmallInput value={d.servicesText} onChange={(e) => set('servicesText', e.target.value)} placeholder="Cleaning, Braces, Root canal" />
        </Field>
        <Field label="Default review language">
          <select className={selectCls} value={d.defaultLanguage} onChange={(e) => set('defaultLanguage', e.target.value)}>
            {REVIEW_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={selectCls} value={d.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
            <option value="active">Active</option>
            <option value="inactive">Inactive (review page off)</option>
          </select>
        </Field>
        <Field label="Logo (PNG/JPEG/WebP, max 300 KB)" className="sm:col-span-2">
          <div className="flex items-center gap-3">
            {d.logoUrl ? <img src={d.logoUrl} alt="" className="size-10 rounded-md border object-contain" /> : <span className="grid size-10 place-items-center rounded-md border text-[10px] text-muted-foreground">None</span>}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="text-xs" onChange={(e) => onLogo(e.target.files?.[0])} />
            {d.logoUrl && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => set('logoUrl', null)}>Remove</Button>}
          </div>
        </Field>
      </div>
      {error && <p className="mt-3 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" role="alert">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={save} disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" />} {initial ? 'Save changes' : 'Add business'}</Button>
      </div>
    </Modal>
  );
}

function BusinessesInner() {
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<ReviewBusiness | 'new' | null>(params.get('new') ? 'new' : null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const q = new URLSearchParams({ ...(debounced ? { search: debounced } : {}), ...(status ? { status } : {}) });
  const { data, error, loading, reload } = useApi<ReviewBusiness[]>(`/api/reviews/businesses?${q}`);

  const toggle = async (b: ReviewBusiness) => {
    setBusyId(b.id);
    try {
      await api(`/api/reviews/businesses/${b.id}`, { method: 'PATCH', json: { status: b.status === 'active' ? 'inactive' : 'active' } });
      toast.success(b.status === 'active' ? 'Business deactivated. Its review page is now off.' : 'Business activated.');
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (b: ReviewBusiness) => {
    if (!window.confirm(`Delete "${b.name}"? Its QR codes and review links stop working. Analytics history is kept.`)) return;
    setBusyId(b.id);
    try {
      await api(`/api/reviews/businesses/${b.id}`, { method: 'DELETE' });
      toast.success('Business deleted.');
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const copyLink = async (b: ReviewBusiness) => {
    try {
      const res = await api<{ url: string }>(`/api/reviews/businesses/${b.id}/link`);
      if (await copyText(res.data.url)) toast.success('Review link copied.');
      else toast.error(`Could not copy. Link: ${res.data.url}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <PageHead title="Businesses" subtitle="Register every business or branch you collect reviews for." actions={<Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setEditing('new')}><Plus className="size-3.5" /> Add business</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2.5">
          <div className="relative w-[220px]">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <SmallInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or category…" className="pl-7" aria-label="Search" />
          </div>
          <select aria-label="Status" className={`${selectCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {error ? <div className="p-3"><ErrorPanel message={error} onRetry={reload} /></div> : loading && !data ? <Skeleton /> : !data?.length ? (
          <Empty title={debounced || status ? 'No businesses match these filters' : 'No businesses yet'} body="Add a business with its Google review link to start collecting reviews." action={<Button size="sm" className="h-8 text-xs" onClick={() => setEditing('new')}>Add business</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-2.5 pl-4 pr-3">Business</th><th className="px-3 py-2.5">Google link</th><th className="px-3 py-2.5">Language</th><th className="px-3 py-2.5">QR / Campaigns</th><th className="px-3 py-2.5">Status</th><th className="py-2.5 pl-3 pr-4 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.map((b) => (
                  <tr key={b.id} className="align-middle hover:bg-muted/40">
                    <td className="py-2.5 pl-4 pr-3">
                      <div className="flex items-center gap-2.5">
                        {b.logoUrl ? <img src={b.logoUrl} alt="" className="size-8 shrink-0 rounded-md border object-contain" /> : <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">{b.name.slice(0, 2).toUpperCase()}</span>}
                        <div className="min-w-0"><p className="truncate text-[13px] font-medium">{b.name}</p><p className="truncate text-[11px] text-muted-foreground">{b.category || '—'}</p></div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{b.googleReviewUrl ? <a href={b.googleReviewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open <ExternalLink className="size-3" /></a> : <Pill tone="amber">Not set</Pill>}</td>
                    <td className="px-3 py-2.5">{REVIEW_LANGUAGES.find((l) => l.code === b.defaultLanguage)?.label ?? b.defaultLanguage}</td>
                    <td className="px-3 py-2.5 tabular-nums">{b.qrCount ?? 0} / {b.campaignCount ?? 0}</td>
                    <td className="px-3 py-2.5">{b.status === 'active' ? <Pill tone="green">Active</Pill> : <Pill>Inactive</Pill>}</td>
                    <td className="py-2.5 pl-3 pr-4">
                      <div className="flex justify-end gap-1">
                        <Button size="icon-sm" variant="ghost" className="size-7" aria-label="Copy review link" title="Copy review link" onClick={() => copyLink(b)}><Copy className="size-3.5" /></Button>
                        <Button size="icon-sm" variant="ghost" className="size-7" aria-label="Edit" title="Edit" onClick={() => setEditing(b)}><Pencil className="size-3.5" /></Button>
                        <Button size="icon-sm" variant="ghost" className="size-7" aria-label={b.status === 'active' ? 'Deactivate' : 'Activate'} title={b.status === 'active' ? 'Deactivate' : 'Activate'} disabled={busyId === b.id} onClick={() => toggle(b)}><Power className="size-3.5" /></Button>
                        <Button size="icon-sm" variant="ghost" className="size-7 text-destructive" aria-label="Delete" title="Delete" disabled={busyId === b.id} onClick={() => remove(b)}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <BusinessForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}

export default function BusinessesPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <BusinessesInner />
    </Suspense>
  );
}