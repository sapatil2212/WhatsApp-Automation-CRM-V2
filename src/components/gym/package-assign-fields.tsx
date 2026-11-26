"use client";

import { IndianRupee } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays, durationLabel, fmtDate, inr, type GymPackage } from "@/lib/gym/format";
import { gymInput, gymSelect, PAYMENT_MODES } from "./gym-modal";

export interface AssignValue {
  packageId: string;
  startDate: string;
  price: string;
  discount: string;
  amountPaid: string;
  paymentMode: string;
  includeJoiningFee: boolean;
}

export const emptyAssign = (today: string): AssignValue => ({ packageId: "", startDate: today, price: "", discount: "", amountPaid: "", paymentMode: "cash", includeJoiningFee: true });

/** Totals for an assignment, mirroring the server's rules. */
export function assignTotals(v: AssignValue, pkg: GymPackage | undefined) {
  const base = v.price !== "" ? Number(v.price) : pkg?.price ?? 0;
  const joining = v.includeJoiningFee ? pkg?.joiningFee ?? 0 : 0;
  const total = base + joining;
  const discount = Math.min(Number(v.discount || 0), total);
  const due = total - discount;
  const paid = Number(v.amountPaid || 0);
  return { base, joining, total, discount, due, paid, balance: Math.max(0, due - paid), end: pkg ? addDays(v.startDate, pkg.durationDays - 1) : null };
}

/** API body for an assignment (or null when no package is chosen). */
export function assignBody(v: AssignValue) {
  if (!v.packageId) return null;
  return {
    packageId: v.packageId,
    startDate: v.startDate,
    ...(v.price !== "" ? { price: Number(v.price) } : {}),
    discount: Number(v.discount || 0),
    amountPaid: Number(v.amountPaid || 0),
    paymentMode: v.paymentMode || null,
    includeJoiningFee: v.includeJoiningFee,
  };
}

export function PackageAssignFields({ value, onChange, packages, firstMembership }: {
  value: AssignValue;
  onChange: (v: AssignValue) => void;
  packages: GymPackage[];
  /** Offer the joining fee only on a member's first package. */
  firstMembership: boolean;
}) {
  const available = packages.filter((p) => p.isActive || p.id === value.packageId);
  const pkg = packages.find((p) => p.id === value.packageId);
  const t = assignTotals(value, pkg);
  const set = (patch: Partial<AssignValue>) => onChange({ ...value, ...patch });
  const money = (k: "price" | "discount" | "amountPaid") => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value.replace(/[^\d.]/g, "") });

  if (available.length === 0) {
    return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">No packages yet. Add them on the Packages page, then assign one here.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {available.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => set({ packageId: p.id === value.packageId ? "" : p.id, price: "" })}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${p.id === value.packageId ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40"}`}
          >
            <p className="truncate text-[13px] font-medium">{p.name}</p>
            <p className="text-[11px] text-muted-foreground">{durationLabel(p.durationDays)} · {inr(p.price)}{p.joiningFee ? ` + ${inr(p.joiningFee)} joining` : ""}</p>
          </button>
        ))}
      </div>

      {pkg && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label className="text-[12px]">Start date *</Label><Input type="date" className={gymInput} value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} /></div>
            <div className="space-y-1">
              <Label className="text-[12px]">Ends</Label>
              <p className="flex h-8 items-center rounded-lg border border-border bg-muted/40 px-2.5 text-[13px]">{fmtDate(t.end)}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Package price</Label>
              <div className="relative"><IndianRupee className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className={`${gymInput} pl-7`} inputMode="decimal" value={value.price} onChange={money("price")} placeholder={String(pkg.price)} /></div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[12px]">Discount</Label>
              <div className="relative"><IndianRupee className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className={`${gymInput} pl-7`} inputMode="decimal" value={value.discount} onChange={money("discount")} placeholder="0" /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Amount paid</Label>
              <div className="relative"><IndianRupee className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className={`${gymInput} pl-7`} inputMode="decimal" value={value.amountPaid} onChange={money("amountPaid")} placeholder="0" /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Paid by</Label>
              <select className={gymSelect} value={value.paymentMode} onChange={(e) => set({ paymentMode: e.target.value })}>
                {PAYMENT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>
          {firstMembership && pkg.joiningFee ? (
            <label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" className="size-4 rx-check" checked={value.includeJoiningFee} onChange={(e) => set({ includeJoiningFee: e.target.checked })} /> Add joining fee ({inr(pkg.joiningFee)})</label>
          ) : null}
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-[12px]">
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Due</p><p className="font-semibold tabular-nums">{inr(t.due)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Paid</p><p className="font-semibold tabular-nums">{inr(t.paid)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</p><p className={`font-semibold tabular-nums ${t.balance > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{inr(t.balance)}</p></div>
          </div>
          {t.paid > t.due + 0.005 && <p className="text-[12px] text-destructive">Amount paid is more than the amount due.</p>}
        </>
      )}
    </div>
  );
}
