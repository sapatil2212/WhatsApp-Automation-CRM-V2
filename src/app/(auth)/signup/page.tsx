"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft, CheckCircle, Eye, EyeOff,
  QrCode, Loader2, PartyPopper, Paperclip,
  Zap, TrendingUp, Crown, Check,
} from "lucide-react";
import { InteractiveGrid } from "@/components/marketing/interactive-grid";
import { motion, AnimatePresence } from "framer-motion";

const WHATSAPP_CONTACT = "917745868073";

// ─── Pricing Plans ────────────────────────────────────────────────────────────
const PLANS = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Self-Managed Setup",
    price: "₹799",
    period: "/month",
    renewal: null,
    icon: Zap,
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
    icon: TrendingUp,
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
    icon: Crown,
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

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[var(--m-bg-primary)] py-12 px-4 overflow-y-auto select-none">
      <InteractiveGrid gridSize={40} className="opacity-20" />
      <div className="absolute top-[20%] left-[20%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[20%] w-[50%] h-[50%] rounded-full bg-teal-500/5 blur-[120px] pointer-events-none" />

      {/* Back Home */}
      <Link
        href="/"
        className="absolute top-6 left-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--m-text-tertiary)] hover:text-[var(--m-text-primary)] transition-colors bg-[var(--m-bg-secondary)]/60 border border-[var(--m-border-glass)] px-3 py-1.5 rounded-lg backdrop-blur z-20"
      >
        <ArrowLeft className="size-3.5" /> Back Home
      </Link>

      <AnimatePresence mode="wait">
        {/* ─── STEP 1: Signup Form ────────────────────────────────────────── */}
        {step === "form" && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-2xl z-10"
          >
            <Card className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-glass)]/70 backdrop-blur-xl p-6 md:p-8 shadow-none">
              <CardHeader className="items-center text-center p-0 pb-6">
                <CardTitle className="text-xl font-bold tracking-tight text-[var(--m-text-heading)]">
                  Create Account
                </CardTitle>
                <CardDescription className="text-xs text-[var(--m-text-tertiary)] mt-1">
                  Get started with CRM Template for WhatsApp
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <form onSubmit={handleSignupSubmit} className="flex flex-col gap-4">
                  {error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
                      {error}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
                    {/* Full Name */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="fullName" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Full Name</Label>
                      <Input id="fullName" type="text" placeholder="Enter your name" value={fullName} onChange={(e) => setFullName(e.target.value)} required
                        className="h-9 px-3 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-emerald-500/70 focus-visible:ring-emerald-500/10 transition-all duration-200" />
                    </div>

                    {/* Email */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="email" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Email Address</Label>
                      <Input id="email" type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required
                        className="h-9 px-3 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-emerald-500/70 focus-visible:ring-emerald-500/10 transition-all duration-200" />
                    </div>

                    {/* Mobile */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="mobileNumber" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Mobile Number</Label>
                      <Input id="mobileNumber" type="tel" placeholder="Enter mobile number" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} required
                        className="h-9 px-3 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-emerald-500/70 focus-visible:ring-emerald-500/10 transition-all duration-200" />
                    </div>

                    {/* Business Category */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="businessCategory" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Business Category</Label>
                      <div className="relative">
                        <select id="businessCategory" value={businessCategory} onChange={(e) => setBusinessCategory(e.target.value)} required
                          className="h-9 w-full rounded-md border border-[var(--m-input-border)] bg-[var(--m-input-bg)] px-3 text-[11px] text-[var(--m-text-primary)] focus-visible:border-emerald-500/70 focus-visible:ring-emerald-500/10 transition-all duration-200 outline-none cursor-pointer appearance-none pr-8 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat"
                        >
                          <option value="" disabled className="bg-slate-900 text-slate-400">Select business category</option>
                          <option value="Beauty & Personal Care" className="bg-slate-900">Beauty & Personal Care</option>
                          <option value="Health & Wellness" className="bg-slate-900">Health & Wellness</option>
                          <option value="Trades & Home Services" className="bg-slate-900">Trades & Home Services</option>
                          <option value="Professional Services" className="bg-slate-900">Professional Services</option>
                          <option value="Automotive Services" className="bg-slate-900">Automotive Services</option>
                          <option value="Medical & Allied Health" className="bg-slate-900">Medical & Allied Health</option>
                          <option value="Education & Training" className="bg-slate-900">Education & Training</option>
                          <option value="Hospitality" className="bg-slate-900">Hospitality</option>
                          <option value="Pet Services" className="bg-slate-900">Pet Services</option>
                          <option value="Other" className="bg-slate-900">Other</option>
                        </select>
                      </div>
                    </div>

                    {/* Pricing Plan Field */}
                    <div className="flex flex-col gap-1.2 sm:col-span-2">
                      <Label htmlFor="selectedPlan" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Select Plan</Label>
                      <div className="relative">
                        <select
                          id="selectedPlan"
                          value={selectedPlan.id}
                          onChange={(e) => {
                            const plan = PLANS.find((p) => p.id === e.target.value)!;
                            setSelectedPlan(plan);
                          }}
                          required
                          className="h-9 w-full rounded-md border border-[var(--m-input-border)] bg-[var(--m-input-bg)] px-3 text-[11px] text-[var(--m-text-primary)] focus-visible:border-emerald-500/70 focus-visible:ring-emerald-500/10 transition-all duration-200 outline-none cursor-pointer appearance-none pr-8 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat"
                        >
                          <option value="starter" className="bg-slate-900">Starter (₹799/month)</option>
                          <option value="growth" className="bg-slate-900">Growth (₹1,499 first month, ₹799/mo after)</option>
                          <option value="managed" className="bg-slate-900">Managed (₹2,999 pilot month, ₹799/mo after)</option>
                        </select>
                      </div>
                    </div>

                    {/* Password */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="password" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Password</Label>
                      <div className="relative">
                        <Input id="password" type={showPassword ? "text" : "password"} placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required
                          className="h-9 pl-3 pr-9 w-full border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-emerald-500/70 focus-visible:ring-emerald-500/10 transition-all duration-200" />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer" aria-label="Toggle password">
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Confirm Password */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="confirmPassword" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Confirm Password</Label>
                      <div className="relative">
                        <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} placeholder="Confirm your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
                          className="h-9 pl-3 pr-9 w-full border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-emerald-500/70 focus-visible:ring-emerald-500/10 transition-all duration-200" />
                        <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer" aria-label="Toggle confirm password">
                          {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <Button type="submit" disabled={loading}
                    className="mt-4 h-9 w-full bg-emerald-500 text-white hover:bg-emerald-400 hover:scale-[1.01] active:scale-[0.99] font-bold text-xs transition-all duration-200 border border-emerald-400/20">
                    {loading ? "Creating account..." : "Create Account & Verify OTP →"}
                  </Button>
                </form>

                <p className="mt-4.5 text-center text-[11px] text-[var(--m-text-muted)]">
                  Already have an account?{" "}
                  <Link href="/login" className="text-emerald-500 hover:text-emerald-400 font-bold transition-colors">Sign In</Link>
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ─── STEP 2: OTP Verification ───────────────────────────────────── */}
        {step === "otp" && (
          <motion.div
            key="otp"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm z-10"
          >
            <Card className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-glass)]/70 backdrop-blur-xl p-6 md:p-8 shadow-none">
              <CardHeader className="items-center text-center p-0 pb-4 relative">
                <button
                  type="button"
                  onClick={() => setStep("form")}
                  className="absolute left-0 top-0 text-[10px] font-semibold text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)] transition-colors flex items-center gap-1"
                >
                  <ArrowLeft className="size-3" /> Back
                </button>
                <CardTitle className="text-lg font-bold text-[var(--m-text-heading)]">Enter OTP Code</CardTitle>
                <CardDescription className="text-[11px] text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
                  We&apos;ve sent a 6-digit OTP code to <span className="text-[var(--m-text-primary)] font-semibold">{email}</span>.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 pt-3">
                <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3.5">
                  {error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
                      {error}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="otp" className="text-[11px] font-semibold text-[var(--m-text-secondary)] text-center">
                      6-Digit OTP Code
                    </Label>
                    <Input
                      id="otp"
                      type="text"
                      placeholder="••••••"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      required
                      className="h-10 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-center text-md font-bold tracking-[0.2em] text-[var(--m-text-primary)] focus-visible:border-emerald-500/70 focus-visible:ring-emerald-500/10 transition-all duration-200"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={verifyLoading}
                    className="h-9 w-full bg-emerald-500 text-white hover:bg-emerald-400 hover:scale-[1.01] active:scale-[0.99] font-bold text-xs transition-all duration-200 border border-emerald-400/20"
                  >
                    {verifyLoading ? "Verifying..." : "Verify & Proceed to Payment"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ─── STEP 3: Payment QR & Proof ──────────────────────────────────── */}
        {step === "payment" && (
          <motion.div
            key="payment"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm z-10"
          >
            <Card className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-glass)]/70 backdrop-blur-xl p-6 md:p-8 shadow-none flex flex-col items-center gap-4">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <QrCode className="size-5 text-emerald-400" />
                </div>
                <h2 className="text-base font-bold text-[var(--m-text-heading)]">Scan & Pay</h2>
                <p className="text-[11px] text-[var(--m-text-tertiary)] leading-relaxed">
                  Scan the QR below to pay. Then upload proof and send to activate.
                </p>
              </div>

              {/* plan badge */}
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[10px] font-bold bg-emerald-500/10 border-emerald-500/30 text-emerald-400`}>
                <selectedPlan.icon className="size-3" />
                {selectedPlan.name} Plan — {selectedPlan.price}{selectedPlan.period}
              </div>

              {/* QR Image */}
              <div className="relative w-52 h-52 rounded-2xl overflow-hidden border-2 border-white/20 shadow-lg bg-white p-1.5">
                <Image
                  src="/images/payment-qr.png"
                  alt="Payment QR Code"
                  fill
                  className="object-contain"
                  priority
                  unoptimized
                />
              </div>

              <div className="w-full space-y-2">
                {error && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400 text-center">
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
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-emerald-500/40 hover:border-emerald-500/70 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400 text-[11px] font-semibold transition-all duration-200 cursor-pointer"
                >
                  <Paperclip className="size-3.5" />
                  {proofFile ? proofFile.name : "Attach Payment Proof (Screenshot)"}
                </button>
                {proofFile && (
                  <p className="text-[10px] text-emerald-400/80 text-center">
                    ✓ {proofFile.name} ready
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={!proofFile || sending}
                onClick={handleSendProof}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-bold shadow-md hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {sending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Submitting Proof...
                  </>
                ) : (
                  <>
                    <CheckCircle className="size-3.5" />
                    Payment Done — Send Proof on WhatsApp
                  </>
                )}
              </button>
            </Card>
          </motion.div>
        )}

        {/* ─── STEP 4: Success Screen ────────────────────────────────────────── */}
        {step === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm z-10"
          >
            <Card className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-glass)]/70 backdrop-blur-xl p-8 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <PartyPopper className="size-8 text-emerald-400" />
              </div>

              <div>
                <h2 className="text-xl font-bold text-[var(--m-text-heading)]">Account Registration Done! 🎉</h2>
                <p className="text-[11px] text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
                  <span className="text-[var(--m-text-primary)] font-semibold">
                    Payment confirmation is under process.
                  </span>{" "}
                  You will get notified on your email/WhatsApp when your account gets activated.
                </p>
              </div>

              <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 text-[10px] text-emerald-300/80 leading-relaxed">
                Our team reviews payments within <span className="font-bold text-emerald-400">24–48 hours</span>.<br />
                You will not be able to log in until activated by the Super Admin.
              </div>

              <Link href="/login" className="w-full">
                <button className="w-full py-2.5 rounded-xl border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-secondary)] hover:bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)] text-[11px] font-bold transition-all">
                  Back to Sign In
                </button>
              </Link>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
