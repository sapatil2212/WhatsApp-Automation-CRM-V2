"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, CalendarPlus, Check, IndianRupee, Loader2, MessageCircle, Pencil, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { api } from "@/lib/campaigns/api";
import { addDays, age, fmtDate, fmtPhone, inr, todayIst, welcomeOutcome, type GymPackage, type MemberDetail, type Membership } from "@/lib/gym/format";
import { GymModal, gymInput, gymSelect, PAYMENT_MODES } from "./gym-modal";
import { PackageAssignFields, assignBody, assignTotals, emptyAssign, type AssignValue } from "./package-assign-fields";
import { MembershipBadge, PaymentBadge } from "./member-badges";

const EVENT_LABEL: Record<string, string> = { member_welcome: "Welcome" };
const MSG_STATUS: Record<string, string> = {
  sent: "Sent",
  failed: "Failed",
  blocked_no_template: "Needs approved template",
  skipped_no_consent: "No consent",
  pending: "Sending",
};

export function MemberDetailDialog({ memberId, packages, onClose, onEdit, onDelete, onChanged }: {
  memberId: string;
  packages: GymPackage[];
  onClose: () => void;
  onEdit: (m: MemberDetail) => void;
  onDelete: (m: MemberDetail) => void;
  onChanged: () => void;
}) {
  const [m, setM] = useState<MemberDetail | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [paying, setPaying] = useState<Membership | null>(null);
  const [cancelling, setCancelling] = useState<Membership | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setM((await api<MemberDetail>(`/api/gym/members/${memberId}`)).data);
    } catch (e) {
      toast.error((e as Error).message);
      onClose();
    }
  }, [memberId, onClose]);
  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    await load();
    onChanged();
  };

  const resendWelcome = async () => {
    if (!m) return;
    setSending(true);
    try {
      const res = await api<{ status: string }>(`/api/gym/members/${m.id}/welcome`, { method: "POST" });
      const w = welcomeOutcome(res.data.status);
      if (w?.ok) toast.success(w.text);
      else toast.error(w?.text ?? "Welcome not sent.", { duration: 10_000 });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (!m) {
    return (
      <GymModal title="Member" onClose={onClose} size="lg">
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      </GymModal>
    );
  }

  const years = age(m.dateOfBirth);
  const c = m.current;

  return (
    <>
      <GymModal
        size="lg"
        title={m.name}
        subtitle={<span className="flex flex-wrap items-center gap-x-2"><span className="font-mono">{m.memberCode}</span><span>·</span><span className="font-mono">{fmtPhone(m.phone)}</span>{m.status !== "active" && <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium capitalize">{m.status}</span>}</span>}
        onClose={onClose}
        footer={
          <>
            <Button variant="outline" size="sm" className="mr-auto gap-1.5 text-destructive hover:text-destructive" onClick={() => onDelete(m)}><Trash2 className="size-3.5" /> Delete</Button>
            {m.conversationId && <Button variant="outline" size="sm" className="gap-1.5" render={<a href={`/inbox?c=${m.conversationId}`} />}><MessageCircle className="size-3.5" /> Chat</Button>}
            <Button variant="outline" size="sm" className="gap-1.5" disabled={sending || !m.whatsappConsent} onClick={() => void resendWelcome()} title={m.whatsappConsent ? "Send the welcome message again" : "No WhatsApp consent"}>{sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Welcome</Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onEdit(m)}><Pencil className="size-3.5" /> Edit</Button>
            <Button size="sm" className="gap-1.5" onClick={() => setRenewing(true)}><CalendarPlus className="size-3.5" /> {c ? "Renew / add package" : "Assign package"}</Button>
          </>
        }
      >
        <div className="space-y-4 text-[13px]">
          {/* Current package */}
          <section className={`rounded-xl border p-3.5 ${c?.state === "active" ? "border-primary/30 bg-primary/5" : "border-border/70"}`}>
            {c ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Current package</p>
                  <p className="mt-0.5 truncate text-[15px] font-semibold">{c.packageName}</p>
                  <p className="text-[12px] text-muted-foreground">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <MembershipBadge m={c} />
                  <PaymentBadge m={c} />
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">No package assigned yet.</p>
            )}
          </section>

          {/* Profile */}
          <section className="rounded-xl border border-border/70 p-3.5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
              <Item label="Gender" value={m.gender ? m.gender.charAt(0).toUpperCase() + m.gender.slice(1) : "—"} />
              <Item label="Age" value={years != null ? `${years} yrs` : "—"} />
              <Item label="Joined" value={fmtDate(m.joinedAt)} />
              <Item label="Email" value={m.email || "—"} />
              <Item label="Height / weight" value={[m.heightCm && `${m.heightCm} cm`, m.weightKg && `${m.weightKg} kg`].filter(Boolean).join(" · ") || "—"} />
              <Item label="Goal" value={m.fitnessGoal || "—"} />
              <Item label="Emergency contact" value={[m.emergencyContactName, fmtPhone(m.emergencyContactPhone)].filter(Boolean).join(" · ") || "—"} />
              <Item label="WhatsApp updates" value={m.whatsappConsent ? "Agreed" : "Not agreed"} />
              <Item label="Welcome message" value={m.welcomeSentAt ? `Sent ${new Date(m.welcomeSentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "Not sent"} />
            </dl>
            {m.address && <p className="mt-2.5 text-[12px] text-muted-foreground">{m.address}</p>}
            {m.medicalNotes && <p className="mt-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[12px] text-rose-700 dark:text-rose-300">Medical: {m.medicalNotes}</p>}
            {m.notes && <p className="mt-2.5 whitespace-pre-wrap text-[12px] text-foreground/80">{m.notes}</p>}
          </section>

          {/* History */}
          <section>
            <h3 className="mb-2 text-[12px] font-semibold">Packages & payments</h3>
            {m.memberships.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted-foreground">No packages yet.</p>
            ) : (
              <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70">
                {m.memberships.map((x) => (
                  <li key={x.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 ${x.state === "cancelled" ? "opacity-60" : ""}`}>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{x.packageName}</p>
                      <p className="text-[11px] text-muted-foreground">{fmtDate(x.startDate)} – {fmtDate(x.endDate)} · {inr(x.price - x.discount)}{x.discount ? ` (after ${inr(x.discount)} off)` : ""}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MembershipBadge m={x} />
                      <PaymentBadge m={x} />
                      {x.state !== "cancelled" && (
                        <>
                          {x.balance > 0 && <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" title="Record payment" aria-label="Record payment" onClick={() => setPaying(x)}><IndianRupee className="size-3.5" /></Button>}
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Cancel this package" aria-label="Cancel this package" onClick={() => setCancelling(x)}><Ban className="size-3.5" /></Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Messages */}
          {m.messages.length > 0 && (
            <section>
              <h3 className="mb-2 text-[12px] font-semibold">WhatsApp messages</h3>
              <ul className="space-y-1.5">
                {m.messages.map((x) => (
                  <li key={x.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-[12px]">
                    <div className="min-w-0">
                      <p className="font-medium">{EVENT_LABEL[x.eventType] ?? x.eventType} <span className="font-normal text-muted-foreground">· {x.channel === "template" ? `template ${x.templateName}` : x.channel === "text" ? "message" : "not sent"}</span></p>
                      {x.errorMessage && x.status !== "sent" && <p className="line-clamp-2 text-[11px] text-muted-foreground">{x.errorMessage}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={x.status === "sent" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{MSG_STATUS[x.status] ?? x.status}</p>
                      <p className="text-[10px] text-muted-foreground">{new Date(x.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </GymModal>

      {renewing && <RenewDialog member={m} packages={packages} onClose={() => setRenewing(false)} onDone={async () => { setRenewing(false); await refresh(); }} />}
      {paying && <PaymentDialog memberId={m.id} membership={paying} onClose={() => setPaying(null)} onDone={async () => { setPaying(null); await refresh(); }} />}
      <ConfirmationDialog
        isOpen={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this package?"
        description="It stays in the history marked as cancelled and no longer counts as the member's membership."
        details={cancelling ? <div className="flex items-center justify-between gap-3"><span className="truncate font-semibold">{cancelling.packageName}</span><span className="shrink-0 text-[11px] text-muted-foreground">{fmtDate(cancelling.startDate)} – {fmtDate(cancelling.endDate)}</span></div> : null}
        confirmText="Cancel package"
        cancelText="Keep it"
        variant="destructive"
        icon="warning"
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            await api(`/api/gym/members/${m.id}/memberships/${cancelling.id}`, { method: "PATCH", json: { status: "cancelled" } });
            toast.success("Package cancelled.");
            setCancelling(null);
            await refresh();
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }}
      />
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate">{value}</dd>
    </div>
  );
}

function RenewDialog({ member, packages, onClose, onDone }: { member: MemberDetail; packages: GymPackage[]; onClose: () => void; onDone: () => Promise<void> }) {
  const today = todayIst();
  // Renewals start the day after the current package ends (or today if it already ended).
  const after = member.current && member.current.state !== "cancelled" && member.current.endDate >= today ? addDays(member.current.endDate, 1) : today;
  const [v, setV] = useState<AssignValue>(() => ({ ...emptyAssign(after), includeJoiningFee: false, packageId: member.current?.packageId && packages.some((p) => p.id === member.current?.packageId && p.isActive) ? member.current.packageId : packages.find((p) => p.isActive)?.id ?? "" }));
  const [saving, setSaving] = useState(false);
  const pkg = packages.find((p) => p.id === v.packageId);
  const t = assignTotals(v, pkg);
  const save = async () => {
    const body = assignBody(v);
    if (!body) return toast.error("Choose a package.");
    if (t.paid > t.due + 0.005) return toast.error("Amount paid is more than the amount due.");
    setSaving(true);
    try {
      await api(`/api/gym/members/${member.id}/memberships`, { method: "POST", json: body });
      toast.success(`${pkg?.name ?? "Package"} assigned to ${member.name}.`);
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <GymModal
      size="lg"
      title={member.current ? "Renew or add a package" : "Assign a package"}
      subtitle={member.current ? `Current: ${member.current.packageName}, ends ${fmtDate(member.current.endDate)}` : member.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving || !v.packageId} onClick={() => void save()} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Assign package</Button>
        </>
      }
    >
      <PackageAssignFields value={v} onChange={setV} packages={packages} firstMembership={member.memberships.length === 0} />
    </GymModal>
  );
}

function PaymentDialog({ memberId, membership, onClose, onDone }: { memberId: string; membership: Membership; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState(String(membership.balance));
  const [mode, setMode] = useState(membership.paymentMode ?? "cash");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const add = Number(amount || 0);
    if (add <= 0) return toast.error("Enter the amount received.");
    if (add > membership.balance + 0.005) return toast.error(`The balance is ${inr(membership.balance)}.`);
    setSaving(true);
    try {
      await api(`/api/gym/members/${memberId}/memberships/${membership.id}`, { method: "PATCH", json: { amountPaid: membership.amountPaid + add, paymentMode: mode } });
      toast.success(`${inr(add)} recorded.`);
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <GymModal
      title="Record payment"
      subtitle={`${membership.packageName} · balance ${inr(membership.balance)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={() => void save()} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Record</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[12px]">Amount received *</Label>
          <div className="relative"><IndianRupee className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className={`${gymInput} pl-7`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} autoFocus /></div>
        </div>
        <div className="space-y-1">
          <Label className="text-[12px]">Paid by</Label>
          <select className={gymSelect} value={mode} onChange={(e) => setMode(e.target.value)}>
            {PAYMENT_MODES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </div>
      </div>
    </GymModal>
  );
}
