"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, HeartPulse, Loader2, MessageCircle, Package, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/campaigns/api";
import { todayIst, welcomeOutcome, type GymPackage, type Member } from "@/lib/gym/format";
import { GymModal, gymInput, gymSelect } from "./gym-modal";
import { PackageAssignFields, assignBody, assignTotals, emptyAssign, type AssignValue } from "./package-assign-fields";

const STEPS = [
  { id: "personal", label: "Personal", icon: UserRound },
  { id: "health", label: "Health", icon: HeartPulse },
  { id: "package", label: "Package", icon: Package },
] as const;

/** Onboard a new member (3 steps) or edit an existing one (first two steps). */
export function MemberForm({ member, packages, clientLabel, onClose, onSaved }: {
  member: Member | null;
  packages: GymPackage[];
  clientLabel: string;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const today = todayIst();
  const steps = member ? STEPS.slice(0, 2) : STEPS;
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    name: member?.name ?? "",
    phone: member?.phone ? `+${member.phone}` : "",
    email: member?.email ?? "",
    gender: member?.gender ?? "",
    dateOfBirth: member?.dateOfBirth ?? "",
    address: member?.address ?? "",
    emergencyContactName: member?.emergencyContactName ?? "",
    emergencyContactPhone: member?.emergencyContactPhone ? `+${member.emergencyContactPhone}` : "",
    heightCm: member?.heightCm ? String(member.heightCm) : "",
    weightKg: member?.weightKg ? String(member.weightKg) : "",
    fitnessGoal: member?.fitnessGoal ?? "",
    medicalNotes: member?.medicalNotes ?? "",
    notes: member?.notes ?? "",
    joinedAt: member?.joinedAt ?? today,
    status: member?.status ?? "active",
    whatsappConsent: member?.whatsappConsent ?? true,
  });
  const [assign, setAssign] = useState<AssignValue>(() => {
    const first = packages.find((p) => p.isActive);
    return { ...emptyAssign(today), packageId: first?.id ?? "" };
  });
  const [sendWelcome, setSendWelcome] = useState(true);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const pkg = packages.find((p) => p.id === assign.packageId);
  const totals = useMemo(() => assignTotals(assign, pkg), [assign, pkg]);

  const stepError = (i: number): string | null => {
    if (i === 0) {
      if (f.name.trim().length < 2) return "Enter the name.";
      if (f.phone.replace(/\D/g, "").length < 10) return "Enter the WhatsApp number with country code if outside India.";
      if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return "Enter a valid email.";
    }
    if (i === 2 && pkg && totals.paid > totals.due + 0.005) return "Amount paid is more than the amount due.";
    return null;
  };

  const next = () => {
    const err = stepError(step);
    if (err) return toast.error(err);
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const save = async (withPackage = true) => {
    for (let i = 0; i < (withPackage ? steps.length : 2); i++) {
      const err = stepError(i);
      if (err) {
        setStep(i);
        return toast.error(err);
      }
    }
    setSaving(true);
    const body = {
      name: f.name.trim(),
      phone: f.phone.trim(),
      email: f.email.trim() || null,
      gender: f.gender || null,
      dateOfBirth: f.dateOfBirth || null,
      address: f.address.trim() || null,
      emergencyContactName: f.emergencyContactName.trim() || null,
      emergencyContactPhone: f.emergencyContactPhone.trim() || null,
      heightCm: f.heightCm ? Number(f.heightCm) : null,
      weightKg: f.weightKg ? Number(f.weightKg) : null,
      fitnessGoal: f.fitnessGoal.trim() || null,
      medicalNotes: f.medicalNotes.trim() || null,
      notes: f.notes.trim() || null,
      joinedAt: f.joinedAt || undefined,
      status: f.status,
      whatsappConsent: f.whatsappConsent,
    };
    try {
      if (member) {
        await api(`/api/gym/members/${member.id}`, { method: "PATCH", json: body });
        toast.success(`${body.name} saved.`);
        await onSaved(member.id);
      } else {
        const res = await api<{ member: Member; welcome: string | null }>("/api/gym/members", {
          method: "POST",
          json: { ...body, membership: withPackage ? assignBody(assign) : null, sendWelcome: sendWelcome && f.whatsappConsent },
        });
        const w = welcomeOutcome(res.data.welcome);
        toast.success(`${body.name} added as ${res.data.member.memberCode}.`, { description: w?.text, duration: w && !w.ok ? 10_000 : 4000 });
        await onSaved(res.data.member.id);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const last = step === steps.length - 1;

  return (
    <GymModal
      size="lg"
      title={member ? `Edit ${member.name}` : `New ${clientLabel.toLowerCase()}`}
      subtitle={member ? <span className="font-mono">{member.memberCode}</span> : "Fields marked * are required. Everything else can be added later."}
      onClose={onClose}
      footer={
        <>
          {step > 0 && <Button variant="outline" size="sm" className="mr-auto gap-1" onClick={() => setStep(step - 1)}><ChevronLeft className="size-3.5" /> Back</Button>}
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          {!last && <Button variant="outline" size="sm" onClick={() => void save(false)} disabled={saving} className={member ? "" : "hidden sm:inline-flex"}>{member ? "Save" : "Save without package"}</Button>}
          {last ? (
            <Button size="sm" disabled={saving} onClick={() => void save()} className="gap-1.5">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {member ? "Save changes" : `Add ${clientLabel.toLowerCase()}`}</Button>
          ) : (
            <Button size="sm" onClick={next} className="gap-1">Next <ChevronRight className="size-3.5" /></Button>
          )}
        </>
      }
    >
      {/* Stepper */}
      <ol className="mb-4 flex items-center gap-2">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <button type="button" onClick={() => (i < step || !stepError(step) ? setStep(i) : toast.error(stepError(step)!))} className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium transition-colors ${i === step ? "bg-primary text-primary-foreground" : i < step ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-accent"}`}>
              <s.icon className="size-3.5 shrink-0" /> <span className="truncate">{i + 1}. {s.label}</span>
            </button>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2"><Label className="text-[12px]">Full name *</Label><Input className={gymInput} value={f.name} onChange={set("name")} maxLength={120} placeholder="Asha Rao" autoFocus /></div>
          <div className="space-y-1">
            <Label className="text-[12px]">WhatsApp number *</Label>
            <Input className={gymInput} value={f.phone} onChange={set("phone")} inputMode="tel" placeholder="+91 98765 43210" disabled={Boolean(member)} />
            {member && <p className="text-[11px] text-muted-foreground">The number identifies the member and can&apos;t be changed.</p>}
          </div>
          <div className="space-y-1"><Label className="text-[12px]">Email</Label><Input className={gymInput} type="email" value={f.email} onChange={set("email")} placeholder="Optional" /></div>
          <div className="space-y-1">
            <Label className="text-[12px]">Gender</Label>
            <select className={gymSelect} value={f.gender} onChange={set("gender")}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-1"><Label className="text-[12px]">Date of birth</Label><Input type="date" className={gymInput} value={f.dateOfBirth} max={today} onChange={set("dateOfBirth")} /></div>
          <div className="space-y-1 sm:col-span-2"><Label className="text-[12px]">Address</Label><Input className={gymInput} value={f.address} onChange={set("address")} maxLength={500} placeholder="Area, city" /></div>
          <div className="space-y-1"><Label className="text-[12px]">Joined on</Label><Input type="date" className={gymInput} value={f.joinedAt} onChange={set("joinedAt")} /></div>
          {member && (
            <div className="space-y-1">
              <Label className="text-[12px]">Status</Label>
              <select className={gymSelect} value={f.status} onChange={set("status")}>
                <option value="active">Active</option>
                <option value="frozen">Frozen (on hold)</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-[13px] sm:col-span-2">
            <input type="checkbox" className="mt-0.5 size-4 rx-check" checked={f.whatsappConsent} onChange={(e) => setF({ ...f, whatsappConsent: e.target.checked })} />
            <span>Agreed to receive WhatsApp updates <span className="block text-[11px] text-muted-foreground">Welcome, renewal and attendance messages are only sent when this is ticked.</span></span>
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label className="text-[12px]">Emergency contact name</Label><Input className={gymInput} value={f.emergencyContactName} onChange={set("emergencyContactName")} maxLength={120} /></div>
          <div className="space-y-1"><Label className="text-[12px]">Emergency contact number</Label><Input className={gymInput} value={f.emergencyContactPhone} onChange={set("emergencyContactPhone")} inputMode="tel" /></div>
          <div className="space-y-1"><Label className="text-[12px]">Height (cm)</Label><Input className={gymInput} inputMode="numeric" value={f.heightCm} onChange={(e) => setF({ ...f, heightCm: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></div>
          <div className="space-y-1"><Label className="text-[12px]">Weight (kg)</Label><Input className={gymInput} inputMode="decimal" value={f.weightKg} onChange={(e) => setF({ ...f, weightKg: e.target.value.replace(/[^\d.]/g, "").slice(0, 5) })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label className="text-[12px]">Fitness goal</Label><Input className={gymInput} value={f.fitnessGoal} onChange={set("fitnessGoal")} maxLength={191} placeholder="Weight loss, muscle gain, general fitness…" /></div>
          <div className="space-y-1 sm:col-span-2"><Label className="text-[12px]">Medical conditions / injuries</Label><Textarea rows={2} className="text-[13px] md:text-[13px]" value={f.medicalNotes} onChange={set("medicalNotes")} maxLength={2000} placeholder="Back pain, asthma, recent surgery…" /></div>
          <div className="space-y-1 sm:col-span-2"><Label className="text-[12px]">Notes</Label><Textarea rows={2} className="text-[13px] md:text-[13px]" value={f.notes} onChange={set("notes")} maxLength={2000} placeholder="Preferred timings, trainer, referral…" /></div>
        </div>
      )}

      {step === 2 && !member && (
        <div className="space-y-4">
          <PackageAssignFields value={assign} onChange={setAssign} packages={packages} firstMembership />
          <label className={`flex items-start gap-2 rounded-xl border border-border/70 px-3 py-2.5 text-[13px] ${f.whatsappConsent ? "cursor-pointer" : "opacity-60"}`}>
            <input type="checkbox" className="mt-0.5 size-4 rx-check" checked={sendWelcome && f.whatsappConsent} disabled={!f.whatsappConsent} onChange={(e) => setSendWelcome(e.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5 font-medium"><MessageCircle className="size-3.5 text-emerald-600" /> Send a welcome message on WhatsApp now</span>
              <span className="block text-[11px] text-muted-foreground">{f.whatsappConsent ? "Includes the member ID and package dates. Outside the 24-hour window it uses your approved \u201cMembership activated\u201d template." : "Tick the WhatsApp consent box in step 1 to send it."}</span>
            </span>
          </label>
        </div>
      )}
    </GymModal>
  );
}
