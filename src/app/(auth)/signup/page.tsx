"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import {
  Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty,
  ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList, ComboboxTrigger,
} from "@/components/ui/combobox";
import {
  ArrowLeft, ArrowRight, Briefcase, Check, CheckCircle,
  Eye, EyeOff, Loader2, Lock, Mail, Paperclip, PartyPopper, Phone,
  QrCode, Sparkles, User,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthField, authInputClass } from "@/components/auth/auth-field";
import { OtpInput } from "@/components/auth/otp-input";
import { cn } from "@/lib/utils";

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

// ─── Pricing Plans ────────────────────────────────────────────────────────────
type Plan = {
  id: string;
  name: string;
  tagline: string;
  price: string;
  period: string;
  renewal: string | null;
  icon: typeof Sparkles;
  color: string;
  popular: boolean;
  features: string[];
};

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Self-Managed Setup",
    price: "₹799",
    period: "/month",
    renewal: null,
    icon: Sparkles,
    color: "emerald",
    popular: false,
    features: [
      "Official WhatsApp Business API",
      "Visual Flow & Chatbot Builder",
      "Shared Collaborative Inbox",
      "27+ Native Integrations",
      "0% Markup on Meta API fees",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "Done-With-You Setup",
    price: "₹1,499",
    period: " first month",
    renewal: "₹799/month after",
    icon: ArrowRight,
    color: "violet",
    popular: true,
    features: [
      "Everything in Starter plan",
      "Meta Business Verification Assistance",
      "WhatsApp Co-existence Configuration",
      "Custom Integrations Wired In",
      "Dedicated Account Setup Session",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    tagline: "Done-For-You Strategy",
    price: "₹2,999",
    period: " pilot month",
    renewal: "₹799/month after",
    icon: CheckCircle,
    color: "amber",
    popular: false,
    features: [
      "Everything in Growth plan",
      "2–3 Custom Automations built for you",
      "Message Templates written & approved",
      "Dedicated Account Manager",
      "Monthly 1-on-1 Strategy Calls",
    ],
  },
];

type Step = "form" | "otp" | "payment" | "done";

const STEP_TABS = [
  { id: "form", label: "Details" },
  { id: "otp", label: "Verify" },
  { id: "payment", label: "Payment" },
] as const;

const STEP_INDEX: Record<Step, number> = { form: 0, otp: 1, payment: 2, done: 3 };

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

  const [selectedPlan, setSelectedPlan]             = useState<(typeof PLANS)[0]>(PLANS[1]); // Default Growth
  const [proofFile, setProofFile]                   = useState<File | null>(null);
  const [sending, setSending]                       = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (password.length < 6)          { setError("Password must be at least 6 characters"); return; }

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
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const currentIndex = STEP_INDEX[step];

  return (
    <AuthShell
      variant="signup"
      topRight={
        <p className="text-[var(--m-text-tertiary)]">
          Already a member?{" "}
          <Link href="/login" className="font-semibold text-emerald-500 hover:text-emerald-400">
            Sign in
          </Link>
        </p>
      }
    >
      {/* Progress stepper */}
      {step !== "done" && (
        <div className="mb-6 flex items-center gap-1.5">
          {STEP_TABS.map((tab, i) => {
            const isDone = i < currentIndex;
            const isCurrent = i === currentIndex;
            return (
              <div key={tab.id} className="flex flex-1 items-center gap-1.5">
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold transition-all duration-300",
                      isDone && "bg-emerald-500 text-white",
                      isCurrent &&
                        "border border-emerald-500/60 bg-emerald-500/15 text-emerald-400 shadow-[0_0_0_3px_rgba(16,185,129,0.1)]",
                      !isDone && !isCurrent &&
                        "border border-[var(--m-border-glass)] text-[var(--m-text-muted)]"
                    )}
                  >
                    {isDone ? <Check className="size-3" /> : i + 1}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-[0.08em] transition-colors",
                      isCurrent
                        ? "text-emerald-400"
                        : isDone
                          ? "text-[var(--m-text-secondary)]"
                          : "text-[var(--m-text-muted)]"
                    )}
                  >
                    {tab.label}
                  </span>
                </div>
                {i < STEP_TABS.length - 1 && (
                  <div
                    className={cn(
                      "h-px flex-1 transition-colors duration-300",
                      i < currentIndex ? "bg-emerald-500/50" : "bg-[var(--m-border-glass)]"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* ─── STEP 1: Signup Form ────────────────────────────────────────── */}
        {step === "form" && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.25 }}
          >
            <div className="mb-6">
              <p className="text-xs uppercase tracking-wide text-[var(--m-text-tertiary)]">Get started</p>
              <h1 className="mt-1 text-2xl font-bold text-[var(--m-text-heading)]">Create your ChatNexGen account</h1>
            </div>

            <form onSubmit={handleSignupSubmit} className="flex flex-col gap-4">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-[11px] text-red-400"
                >
                  {error}
                </motion.div>
              )}

              <div className="grid grid-cols-1 gap-3.5">
                <AuthField label="Full name" htmlFor="fullName" icon={<User className="size-4" />}>
                  <Input
                    id="fullName"
                    type="text"
                    placeholder="Enter your name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className={authInputClass}
                  />
                </AuthField>

                <AuthField label="Email address" htmlFor="email" icon={<Mail className="size-4" />}>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className={authInputClass}
                  />
                </AuthField>

                <AuthField label="Mobile number" htmlFor="mobileNumber" icon={<Phone className="size-4" />}>
                  <Input
                    id="mobileNumber"
                    type="tel"
                    placeholder="+91 00000 00000"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    required
                    className={authInputClass}
                  />
                </AuthField>

                <AuthField
                  label="Business category"
                  htmlFor="businessCategory"
                  icon={<Briefcase className="size-4" />}
                >
                  <Combobox
                    items={BUSINESS_CATEGORIES}
                    value={businessCategory || null}
                    onValueChange={(value) => setBusinessCategory((value as string) ?? "")}
                  >
                    <ComboboxInputGroup>
                      <ComboboxInput
                        id="businessCategory"
                        placeholder="Search business category"
                        required
                        className={cn(authInputClass, "cursor-text pr-14")}
                      />
                      {businessCategory && <ComboboxClear />}
                      <ComboboxTrigger />
                    </ComboboxInputGroup>
                    <ComboboxContent className="border border-[var(--m-border-glass)] bg-[var(--m-bg-secondary)] text-[11px]">
                      <ComboboxEmpty>No category found.</ComboboxEmpty>
                      <ComboboxList>
                        {(item: string) => (
                          <ComboboxItem key={item} value={item} className="text-[11px] text-[var(--m-text-primary)]">
                            {item}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </AuthField>

                <AuthField
                  label="Password"
                  htmlFor="password"
                  icon={<Lock className="size-4" />}
                  hint={
                    password.length > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex flex-1 gap-1">
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className={cn(
                                "h-1 flex-1 rounded-full transition-colors duration-300",
                                password.length >= [1, 8, 12][i]
                                  ? ["bg-red-400", "bg-amber-400", "bg-emerald-400"][i]
                                  : "bg-[var(--m-bg-tertiary)]"
                              )}
                            />
                          ))}
                        </div>
                        <span className="text-[9px] font-semibold text-[var(--m-text-muted)]">
                          {password.length >= 12 ? "Strong" : password.length >= 8 ? "Good" : "Weak"}
                        </span>
                      </div>
                    ) : undefined
                  }
                >
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={`${authInputClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label="Toggle password"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--m-text-muted)] transition-colors hover:text-[var(--m-text-primary)]"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </AuthField>

                <AuthField
                  label="Confirm password"
                  htmlFor="confirmPassword"
                  icon={<Lock className="size-4" />}
                >
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className={`${authInputClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label="Toggle confirm password"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--m-text-muted)] transition-colors hover:text-[var(--m-text-primary)]"
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </AuthField>
              </div>

              {/* Plan picker */}
              <div className="flex flex-col gap-2">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[var(--m-text-tertiary)]">
                  Select plan
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {PLANS.map((plan) => {
                    const active = selectedPlan.id === plan.id;
                    const PlanIcon = plan.icon;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setSelectedPlan(plan)}
                        aria-pressed={active}
                        className={cn(
                          "group relative overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all duration-200",
                          active
                            ? "border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_0_3px_rgba(16,185,129,0.08)]"
                            : "border-[var(--m-border-glass)] bg-[var(--m-bg-secondary)]/40 hover:border-emerald-500/30 hover:bg-[var(--m-bg-secondary)]/70"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={cn(
                              "flex items-center gap-1.5 text-[11px] font-bold",
                              active ? "text-emerald-400" : "text-[var(--m-text-secondary)]"
                            )}
                          >
                            <PlanIcon className="size-3" />
                            {plan.name}
                          </span>
                          {active && (
                            <motion.span
                              layoutId="plan-check"
                              className="flex size-3.5 items-center justify-center rounded-full bg-emerald-500 text-white"
                            >
                              <Check className="size-2.5" />
                            </motion.span>
                          )}
                        </div>
                        <p className="mt-1 text-[13px] font-extrabold text-[var(--m-text-heading)]">
                          {plan.price}
                          <span className="text-[9px] font-semibold text-[var(--m-text-muted)]">
                            {plan.period}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-[9px] text-[var(--m-text-muted)]">
                          {plan.popular ? "Most popular" : plan.tagline}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#00DF82] text-[13px] font-semibold text-slate-950 transition-colors hover:bg-[#00c673] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating account…
                  </>
                ) : (
                  "Continue"
                )}
              </button>
            </form>
          </motion.div>
        )}

        {/* ─── STEP 2: OTP Verification ───────────────────────────────────── */}
        {step === "otp" && (
          <motion.div
            key="otp"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.25 }}
            className="rounded-2xl border border-[var(--m-border-glass)] bg-[var(--m-bg-glass)]/70 p-6 backdrop-blur-xl sm:p-7"
          >
            <button
              type="button"
              onClick={() => setStep("form")}
              className="mb-5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--m-text-muted)] transition-colors hover:text-[var(--m-text-primary)]"
            >
              <ArrowLeft className="size-3" /> Back
            </button>

            <div className="mb-5 text-center">
              <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10">
                <Mail className="size-5 text-emerald-400" />
              </div>
              <h2 className="mt-3 text-[19px] font-extrabold tracking-tight text-[var(--m-text-heading)]">
                Enter OTP code
              </h2>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--m-text-tertiary)]">
                We&apos;ve sent a 6-digit code to{" "}
                <span className="font-semibold text-[var(--m-text-primary)]">{email}</span>
              </p>
            </div>

            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-[11px] text-red-400">
                  {error}
                </div>
              )}

              <OtpInput
                value={otp}
                onChange={(next) => setOtp(next.replace(/\D/g, "").slice(0, 6))}
                length={6}
                autoFocus
                disabled={verifyLoading}
              />

              <button
                type="submit"
                disabled={verifyLoading || otp.length < 6}
                className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-[12.5px] font-bold text-white shadow-[0_12px_30px_-12px_rgba(16,185,129,0.9)] transition-all duration-200 hover:from-emerald-400 hover:to-teal-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifyLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  <>
                    Verify &amp; Proceed to Payment
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </form>
          </motion.div>
        )}

        {/* ─── STEP 3: Payment QR & Proof ──────────────────────────────────── */}
        {step === "payment" && (
          <motion.div
            key="payment"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.25 }}
            className="rounded-2xl border border-[var(--m-border-glass)] bg-[var(--m-bg-glass)]/70 p-6 backdrop-blur-xl sm:p-7"
          >
            <div className="mb-5 flex flex-col items-center gap-2 text-center">
              <div className="flex size-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10">
                <QrCode className="size-5 text-emerald-400" />
              </div>
              <h2 className="text-[19px] font-extrabold tracking-tight text-[var(--m-text-heading)]">
                Scan &amp; pay
              </h2>
              <p className="text-[11px] leading-relaxed text-[var(--m-text-tertiary)]">
                Scan the QR below to pay. Then upload proof and send it to activate.
              </p>
            </div>

            {/* plan badge */}
            <div className="mx-auto mb-4 flex w-fit items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold text-emerald-400">
              <selectedPlan.icon className="size-3" />
              {selectedPlan.name} Plan — {selectedPlan.price}{selectedPlan.period}
            </div>

            {/* QR Image */}
            <div className="relative mx-auto size-52 overflow-hidden rounded-2xl border-2 border-white/20 bg-white p-1.5 shadow-lg">
              <Image
                src="/images/payment-qr.png"
                alt="Payment QR Code"
                fill
                className="object-contain"
                priority
                unoptimized
              />
            </div>

            <div className="mt-4 w-full space-y-2">
              {error && (
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-[11px] text-red-400">
                  {error}
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 px-4 py-2.5 text-[11px] font-semibold text-emerald-400 transition-all duration-200 hover:border-emerald-500/70 hover:bg-emerald-500/10"
              >
                <Paperclip className="size-3.5" />
                {proofFile ? proofFile.name : "Attach Payment Proof (Screenshot)"}
              </button>
              {proofFile && (
                <p className="text-center text-[10px] text-emerald-400/80">
                  ✓ {proofFile.name} ready
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={!proofFile || sending}
              onClick={handleSendProof}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-[12px] font-bold text-white shadow-[0_12px_30px_-12px_rgba(16,185,129,0.9)] transition-all duration-200 hover:from-emerald-400 hover:to-teal-400 hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Submitting Proof…
                </>
              ) : (
                <>
                  <CheckCircle className="size-4" />
                  Payment Done — Send Proof on WhatsApp
                </>
              )}
            </button>
          </motion.div>
        )}

        {/* ─── STEP 4: Success Screen ────────────────────────────────────────── */}
        {step === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.25 }}
            className="rounded-2xl border border-[var(--m-border-glass)] bg-[var(--m-bg-glass)]/70 p-7 backdrop-blur-xl flex flex-col items-center gap-4 text-center"
          >
            <motion.div
              initial={{ scale: 0.6, rotate: -12 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 16 }}
              className="flex size-16 items-center justify-center rounded-2xl border border-emerald-500/25 bg-emerald-500/10"
            >
              <PartyPopper className="size-8 text-emerald-400" />
            </motion.div>

            <div>
              <h2 className="text-[20px] font-extrabold tracking-tight text-[var(--m-text-heading)]">
                Registration complete! 🎉
              </h2>
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--m-text-tertiary)]">
                <span className="font-semibold text-[var(--m-text-primary)]">
                  Payment confirmation is under process.
                </span>{" "}
                You will get notified on your email/WhatsApp when your account gets activated.
              </p>
            </div>

            <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 text-[10px] leading-relaxed text-emerald-300/80">
              Our team reviews payments within{" "}
              <span className="font-bold text-emerald-400">24–48 hours</span>.<br />
              You will not be able to log in until activated by the Super Admin.
            </div>

            <Link href="/login" className="w-full">
              <span className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-secondary)] py-2.5 text-[11px] font-bold text-[var(--m-text-secondary)] transition-all hover:bg-[var(--m-bg-tertiary)]">
                <ArrowLeft className="size-3.5" />
                Back to Sign In
              </span>
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
