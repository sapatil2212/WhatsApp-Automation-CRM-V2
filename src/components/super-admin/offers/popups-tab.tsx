"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Eye, ImagePlus, Loader2, LogOut, MousePointerClick, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { OfferModal } from "@/components/marketing/offer-popups";
import { api } from "@/lib/campaigns/api";
import { AdminModal, Field, fmtDate, fromLocalInput, inputCls, Pill, selectCls, toLocalInput, useAdminApi } from "./shared";
import type { PromoRow } from "./promo-tab";

export interface OfferRow {
  id: string;
  kind: "welcome" | "exit_intent";
  title: string;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  promoCodeId: string | null;
  promoCode: { id: string; code: string; isActive: boolean } | null;
  delaySeconds: number;
  frequency: "session" | "day" | "week" | "always";
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  views: number;
  clicks: number;
  dismissals: number;
  updatedAt: string;
}

const KIND = {
  welcome: { label: "Welcome pop-up", hint: "Opens a few seconds after a visitor lands on the home page.", icon: Sparkles },
  exit_intent: { label: "Exit pop-up", hint: "Opens when a visitor is about to leave the home page.", icon: LogOut },
} as const;
const FREQ = { session: "Once per visit", day: "Once a day", week: "Once a week", always: "Every visit" } as const;

function liveState(o: OfferRow) {
  const now = Date.now();
  if (!o.isActive) return { tone: "muted" as const, text: "Off" };
  if (o.startsAt && Date.parse(o.startsAt) > now) return { tone: "blue" as const, text: `Starts ${fmtDate(o.startsAt)}` };
  if (o.endsAt && Date.parse(o.endsAt) < now) return { tone: "amber" as const, text: "Ended" };
  return { tone: "green" as const, text: "Live" };
}

export function PopupsTab() {
  const { data, error, loading, reload } = useAdminApi<OfferRow[]>("/api/super-admin/offers");
  const promos = useAdminApi<PromoRow[]>("/api/super-admin/promo-codes");
  const [editing, setEditing] = useState<OfferRow | { kind: OfferRow["kind"] } | null>(null);
  const [deleting, setDeleting] = useState<OfferRow | null>(null);
  const [preview, setPreview] = useState<OfferRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (o: OfferRow) => {
    setBusy(o.id);
    try {
      await api(`/api/super-admin/offers/${o.id}`, { method: "PATCH", json: { isActive: !o.isActive } });
      toast.success(o.isActive ? "Pop-up turned off." : "Pop-up is live. Any other pop-up of the same type was turned off.");
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}
      {(["welcome", "exit_intent"] as const).map((kind) => {
        const K = KIND[kind];
        const rows = (data ?? []).filter((o) => o.kind === kind);
        return (
          <section key={kind} className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><K.icon className="size-4" /></span>
                <div>
                  <h2 className="text-sm font-semibold">{K.label}</h2>
                  <p className="text-[11px] text-muted-foreground">{K.hint} Only one can be live at a time.</p>
                </div>
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => setEditing({ kind })}><Plus className="size-3.5" /> New</Button>
            </div>
            {loading && !data ? (
              <div className="p-4"><div className="h-16 animate-pulse rounded-lg bg-muted/70" /></div>
            ) : rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">No {K.label.toLowerCase()} yet.</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {rows.map((o) => {
                  const st = liveState(o);
                  const ctr = o.views ? Math.round((o.clicks / o.views) * 100) : 0;
                  return (
                    <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      {o.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.imageUrl} alt="" className="size-12 shrink-0 rounded-lg border border-border object-cover" />
                      ) : (
                        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><ImagePlus className="size-4" /></span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-[13px] font-medium"><span className="truncate">{o.title || (o.imageUrl ? "Image only" : "Untitled pop-up")}</span><Pill tone={st.tone}>{st.text}</Pill></p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {FREQ[o.frequency]}{kind === "welcome" ? ` · after ${o.delaySeconds}s` : ""}{o.promoCode ? ` · code ${o.promoCode.code}` : ""}{o.endsAt ? ` · until ${fmtDate(o.endsAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                        <span className="flex items-center gap-1" title="Shown"><Eye className="size-3.5" /> {o.views}</span>
                        <span className="flex items-center gap-1" title="Clicked"><MousePointerClick className="size-3.5" /> {o.clicks} ({ctr}%)</span>
                        <span className="flex items-center gap-1" title="Closed"><X className="size-3.5" /> {o.dismissals}</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <label className="mr-1 flex cursor-pointer items-center gap-1.5 text-[12px]"><input type="checkbox" className="size-4 rx-check" checked={o.isActive} disabled={busy === o.id} onChange={() => void toggle(o)} /> Live</label>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Preview" aria-label="Preview" onClick={() => setPreview(o)}><Eye className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit" aria-label="Edit" onClick={() => setEditing(o)}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label="Delete" onClick={() => setDeleting(o)}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {editing && <OfferForm initial={"id" in editing ? editing : null} kind={editing.kind} promos={promos.data ?? []} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
      {preview && (
        <div className="fixed inset-0 z-[310]">
          <OfferModal preview offer={{ ...preview, promoCode: preview.promoCode?.code ?? null }} onClose={() => setPreview(null)} />
        </div>
      )}
      <ConfirmationDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this pop-up?"
        description="It is removed from the home page along with its view and click counts."
        details={deleting ? <span className="font-medium">{deleting.title || "Image only"}</span> : null}
        confirmText="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api(`/api/super-admin/offers/${deleting.id}`, { method: "DELETE" });
            toast.success("Pop-up deleted.");
            setDeleting(null);
            await reload();
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }}
      />
    </div>
  );
}

function OfferForm({ initial, kind, promos, onClose, onSaved }: { initial: OfferRow | null; kind: OfferRow["kind"]; promos: PromoRow[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({
    title: initial?.title ?? (kind === "welcome" ? "Get 20% off your first month" : "Leaving already? Here's 20% off"),
    body: initial?.body ?? "",
    imageUrl: initial?.imageUrl ?? null as string | null,
    ctaLabel: initial?.ctaLabel ?? "Claim offer",
    ctaUrl: initial?.ctaUrl ?? "/signup",
    promoCodeId: initial?.promoCodeId ?? "",
    delaySeconds: String(initial?.delaySeconds ?? 3),
    frequency: initial?.frequency ?? "session",
    isActive: initial?.isActive ?? false,
    startsAt: toLocalInput(initial?.startsAt),
    endsAt: toLocalInput(initial?.endsAt),
  });
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const promo = promos.find((p) => p.id === f.promoCodeId);

  const onImage = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast.error("Use a PNG, JPEG, WebP or GIF image.");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be under 5 MB.");
    const r = new FileReader();
    r.onload = () => setF((x) => ({ ...x, imageUrl: String(r.result) }));
    r.readAsDataURL(file);
  };

  const save = async () => {
    if (!f.title.trim() && !f.body.trim() && !f.imageUrl && !f.ctaLabel.trim() && !f.promoCodeId) return toast.error("Add at least an image, headline or message.");
    setSaving(true);
    try {
      const json = {
        kind,
        title: f.title.trim(),
        body: f.body.trim() || null,
        imageUrl: f.imageUrl,
        ctaLabel: f.ctaLabel.trim() || null,
        ctaUrl: f.ctaUrl.trim() || null,
        promoCodeId: f.promoCodeId || null,
        delaySeconds: Number(f.delaySeconds || 0),
        frequency: f.frequency,
        isActive: f.isActive,
        startsAt: fromLocalInput(f.startsAt),
        endsAt: fromLocalInput(f.endsAt),
      };
      if (initial) await api(`/api/super-admin/offers/${initial.id}`, { method: "PUT", json });
      else await api("/api/super-admin/offers", { method: "POST", json });
      toast.success(f.isActive ? "Saved. The pop-up is live on the home page." : "Saved.");
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal
      wide
      title={`${initial ? "Edit" : "New"} ${KIND[kind].label.toLowerCase()}`}
      subtitle={KIND[kind].hint}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" className="mr-auto gap-1.5" onClick={() => setShowPreview(true)}><Eye className="size-3.5" /> Preview</Button>
          <label className="flex cursor-pointer items-center gap-2 text-[12px]"><input type="checkbox" className="size-4 rx-check" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Live on home page</label>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={() => void save()} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Headline" className="sm:col-span-2"><Input className={inputCls} value={f.title} onChange={set("title")} maxLength={160} autoFocus /></Field>
        <Field label="Message" className="sm:col-span-2"><Textarea rows={3} className="text-[13px] md:text-[13px]" value={f.body} onChange={set("body")} maxLength={1000} placeholder="Start automating WhatsApp today. Offer valid till Sunday." /></Field>
        <div className="space-y-1 sm:col-span-2">
          <span className="text-[12px] font-medium">Image</span>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-2.5">
            {f.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.imageUrl} alt="" className="h-14 w-24 shrink-0 rounded-md border object-cover" />
            ) : (
              <span className="grid h-14 w-24 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><ImagePlus className="size-4" /></span>
            )}
            <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">Banner shown at the top of the pop-up. PNG, JPEG, WebP or GIF, up to 5 MB. Wide images (about 16:9) look best.</p>
            <label className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted">
              {f.imageUrl ? "Replace" : "Upload"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {f.imageUrl && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setF({ ...f, imageUrl: null })}>Remove</Button>}
          </div>
        </div>
        <Field label="Button text"><Input className={inputCls} value={f.ctaLabel} onChange={set("ctaLabel")} maxLength={60} /></Field>
        <Field label="Button link" hint="A page here (like /signup or /pricing) or an https link."><Input className={inputCls} value={f.ctaUrl} onChange={set("ctaUrl")} maxLength={500} /></Field>
        <Field label="Promo code to show" hint={promo ? `${promo.label}. Linking to /signup applies it automatically.` : "Optional. Visitors can copy it with one tap."}>
          <select className={selectCls} value={f.promoCodeId} onChange={set("promoCodeId")}>
            <option value="">No promo code</option>
            {promos.map((p) => <option key={p.id} value={p.id} disabled={p.state !== "active" && p.id !== f.promoCodeId}>{p.code} · {p.label}{p.state !== "active" ? ` (${p.state.replace("_", " ")})` : ""}</option>)}
          </select>
        </Field>
        <Field label="How often">
          <select className={selectCls} value={f.frequency} onChange={set("frequency")}>
            {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {kind === "welcome" && <Field label="Open after (seconds)"><Input className={inputCls} inputMode="numeric" value={f.delaySeconds} onChange={(e) => setF({ ...f, delaySeconds: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></Field>}
        <Field label="Starts" hint="Leave empty to start now."><Input type="datetime-local" className={inputCls} value={f.startsAt} onChange={set("startsAt")} /></Field>
        <Field label="Ends" hint="Leave empty to run until turned off."><Input type="datetime-local" className={inputCls} value={f.endsAt} onChange={set("endsAt")} /></Field>
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-[310]">
          <OfferModal preview offer={{ id: "preview", kind, title: f.title, body: f.body || null, imageUrl: f.imageUrl, ctaLabel: f.ctaLabel || null, ctaUrl: f.ctaUrl || null, promoCode: promo?.code ?? null }} onClose={() => setShowPreview(false)} />
        </div>
      )}
    </AdminModal>
  );
}
