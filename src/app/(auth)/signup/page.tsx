"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { CategoryPicker } from "@/components/auth/category-picker";
import { ArrowLeft, ArrowRight, Check, CheckCircle, Eye, EyeOff, Loader2, PartyPopper, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthField, AuthNotice, authInputClass, authPrimaryButton } from "@/components/auth/auth-field";
import { OtpInput } from "@/components/auth/otp-input";
import { cn } from "@/lib/utils";
import { formatPaise, planById, SELF_SERVE_PLANS } from "@/lib/billing/plans";
import { PromoCodeField, type AppliedPromo } from "@/components/auth/promo-code-field";
import { SignupCheckout } from "@/components/auth/signup-checkout";

const WHATSAPP_CONTACT = "917745868073";

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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type FieldKey = "fullName" | "email" | "mobileNumber" | "businessCategory" | "password" | "confirmPassword";
const FIELD_ORDER: FieldKey[] = ["fullName", "email", "mobileNumber", "businessCategory", "password", "confirmPassword"];

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
    // Read after mount so the server render and first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (match) setSelectedPlan(match);
  }, []);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [emailTaken, setEmailTaken] = useState(false);
  /** Updates a field and clears its error as soon as the user edits it. */
  const edit = <T,>(key: FieldKey, setter: (v: T) => void) => (v: T) => {
    setter(v);
    setFieldErrors((f) => (f[key] ? { ...f, [key]: undefined } : f));
    if (key === "email") setEmailTaken(false);
  };
  const showErrors = (errs: Partial<Record<FieldKey, string>>) => {
    setFieldErrors(errs);
    const first = FIELD_ORDER.find((k) => errs[k]);
    if (first) document.getElementById(first)?.focus();
  };

  // Promo code (preview on the form; the server applies it again at checkout).
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  // Offer pop-ups link to /signup?promo=CODE.
  const [linkPromo, setLinkPromo] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("promo");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL is read after mount (see above)
    if (code) setLinkPromo(code.slice(0, 40));
  }, []);
  const [activated, setActivated] = useState<"paid" | "free" | null>(null);
  const handleActivated = useCallback((kind: "paid" | "free") => {
    setActivated(kind);
    setStep("done");
  }, []);

  const supabase = createClient();

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const errs: Partial<Record<FieldKey, string>> = {};
    if (fullName.trim().length < 2) errs.fullName = "Enter your full name.";
    if (!email.trim()) errs.email = "Enter your work email.";
    else if (!EMAIL_RE.test(email.trim())) errs.email = "Enter a valid email, like you@company.com.";
    if (mobileNumber.replace(/\D/g, "").length < 10) errs.mobileNumber = "Enter a valid mobile number.";
    if (!businessCategory) errs.businessCategory = "Choose your business category.";
    if (!password) errs.password = "Create a password.";
    else if (password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (!confirmPassword) errs.confirmPassword = "Re-enter your password.";
    else if (password !== confirmPassword) errs.confirmPassword = "Passwords don't match.";
    if (Object.keys(errs).length) return showErrors(errs);
    setFieldErrors({});

    setLoading(true);

    const { data, error: signupError } = await supabase.auth.signUp({
      email: email.trim(),
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
      // Errors about one field go under that field; anything else above the form.
      const { field, code } = signupError as { field?: string; code?: string };
      if (field && (FIELD_ORDER as string[]).includes(field)) {
        showErrors({ [field]: signupError.message });
        setEmailTaken(code === "email_taken");
      } else {
        setError(signupError.message);
      }
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

            <form onSubmit={handleSignupSubmit} className="flex flex-col gap-3.5" noValidate>
              {error && <AuthNotice tone="error">{error}</AuthNotice>}

              <div className="grid gap-3 sm:grid-cols-2">
                <AuthField label="Full name" htmlFor="fullName" error={fieldErrors.fullName}>
                  <Input id="fullName" type="text" placeholder="Your name" value={fullName} onChange={(e) => edit("fullName", setFullName)(e.target.value)} aria-invalid={Boolean(fieldErrors.fullName)} aria-describedby={fieldErrors.fullName ? "fullName-error" : undefined} required autoComplete="name" autoFocus className={authInputClass} />
                </AuthField>
                <AuthField
                  label="Work email"
                  htmlFor="email"
                  error={
                    fieldErrors.email &&
                    (emailTaken ? (
                      <>
                        {fieldErrors.email}{" "}
                        <Link href={`/login?email=${encodeURIComponent(email.trim())}`} className="underline underline-offset-2 hover:text-rose-400">Log in instead</Link>
                      </>
                    ) : (
                      fieldErrors.email
                    ))
                  }
                >
                  <Input id="email" type="email" placeholder="you@company.com" value={email} onChange={(e) => edit("email", setEmail)(e.target.value)} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "email-error" : undefined} required autoComplete="email" className={authInputClass} />
                </AuthField>
                <AuthField label="Mobile number" htmlFor="mobileNumber" error={fieldErrors.mobileNumber}>
                  <Input id="mobileNumber" type="tel" inputMode="tel" placeholder="+91 98765 43210" value={mobileNumber} onChange={(e) => edit("mobileNumber", setMobileNumber)(e.target.value)} aria-invalid={Boolean(fieldErrors.mobileNumber)} aria-describedby={fieldErrors.mobileNumber ? "mobileNumber-error" : undefined} required autoComplete="tel" className={authInputClass} />
                </AuthField>
                <AuthField label="Business category" htmlFor="businessCategory" error={fieldErrors.businessCategory}>
                  <CategoryPicker id="businessCategory" value={businessCategory} onChange={edit("businessCategory", setBusinessCategory)} triggerClassName={cn(authInputClass, "cursor-pointer")} />
                </AuthField>
                <AuthField
                  label="Password"
                  htmlFor="password"
                  error={fieldErrors.password}
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
                    onChange={(e) => edit("password", setPassword)(e.target.value)}
                    required
                    autoComplete="new-password"
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? "password-error" : undefined}
                    className={`${authInputClass} pr-10`}
                  />
                  <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)]">
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </AuthField>
                <AuthField
                  label="Confirm password"
                  htmlFor="confirmPassword"
                  error={fieldErrors.confirmPassword ?? (passwordsMismatch ? "Passwords don't match." : undefined)}
                >
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => edit("confirmPassword", setConfirmPassword)(e.target.value)}
                    required
                    autoComplete="new-password"
                    aria-invalid={passwordsMismatch || Boolean(fieldErrors.confirmPassword)}
                    aria-describedby={passwordsMismatch || fieldErrors.confirmPassword ? "confirmPassword-error" : undefined}
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

              {/* Promo code + total */}
              <div className="flex flex-col gap-2">
                <PromoCodeField plan={selectedPlan.id} email={email} value={appliedPromo} onChange={setAppliedPromo} initialCode={linkPromo} />
                {appliedPromo && (
                  <div className="flex items-center justify-between rounded-lg bg-[var(--m-bg-secondary)] px-3 py-2 text-[12px]">
                    <span className="text-[var(--m-text-secondary)]">
                      Total for the first month{" "}
                      <span className="text-[var(--m-text-muted)] line-through">{formatPaise(appliedPromo.originalPaise)}</span>
                    </span>
                    <span className="text-[15px] font-bold text-[var(--m-text-heading)]">{formatPaise(appliedPromo.finalPaise)}</span>
                  </div>
                )}
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
              <div className="flex flex-col gap-1.5">
                <OtpInput value={otp} onChange={(next) => { setOtp(next.replace(/\D/g, "").slice(0, 6)); if (error) setError(null); }} length={6} autoFocus disabled={verifyLoading} />
                {error && <p role="alert" className="text-center text-[11px] font-medium text-rose-500">{error}</p>}
              </div>
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
              <h1 className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">Complete your payment</h1>
              <p className="text-sm text-[var(--m-text-tertiary)]">Pay securely and your workspace is activated instantly.</p>
            </div>
            {registeredUserId ? (
              <SignupCheckout
                userId={registeredUserId}
                plan={selectedPlan.id}
                planName={selectedPlan.name}
                promoCode={appliedPromo?.code ?? null}
                onActivated={handleActivated}
              />
            ) : (
              <AuthNotice tone="error">Your session expired. Please sign up again.</AuthNotice>
            )}
            <p className="mt-3 text-center text-[11px] text-[var(--m-text-muted)]">
              Payment trouble?{" "}
              <a href={`https://wa.me/${WHATSAPP_CONTACT}?text=${encodeURIComponent(`Hello! I need help paying for my ChatNexGen account (${email.trim()}).`)}`} target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-500 hover:text-emerald-400">
                Chat with us on WhatsApp
              </a>
            </p>
          </motion.div>
        )}

        {/* ─── Done ─────────────────────────────────────────────────────────── */}
        {step === "done" && (
          <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex flex-col items-center gap-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15">
              <PartyPopper className="size-6 text-emerald-500" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">Your workspace is active</h1>
              <p className="mt-1 text-sm text-[var(--m-text-tertiary)]">
                {activated === "free" ? "Your promo code covered the full amount." : "Payment received, thank you."} We&apos;ve emailed your receipt and login details to {email}.
              </p>
            </div>
            <Link href={`/login?email=${encodeURIComponent(email.trim())}`} className={authPrimaryButton}>
              Log in to your dashboard <ArrowRight className="size-4" />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}