"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import {
  Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty,
  ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList, ComboboxTrigger,
} from "@/components/ui/combobox";
import { ArrowLeft, ArrowRight, Check, CheckCircle, Eye, EyeOff, Loader2, Paperclip, PartyPopper, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthField, AuthNotice, authInputClass, authPrimaryButton, authSecondaryButton } from "@/components/auth/auth-field";
import { OtpInput } from "@/components/auth/otp-input";
import { cn } from "@/lib/utils";
import { planById, SELF_SERVE_PLANS } from "@/lib/billing/plans";

const WHATSAPP_CONTACT = "917745868073";

// ─── Business Categories ──────────────────────────────────────────────────────
const BUSINESS_CATEGORIES = [
  "Beauty & Personal Care",
  "Health & Wellness",
  "Trades & Home Services",
  "Professional Services",
  "Automotive Services",
  "Medical & Allied Health",
  "Education & Training",
  "Hospitality",
  "Pet Services",
  "Other",
];

// ─── Pricing Plans (shared with the marketing site) ───────────────────────────
const PLAN_ICONS = { starter: Sparkles, managed: CheckCircle, custom: ArrowRight } as const;
const PLANS = SELF_SERVE_PLANS.map((p) => ({ ...p, icon: PLAN_ICONS[p.id] }));
const DEFAULT_PLAN = PLANS.find((p) => p.popular) ?? PLANS[0];
type Step = "form" | "otp" | "payment" | "done";

const STEP_TABS = [
  { id: "form", label: "Details" },
  { id: "otp", label: "Verify" },
  { id: "payment", label: "Payment" },
] as const;

const STEP_INDEX: Record<Step, number> = { form: 0, otp: 1, payment: 2, done: 3 };
const MIN_PASSWORD = 8;

export default function SignupPage() {
  const [fullName, setFullName]                     = useState("");
  const [email, setEmail]                           = useState("");
  const [mobileNumber, setMobileNumber]             = useState("");
  const [businessCategory, setBusinessCategory]     = useState("");
  const [password, setPassword]                     = useState("");
  const [confirmPassword, setConfirmPassword]       = useState("");
  const [showPassword, setShowPassword]             = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError]                           = useState<string | null>(null);
  const [loading, setLoading]                       = useState(false);

  // Flow steps: "form" -> "otp" -> "payment" -> "done"
  const [step, setStep]                             = useState<Step>("form");
  const [otp, setOtp]                               = useState("");
  const [verifyLoading, setVerifyLoading]           = useState(false);
  const [registeredUserId, setRegisteredUserId]     = useState<string | null>(null);

  const [selectedPlan, setSelectedPlan]             = useState<(typeof PLANS)[0]>(DEFAULT_PLAN);
  // Pricing-page buttons link to /signup?plan=<id>; pre-select that plan.
  useEffect(() => {
    const wanted = planById(new URLSearchParams(window.location.search).get("plan"));
    const match = wanted && PLANS.find((p) => p.id === wanted.id);
    if (match) setSelectedPlan(match);
  }, []);
  const [proofFile, setProofFile]                   = useState<File | null>(null);
  const [sending, setSending]                       = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (!businessCategory) { setError("Choose your business category"); return; }
    if (password.length < MIN_PASSWORD) { setError(`Password must be at least ${MIN_PASSWORD} characters`); return; }

    setLoading(true);

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          business_category: businessCategory,
          phone_number: mobileNumber,
          selected_plan: selectedPlan.id,
        },
      },
    });

    setLoading(false);

    if (signupError) {
      setError(signupError.message);
      return;
    }

    // Save registered user info
    if (data?.user) {
      setRegisteredUserId(data.user.id);
    }
    setStep("otp");
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifyLoading(true);

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "signup"
    });

    setVerifyLoading(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    // Save user ID if returned from verify
    if (data?.user) {
      setRegisteredUserId(data.user.id);
    }
    setStep("payment");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProofFile(e.target.files?.[0] ?? null);
  };

  const handleSendProof = async () => {
    if (!registeredUserId) {
      setError("Session expired. Please sign up again.");
      setStep("form");
      return;
    }
    setSending(true);

    try {
      // Mark as payment proof attached in the database
      const res = await fetch("/api/auth/payment-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: registeredUserId }),
      });

      if (!res.ok) throw new Error("Could not update payment proof status.");

      const message = encodeURIComponent(
        `🧾 *Payment Confirmation*\n\n` +
        `Hello! I have completed the payment for ChatNexGen CRM.\n\n` +
        `*Name:* ${fullName}\n` +
        `*Email:* ${email}\n` +
        `*Plan Selected:* ${selectedPlan.name} (${selectedPlan.price}${selectedPlan.period})\n` +
        `*Proof File:* ${proofFile?.name ?? "Attached"}\n\n` +
        `Please activate my account. Thank you! 🙏`
      );

      await new Promise((r) => setTimeout(r, 600));
      window.open(`https://wa.me/${WHATSAPP_CONTACT}?text=${message}`, "_blank");
      setStep("done");
    } catch (err) {
      setError((err instanceof Error && err.message) || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const currentIndex = STEP_INDEX[step];
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const strength = password.length >= 12 ? 3 : password.length >= MIN_PASSWORD ? 2 : password.length > 0 ? 1 : 0;

  return (
    <AuthShell
      variant="signup"
      maxWidth={step === "form" ? "wide" : "narrow"}
      topRight={
        <p className="text-[var(--m-text-tertiary)]">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-emerald-500 hover:text-emerald-400">Log in</Link>
        </p>
      }
    >
      {/* Steps */}
      {step !== "done" && (
        <ol className="mb-5 flex items-center gap-1.5" aria-label="Sign-up steps">
          {STEP_TABS.map((tab, i) => {
            const isDone = i < currentIndex;
            const isCurrent = i === currentIndex;
            return (
              <li key={tab.id} className="flex flex-1 items-center gap-1.5" aria-current={isCurrent ? "step" : undefined}>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    isDone && "bg-emerald-500 text-white",
                    isCurrent && "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/50",
                    !isDone && !isCurrent && "border border-[var(--m-border-secondary)] text-[var(--m-text-muted)]"
                  )}
                >
                  {isDone ? <Check className="size-3" /> : i + 1}
                </span>
                <span className={cn("text-[11px] font-semibold", isCurrent ? "text-emerald-500" : isDone ? "text-[var(--m-text-secondary)]" : "text-[var(--m-text-muted)]")}>{tab.label}</span>
                {i < STEP_TABS.length - 1 && <span className={cn("h-px flex-1", i < currentIndex ? "bg-emerald-500/50" : "bg-[var(--m-border-secondary)]")} />}
              </li>
            );
          })}
        </ol>
      )}

      <AnimatePresence mode="wait">
        {/* ─── STEP 1: details ─────────────────────────────────────────────── */}
        {step === "form" && (
          <motion.div key="form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <div className="mb-5">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">Create your account</h1>
              <p className="text-sm text-[var(--m-text-tertiary)]">Set up ChatNexGen for your business in a few minutes.</p>
            </div>

            <form onSubmit={handleSignupSubmit} className="flex flex-col gap-3.5">
              {error && <AuthNotice tone="error">{error}</AuthNotice>}

              <div className="grid gap-3 sm:grid-cols-2">
                <AuthField label="Full name" htmlFor="fullName">
                  <Input id="fullName" type="text" placeholder="Your name" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" autoFocus className={authInputClass} />
                </AuthField>
                <AuthField label="Work email" htmlFor="email">
                  <Input id="email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className={authInputClass} />
                </AuthField>
                <AuthField label="Mobile number" htmlFor="mobileNumber">
                  <Input id="mobileNumber" type="tel" inputMode="tel" placeholder="+91 98765 43210" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} required autoComplete="tel" className={authInputClass} />
                </AuthField>
                <AuthField label="Business category" htmlFor="businessCategory">
                  <Combobox items={BUSINESS_CATEGORIES} value={businessCategory || null} onValueChange={(value) => setBusinessCategory((value as string) ?? "")}>
                    <ComboboxInputGroup>
                      <ComboboxInput id="businessCategory" placeholder="Search category" required className={cn(authInputClass, "cursor-text pr-14")} />
                      {businessCategory && <ComboboxClear />}
                      <ComboboxTrigger />
                    </ComboboxInputGroup>
                    <ComboboxContent className="border border-[var(--m-border-secondary)] bg-[var(--m-bg-secondary)] text-[12px]">
                      <ComboboxEmpty>No category found.</ComboboxEmpty>
                      <ComboboxList>
                        {(item: string) => (
                          <ComboboxItem key={item} value={item} className="text-[12px] text-[var(--m-text-primary)]">{item}</ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </AuthField>
                <AuthField
                  label="Password"
                  htmlFor="password"
                  hint={
                    strength > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex flex-1 gap-1">
                          {[1, 2, 3].map((n) => (
                            <span key={n} className={cn("h-1 flex-1 rounded-full", strength >= n ? ["bg-rose-500", "bg-amber-500", "bg-emerald-500"][strength - 1] : "bg-[var(--m-bg-tertiary)]")} />
                          ))}
                        </div>
                        <span className="text-[10px] font-medium text-[var(--m-text-muted)]">
                          {strength === 3 ? "Strong" : strength === 2 ? "Good" : `${MIN_PASSWORD - password.length} more`}
                        </span>
                      </div>
                    ) : undefined
                  }
                >
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={`At least ${MIN_PASSWORD} characters`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className={`${authInputClass} pr-10`}
                  />
                  <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)]">
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </AuthField>
                <AuthField
                  label="Confirm password"
                  htmlFor="confirmPassword"
                  hint={passwordsMismatch ? <span className="text-[10px] font-medium text-rose-500">Passwords don&apos;t match</span> : undefined}
                >
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    aria-invalid={passwordsMismatch}
                    className={`${authInputClass} pr-10`}
                  />
                  <button type="button" onClick={() => setShowConfirmPassword((s) => !s)} aria-label={showConfirmPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)]">
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </AuthField>
              </div>

              {/* Plan */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-[var(--m-text-secondary)]">Plan</span>
                <div className="grid grid-cols-2 gap-2">
                  {PLANS.map((plan) => {
                    const active = selectedPlan.id === plan.id;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setSelectedPlan(plan)}
                        aria-pressed={active}
                        className={cn(
                          "relative rounded-lg border px-3 py-2.5 text-left transition-colors",
                          active ? "border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/30" : "border-[var(--m-border-secondary)] hover:border-emerald-500/40 hover:bg-[var(--m-bg-secondary)]/60"
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className={cn("truncate text-[12px] font-semibold", active ? "text-emerald-500" : "text-[var(--m-text-secondary)]")}>{plan.name}</span>
                          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", active ? "border-emerald-500 bg-emerald-500 text-white" : "border-[var(--m-border-secondary)]")}>
                            {active && <Check className="size-2.5" />}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[15px] font-bold text-[var(--m-text-heading)]">
                          {plan.price}<span className="text-[10px] font-medium text-[var(--m-text-muted)]">{plan.period}</span>
                        </span>
                        <span className="block truncate text-[11px] text-[var(--m-text-muted)]">{plan.tagline}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[var(--m-text-muted)]">
                  Need multiple numbers or something special? <Link href="/book-demo" className="font-semibold text-emerald-500 hover:underline">Ask for a custom plan</Link>
                </p>
              </div>

              <button type="submit" disabled={loading || passwordsMismatch} className={`mt-1 ${authPrimaryButton}`}>
                {loading ? <><Loader2 className="size-4 animate-spin" /> Creating account…</> : <>Create account <ArrowRight className="size-4" /></>}
              </button>
              <p className="text-center text-[11px] text-[var(--m-text-muted)]">
                By creating an account you agree to our <Link href="/terms-and-conditions" className="underline hover:text-[var(--m-text-secondary)]">Terms</Link> and{" "}
                <Link href="/privacy-policy" className="underline hover:text-[var(--m-text-secondary)]">Privacy Policy</Link>.
              </p>
            </form>
          </motion.div>
        )}

        {/* ─── STEP 2: email code ───────────────────────────────────────────── */}
        {step === "otp" && (
          <motion.div key="otp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <button type="button" onClick={() => { setError(null); setStep("form"); }} className="mb-4 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)]">
              <ArrowLeft className="size-3.5" /> Back
            </button>
            <div className="mb-5">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">Check your email</h1>
              <p className="text-sm text-[var(--m-text-tertiary)]">
                Enter the 6-digit code we sent to <span className="font-semibold text-[var(--m-text-primary)]">{email}</span>.
              </p>
            </div>
            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
              {error && <AuthNotice tone="error">{error}</AuthNotice>}
              <OtpInput value={otp} onChange={(next) => setOtp(next.replace(/\D/g, "").slice(0, 6))} length={6} autoFocus disabled={verifyLoading} />
              <button type="submit" disabled={verifyLoading || otp.length < 6} className={authPrimaryButton}>
                {verifyLoading ? <><Loader2 className="size-4 animate-spin" /> Verifying…</> : <>Verify email <ArrowRight className="size-4" /></>}
              </button>
              <p className="text-center text-[11px] text-[var(--m-text-muted)]">The code expires in 5 minutes. Didn&apos;t get it? Check spam, or go back and sign up again.</p>
            </form>
          </motion.div>
        )}

        {/* ─── STEP 3: payment ──────────────────────────────────────────────── */}
        {step === "payment" && (
          <motion.div key="payment" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <div className="mb-4">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">Scan &amp; pay</h1>
              <p className="text-sm text-[var(--m-text-tertiary)]">Pay by UPI, then send us the payment screenshot to activate your account.</p>
            </div>

            <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <span className="text-[12px] font-semibold text-emerald-500">{selectedPlan.name}</span>
              <span className="text-[13px] font-bold text-[var(--m-text-heading)]">{selectedPlan.price}<span className="text-[10px] font-medium text-[var(--m-text-muted)]">{selectedPlan.period}</span></span>
            </div>

            <div className="relative mx-auto size-48 overflow-hidden rounded-lg border border-[var(--m-border-secondary)] bg-white p-1.5">
              <Image src="/images/payment-qr.png" alt="UPI payment QR code" fill className="object-contain" priority unoptimized />
            </div>

            <div className="mt-4 space-y-2">
              {error && <AuthNotice tone="error">{error}</AuthNotice>}
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-emerald-500/40 bg-emerald-500/5 text-[12px] font-medium text-emerald-500 hover:border-emerald-500/70 hover:bg-emerald-500/10"
              >
                <Paperclip className="size-3.5" /> <span className="truncate">{proofFile ? proofFile.name : "Attach payment screenshot"}</span>
              </button>
              <button type="button" disabled={!proofFile || sending} onClick={handleSendProof} className={authPrimaryButton}>
                {sending ? <><Loader2 className="size-4 animate-spin" /> Sending…</> : <><CheckCircle className="size-4" /> I&apos;ve paid, send proof on WhatsApp</>}
              </button>
              <p className="text-center text-[11px] text-[var(--m-text-muted)]">WhatsApp opens with your details filled in. Attach the screenshot there and send.</p>
            </div>
          </motion.div>
        )}

        {/* ─── Done ─────────────────────────────────────────────────────────── */}
        {step === "done" && (
          <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex flex-col items-center gap-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15">
              <PartyPopper className="size-6 text-emerald-500" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">You&apos;re all set</h1>
              <p className="mt-1 text-sm text-[var(--m-text-tertiary)]">We&apos;re confirming your payment. You&apos;ll get a WhatsApp/email message when your account is active.</p>
            </div>
            <AuthNotice tone="info">Payments are usually checked within <span className="font-semibold text-[var(--m-text-primary)]">24–48 hours</span>. You can log in once your account is activated.</AuthNotice>
            <Link href="/login" className={authSecondaryButton}>
              <ArrowLeft className="size-3.5" /> Back to log in
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}