"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, History, Loader2, Pencil, Plus, Tag, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { api } from "@/lib/campaigns/api";
import { formatPaise, SELF_SERVE_PLANS } from "@/lib/billing/plans";
import { AdminModal, Field, fmtDate, fromLocalInput, inputCls, Pill, selectCls, toLocalInput, useAdminApi } from "./shared";

export interface PromoRow {
  id: string;
  code: string;
  description: string | null;
  discountType: "percent" | "flat";
  discountValue: number;
  maxDiscount: number | null;
  label: string;
  plans: string[];
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  timesRedeemed: number;
  isActive: boolean;
  state: "active" | "paused" | "expired" | "scheduled" | "used_up";
  stats: { redeemed: number; pending: number; discountPaise: number; revenuePaise: number };
  createdAt: string;
}

const STATE: Record<PromoRow["state"], { tone: "green" | "muted" | "amber" | "blue" | "red"; text: string }> = {
  active: { tone: "green", text: "Active" },
  paused: { tone: "muted", text: "Paused" },
  expired: { tone: "amber", text: "Expired" },
  scheduled: { tone: "blue", text: "Scheduled" },
  used_up: { tone: "red", text: "Limit reached" },
};
const planName = (id: string) => SELF_SERVE_PLANS.find((p) => p.id === id)?.name ?? id;

export function PromoTab({ onShowHistory }: { onShowHistory: (promoId: string) => void }) {
  const { data, error, loading, reload } = useAdminApi<PromoRow[]>("/api/super-admin/promo-codes");
  const [editing, setEditing] = useState<PromoRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<PromoRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (p: PromoRow) => {
    setBusy(p.id);
    try {
      await api(`/api/super-admin/promo-codes/${p.id}`, { method: "PATCH", json: { isActive: !p.isActive } });
      toast.success(p.isActive ? `${p.code} paused.` : `${p.code} is active again.`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">Codes customers enter on the signup form. The discount comes off the first month&apos;s price.</p>
        <Button size="sm" className="gap-1.5" onClick={() => setEditing("new")}><Plus className="size-3.5" /> New promo code</Button>
      </div>
      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed text-[13px]">
            <colgroup><col className="w-[20%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[14%]" /><col className="w-[14%]" /><col className="w-[10%]" /><col className="w-[150px]" /></colgroup>
            <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Code</th>
                <th className="px-3 py-2">Discount</th>
                <th className="px-3 py-2">Plans</th>
                <th className="px-3 py-2">Valid</th>
                <th className="px-3 py-2">Used</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading && !data ? (
                Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-8 animate-pulse rounded-lg bg-muted/70" /></td></tr>)
              ) : !data?.length ? (
                <tr><td colSpan={7} className="px-4 py-14 text-center"><Tag className="mx-auto size-8 text-muted-foreground/60" /><p className="mt-2.5 text-sm font-medium">No promo codes yet</p><p className="mt-1 text-xs text-muted-foreground">Create one, then show it in a pop-up or share it with customers.</p></td></tr>
              ) : (
                data.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-muted/50">
                    <td className="px-4 py-2">
                      <button type="button" className="group flex items-center gap-1.5 font-mono text-[13px] font-semibold" title="Copy code" onClick={() => void navigator.clipboard.writeText(p.code).then(() => toast.success(`${p.code} copied.`))}>
                        {p.code} <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                      </button>
                      <p className="truncate text-[11px] text-muted-foreground">{p.description || "—"}</p>
                    </td>
                    <td className="px-3 py-2"><p className="truncate font-medium">{p.label}</p></td>
                    <td className="px-3 py-2 text-[12px]">{p.plans.length ? p.plans.map(planName).join(", ") : "All plans"}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">{p.startsAt || p.endsAt ? `${p.startsAt ? fmtDate(p.startsAt) : "Now"} – ${p.endsAt ? fmtDate(p.endsAt) : "no end"}` : "No end date"}</td>
                    <td className="px-3 py-2">
                      <p className="tabular-nums">{p.stats.redeemed}{p.maxRedemptions ? ` / ${p.maxRedemptions}` : ""}{p.stats.pending ? <span className="text-[11px] text-muted-foreground"> · {p.stats.pending} open</span> : null}</p>
                      <p className="text-[11px] text-muted-foreground">{formatPaise(p.stats.discountPaise)} given</p>
                    </td>
                    <td className="px-3 py-2"><Pill tone={STATE[p.state].tone}>{STATE[p.state].text}</Pill></td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <label className="mr-1 flex cursor-pointer items-center gap-1 text-[11px]" title={p.isActive ? "Pause" : "Activate"}><input type="checkbox" className="size-4 rx-check" checked={p.isActive} disabled={busy === p.id} onChange={() => void toggle(p)} /> On</label>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Usage history" aria-label="Usage history" onClick={() => onShowHistory(p.id)}><History className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit" aria-label="Edit" onClick={() => setEditing(p)}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title={p.timesRedeemed ? "Used codes are kept for history. Pause it instead." : "Delete"} aria-label="Delete" disabled={p.timesRedeemed > 0} onClick={() => setDeleting(p)}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <PromoForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
      <ConfirmationDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this promo code?"
        description="It has never been used, so nothing in the payment history depends on it."
        details={deleting ? <span className="font-mono font-semibold">{deleting.code}</span> : null}
        notes={["Pop-ups showing this code stop showing it."]}
        confirmText="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api(`/api/super-admin/promo-codes/${deleting.id}`, { method: "DELETE" });
            toast.success("Promo code deleted.");
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

function PromoForm({ initial, onClose, onSaved }: { initial: PromoRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({
    code: initial?.code ?? "",
    description: initial?.description ?? "",
    discountType: initial?.discountType ?? "percent",
    discountValue: initial ? String(initial.discountValue) : "20",
    maxDiscount: initial?.maxDiscount != null ? String(initial.maxDiscount) : "",
    plans: initial?.plans ?? [],
    startsAt: toLocalInput(initial?.startsAt),
    endsAt: toLocalInput(initial?.endsAt),
    maxRedemptions: initial?.maxRedemptions != null ? String(initial.maxRedemptions) : "",
    perUserLimit: String(initial?.perUserLimit ?? 1),
    isActive: initial?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const locked = Boolean(initial);

  // Live example on each plan.
  const example = SELF_SERVE_PLANS.filter((p) => !f.plans.length || f.plans.includes(p.id)).map((p) => {
    const price = p.pricePaise ?? 0;
    const v = Number(f.discountValue || 0);
    let off = f.discountType === "percent" ? Math.round((price * Math.min(100, v)) / 100) : Math.round(v * 100);
    if (f.discountType === "percent" && f.maxDiscount) off = Math.min(off, Math.round(Number(f.maxDiscount) * 100));
    off = Math.max(0, Math.min(price, off));
    return `${p.name}: ${formatPaise(price)} → ${formatPaise(price - off)}`;
  });

  const save = async () => {
    setSaving(true);
    try {
      if (initial) {
        await api(`/api/super-admin/promo-codes/${initial.id}`, {
          method: "PATCH",
          json: { description: f.description.trim() || null, plans: f.plans, startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt), maxRedemptions: f.maxRedemptions || null, perUserLimit: Number(f.perUserLimit || 1), isActive: f.isActive },
        });
      } else {
        await api("/api/super-admin/promo-codes", {
          method: "POST",
          json: { code: f.code, description: f.description.trim() || null, discountType: f.discountType, discountValue: f.discountValue, maxDiscount: f.discountType === "percent" ? f.maxDiscount || null : null, plans: f.plans, startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt), maxRedemptions: f.maxRedemptions || null, perUserLimit: Number(f.perUserLimit || 1), isActive: f.isActive },
        });
      }
      toast.success(initial ? "Promo code saved." : `${f.code.toUpperCase()} created.`);
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal
      title={initial ? `Edit ${initial.code}` : "New promo code"}
      subtitle={initial ? "The code and discount can't change after creation, so past uses stay accurate." : "Customers enter this on the signup form."}
      onClose={onClose}
      footer={
        <>
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-[12px]"><input type="checkbox" className="size-4 rx-check" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={() => void save()} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {initial ? "Save" : "Create code"}</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code *" hint="Letters, numbers, - or _. Not case-sensitive.">
          <Input className={`${inputCls} font-mono uppercase`} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "") })} maxLength={40} disabled={locked} placeholder="WELCOME20" autoFocus={!locked} />
        </Field>
        <Field label="Internal note"><Input className={inputCls} value={f.description} onChange={set("description")} maxLength={300} placeholder="Diwali campaign" /></Field>
        <Field label="Discount type">
          <select className={selectCls} value={f.discountType} onChange={set("discountType")} disabled={locked}>
            <option value="percent">Percentage (%)</option>
            <option value="flat">Fixed amount (₹)</option>
          </select>
        </Field>
        <Field label={f.discountType === "percent" ? "Percent off *" : "Amount off (₹) *"}>
          <Input className={inputCls} inputMode="decimal" value={f.discountValue} onChange={(e) => setF({ ...f, discountValue: e.target.value.replace(/[^\d.]/g, "") })} disabled={locked} />
        </Field>
        {f.discountType === "percent" && (
          <Field label="Maximum discount (₹)" hint="Optional cap."><Input className={inputCls} inputMode="decimal" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value.replace(/[^\d.]/g, "") })} disabled={locked} placeholder="No cap" /></Field>
        )}
        <div className="space-y-1 sm:col-span-2">
          <span className="text-[12px] font-medium">Plans</span>
          <div className="flex flex-wrap gap-2">
            {SELF_SERVE_PLANS.map((p) => {
              const on = f.plans.includes(p.id);
              return (
                <button key={p.id} type="button" onClick={() => setF({ ...f, plans: on ? f.plans.filter((x) => x !== p.id) : [...f.plans, p.id] })} className={`rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}>
                  {p.name} · {p.price}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{f.plans.length ? "Only the selected plans." : "None selected: works on every plan."} {example.join(" · ")}</p>
        </div>
        <Field label="Starts" hint="Empty = from now."><Input type="datetime-local" className={inputCls} value={f.startsAt} onChange={set("startsAt")} /></Field>
        <Field label="Expires" hint="Empty = never."><Input type="datetime-local" className={inputCls} value={f.endsAt} onChange={set("endsAt")} /></Field>
        <Field label="Total uses allowed" hint="Empty = unlimited."><Input className={inputCls} inputMode="numeric" value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value.replace(/\D/g, "").slice(0, 7) })} placeholder="Unlimited" /></Field>
        <Field label="Uses per customer" hint="Counted by email."><Input className={inputCls} inputMode="numeric" value={f.perUserLimit} onChange={(e) => setF({ ...f, perUserLimit: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></Field>
      </div>
    </AdminModal>
  );
}
