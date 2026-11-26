"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Check, Clock, IndianRupee, Loader2, Package, Pencil, Plus, Trash2, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { api } from "@/lib/campaigns/api";
import { durationLabel, inr, type GymPackage } from "@/lib/gym/format";

const PRESETS = [
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
];
const inputCls = "h-8 text-[13px] md:text-[13px]";

export default function PackagesPage() {
  const { businessSegment } = useParams<{ businessSegment: string }>();
  const [items, setItems] = useState<GymPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GymPackage | "new" | null>(null);
  const [deleting, setDeleting] = useState<GymPackage | null>(null);
  const [missingSetup, setMissingSetup] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await api<{ items: GymPackage[] }>("/api/gym/packages")).data.items);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 404) setMissingSetup(true);
      else toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (p: GymPackage) => {
    try {
      await api(`/api/gym/packages/${p.id}`, { method: "PATCH", json: { ...p, isActive: !p.isActive } });
      toast.success(p.isActive ? `${p.name} hidden from new members.` : `${p.name} is available again.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (missingSetup) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <Package className="size-9 text-muted-foreground/60" />
        <h3 className="mt-3 text-sm font-semibold">Finish your business setup first</h3>
        <p className="mt-1 text-xs text-muted-foreground">Packages belong to your business profile.</p>
        <Button size="sm" className="mt-4" render={<Link href={`/${businessSegment}/setup`} />}>Open setup</Button>
      </div>
    );
  }

  const active = items.filter((p) => p.isActive);
  const members = items.reduce((a, p) => a + p.activeMembers, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Packages</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Memberships you sell. Assign them when you onboard or renew a member.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setEditing("new")}><Plus className="size-3.5" /> New package</Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {[
          { label: "Packages", value: items.length, icon: Package },
          { label: "Available", value: active.length, icon: Check },
          { label: "Members on a package", value: members, icon: Users },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><s.icon className="size-3.5" /></span>
            </div>
            <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{loading ? "—" : s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted/70" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-16 text-center">
          <Package className="mx-auto size-9 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">No packages yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add your monthly, quarterly or yearly plans to start onboarding members.</p>
          <Button size="sm" className="mt-4 gap-1.5" onClick={() => setEditing("new")}><Plus className="size-3.5" /> New package</Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <div key={p.id} className={`flex flex-col rounded-2xl border bg-card p-4 transition-colors ${p.isActive ? "border-border/70" : "border-dashed border-border opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{p.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground"><Clock className="size-3.5" /> {durationLabel(p.durationDays)}</p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Edit" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil className="size-3.5" /></Button>
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums">{inr(p.price)}</p>
              {p.joiningFee ? <p className="text-[11px] text-muted-foreground">+ {inr(p.joiningFee)} joining fee</p> : <p className="text-[11px] text-muted-foreground">No joining fee</p>}
              {p.description && <p className="mt-2 line-clamp-2 text-[12px] text-foreground/80">{p.description}</p>}
              {p.features.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {p.features.slice(0, 5).map((f) => <li key={f} className="flex items-center gap-1.5 text-[12px]"><Check className="size-3.5 shrink-0 text-primary" /> <span className="truncate">{f}</span></li>)}
                </ul>
              )}
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-[12px]">
                <span className="text-muted-foreground">{p.activeMembers} active member{p.activeMembers === 1 ? "" : "s"}</span>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="size-4 rx-check" checked={p.isActive} onChange={() => void toggleActive(p)} />
                  Available
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <PackageForm pkg={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}

      <ConfirmationDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this package?"
        description="It can no longer be assigned to members."
        details={deleting ? <div className="flex items-center justify-between gap-3"><span className="truncate font-semibold">{deleting.name}</span><span className="shrink-0 text-[11px] text-muted-foreground">{durationLabel(deleting.durationDays)} · {inr(deleting.price)}</span></div> : null}
        notes={[
          deleting?.activeMembers ? `${deleting.activeMembers} member${deleting.activeMembers === 1 ? " is" : "s are"} on this package. Their memberships, dates and payments are kept.` : "Past memberships keep their package name and price.",
          "To stop selling it but keep it on record, untick Available instead.",
        ]}
        confirmText="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api(`/api/gym/packages/${deleting.id}`, { method: "DELETE" });
            toast.success("Package deleted.");
            setDeleting(null);
            await load();
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }}
      />
    </div>
  );
}

function PackageForm({ pkg, onClose, onSaved }: { pkg: GymPackage | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({
    name: pkg?.name ?? "",
    description: pkg?.description ?? "",
    durationDays: String(pkg?.durationDays ?? 30),
    price: pkg ? String(pkg.price) : "",
    joiningFee: pkg?.joiningFee ? String(pkg.joiningFee) : "",
    features: pkg?.features.join("\n") ?? "",
    isActive: pkg?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Enter the package name.");
    const days = Number(f.durationDays);
    if (!Number.isInteger(days) || days < 1) return toast.error("Duration must be at least 1 day.");
    if (f.price === "" || Number(f.price) < 0) return toast.error("Enter the price.");
    setSaving(true);
    try {
      const json = {
        name: f.name.trim(),
        description: f.description.trim() || null,
        durationDays: days,
        price: Number(f.price),
        joiningFee: f.joiningFee ? Number(f.joiningFee) : null,
        features: f.features.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 20),
        isActive: f.isActive,
        sortOrder: pkg?.sortOrder ?? 0,
      };
      if (pkg) await api(`/api/gym/packages/${pkg.id}`, { method: "PATCH", json });
      else await api("/api/gym/packages", { method: "POST", json });
      toast.success(pkg ? "Package saved." : "Package added.");
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={pkg ? "Edit package" : "New package"} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{pkg ? "Edit package" : "New package"}</h2>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><X className="size-4" /></Button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="space-y-1"><Label className="text-[12px]">Name *</Label><Input className={inputCls} value={f.name} onChange={set("name")} maxLength={120} placeholder="Monthly membership" autoFocus /></div>
          <div className="space-y-1">
            <Label className="text-[12px]">Duration *</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.days} type="button" onClick={() => setF({ ...f, durationDays: String(p.days) })} className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${Number(f.durationDays) === p.days ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}>{p.label}</button>
              ))}
              <div className="flex items-center gap-1.5">
                <Input className={`${inputCls} w-20`} inputMode="numeric" value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value.replace(/\D/g, "").slice(0, 4) })} aria-label="Duration in days" />
                <span className="text-[12px] text-muted-foreground">days</span>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[12px]">Price *</Label>
              <div className="relative"><IndianRupee className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className={`${inputCls} pl-7`} inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, "") })} placeholder="1500" /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Joining fee</Label>
              <div className="relative"><IndianRupee className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className={`${inputCls} pl-7`} inputMode="decimal" value={f.joiningFee} onChange={(e) => setF({ ...f, joiningFee: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Optional" /></div>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-[12px]">Description</Label><Textarea rows={2} className="text-[13px] md:text-[13px]" value={f.description} onChange={set("description")} maxLength={2000} placeholder="Gym floor access, locker, 1 diet consultation" /></div>
          <div className="space-y-1"><Label className="text-[12px]">What&apos;s included (one per line)</Label><Textarea rows={3} className="text-[13px] md:text-[13px]" value={f.features} onChange={set("features")} placeholder={"Cardio & weights\nGroup classes\nPersonal trainer (2 sessions)"} /></div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" className="size-4 rx-check" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Available for new members</label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={() => void save()} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {pkg ? "Save changes" : "Add package"}</Button>
        </div>
      </div>
    </div>
  );
}
