"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Sparkles, CheckCircle, KeyRound, Loader2, Eye, EyeOff, ChevronDown } from "lucide-react";
import { InteractiveGrid } from "@/components/marketing/interactive-grid";
import { useTheme } from "@/hooks/use-theme";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

type SignupStep = "details" | "otp" | "success";

const containerVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.2, ease: "easeIn" } },
} as const;

const shakeVariants = {
  idle: { x: 0 },
  shake: {
    x: [-6, 6, -5, 5, -3, 3, -1, 1, 0],
    transition: { duration: 0.35, ease: "easeInOut" as const },
  },
};

const checkmarkPathVariants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { type: "spring", stiffness: 90, damping: 13, delay: 0.25 },
      opacity: { duration: 0.1, delay: 0.25 },
    },
  },
} as const;

const stepsList = [
  { step: "details", label: "Details" },
  { step: "otp", label: "Verify" },
  { step: "success", label: "Done" },
];

const businessTypes = [
  { value: "Healthcare/medical", label: "Healthcare / Medical" },
  { value: "education", label: "Education" },
  { value: "hotel/restaurants", label: "Hotel / Restaurants" },
  { value: "other", label: "Other" },
];

export default function SignupPage() {
  const { mode } = useTheme();
  const isLight = mode === "light";
  const router = useRouter();

  const [step, setStep] = useState<SignupStep>("details");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [focusedOtpIndex, setFocusedOtpIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const supabase = createClient();

  // Password Validation
  const isLengthValid = password.length >= 6;
  const isMatchValid = password === confirmPassword && password.length > 0;
  const isPasswordFormValid = isLengthValid && isMatchValid;

  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isPasswordFormValid) {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
      } else {
        setError("Password must be at least 6 characters");
      }
      return;
    }

    if (!businessType) {
      setError("Please select your business type");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", email }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Failed to send verification code.");
        setLoading(false);
        return;
      }

      setLoading(false);
      setStep("otp");
      setResendTimer(60);
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendTimer > 0) return;
    setError(null);
    setResendTimer(60);

    try {
      const res = await fetch("/api/auth/register-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", email }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Failed to resend code.");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    if (value && !/^\d$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    const fullCode = newOtp.join("");
    if (fullCode.length === 6 && /^\d{6}$/.test(fullCode)) {
      handleRegister(fullCode);
    }
  };

  const handleOtpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace") {
      const newOtp = [...otp];

      if (newOtp[index]) {
        newOtp[index] = "";
        setOtp(newOtp);
      } else if (index > 0) {
        newOtp[index - 1] = "";
        setOtp(newOtp);
        inputRefs.current[index - 1]?.focus();
      }
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text");
    const digits = pastedData.replace(/\D/g, "").slice(0, 6);

    if (digits.length > 0) {
      const newOtp = [...otp];
      for (let i = 0; i < 6; i++) {
        newOtp[i] = digits[i] || "";
      }
      setOtp(newOtp);

      const targetIndex = Math.min(digits.length - 1, 5);
      inputRefs.current[targetIndex]?.focus();

      if (digits.length === 6) {
        handleRegister(digits);
      }
    }
  };

  const handleRegister = async (code: string) => {
    setError(null);
    setLoading(true);
    setIsShaking(false);

    try {
      const res = await fetch("/api/auth/register-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          email,
          fullName,
          businessName,
          businessType,
          password,
          code,
        }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Registration failed.");
        setLoading(false);
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
        return;
      }

      // Automatically sign in the user
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginErr) {
        console.error("Auto-login failed:", loginErr);
        setError("Account created, but automatic sign-in failed. Please login manually.");
        setLoading(false);
        setStep("success");
        return;
      }

      setLoading(false);
      setStep("success");
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[var(--m-bg-primary)] px-4 overflow-hidden select-none">
      <InteractiveGrid gridSize={40} className="opacity-20" />
      <div className="absolute top-[20%] left-[20%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[20%] w-[50%] h-[50%] rounded-full bg-teal-500/5 blur-[120px] pointer-events-none" />

      <Link
        href="/"
        className="absolute top-6 left-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--m-text-tertiary)] hover:text-[var(--m-text-primary)] transition-colors bg-[var(--m-bg-secondary)]/60 border border-[var(--m-border-glass)] px-3 py-1.5 rounded-lg backdrop-blur"
      >
        <ArrowLeft className="size-3.5" /> Back Home
      </Link>

      <Card className="w-full max-w-lg border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] shadow-[var(--m-shadow-card)] backdrop-blur-xl relative z-10 p-2 overflow-hidden transition-all duration-300">
        {/* Step Progress Bar */}
        <div className="px-6 pt-4 pb-2 border-b border-[var(--m-border-primary)]/40 bg-[var(--m-bg-primary)]/50 rounded-t-xl">
          <div className="flex justify-between items-start relative max-w-xs mx-auto">
            <div className="absolute left-3 right-3 top-3 h-[2px] bg-slate-800/80 z-0" />
            <motion.div
              className="absolute left-3 top-3 h-[2px] bg-emerald-500 z-0"
              initial={{ width: "0%" }}
              animate={{
                width: step === "details" ? "0%" : step === "otp" ? "50%" : "100%",
              }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
            />

            {stepsList.map((item, index) => {
              const isActive =
                item.step === step ||
                (step === "otp" && index < 1) ||
                (step === "success" && index < 2);
              const isCurrent = item.step === step;

              return (
                <div key={item.step} className="flex flex-col items-center z-10 relative">
                  <motion.div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all duration-300",
                      isCurrent
                        ? "bg-slate-900 border-emerald-500 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                        : isActive
                        ? "bg-emerald-500 border-emerald-500 text-slate-950"
                        : "bg-slate-900 border-slate-800 text-slate-500"
                    )}
                    animate={{ scale: isCurrent ? 1.1 : 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    {isActive && item.step !== step ? "✓" : index + 1}
                  </motion.div>
                  <span
                    className={cn(
                      "text-[10px] font-semibold mt-1 transition-colors duration-300",
                      isCurrent ? "text-white" : isActive ? "text-slate-400" : "text-slate-600"
                    )}
                  >
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {step === "details" && (
            <motion.div
              key="details"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-full"
            >
              <div className="flex flex-col items-center text-center pb-3 pt-5 px-6">
                <CardTitle className="text-xl font-bold tracking-tight text-[var(--m-text-heading)] flex items-center gap-1.5 justify-center">
                  Create Account <Sparkles className="size-4 text-emerald-400" />
                </CardTitle>
                <CardDescription className="text-xs text-[var(--m-text-tertiary)] mt-1">
                  Get started with CRM Template for WhatsApp
                </CardDescription>
              </div>
              <CardContent className="px-6 pb-6 pt-2">
                <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
                  {error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
                      {error}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="fullName" className="text-xs font-bold text-[var(--m-text-secondary)]">
                        Full Name
                      </Label>
                      <Input
                        id="fullName"
                        type="text"
                        placeholder="John Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        className="h-9.5 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 px-3 rounded-lg"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="email" className="text-xs font-bold text-[var(--m-text-secondary)]">
                        Email Address
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="h-9.5 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 px-3 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="businessName" className="text-xs font-bold text-[var(--m-text-secondary)]">
                        Business Name
                      </Label>
                      <Input
                        id="businessName"
                        type="text"
                        placeholder="My Company"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        required
                        className="h-9.5 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 px-3 rounded-lg"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs font-bold text-[var(--m-text-secondary)]">
                        Select Business Type
                      </Label>
                      <div className="relative w-full" ref={dropdownRef}>
                        <button
                          type="button"
                          onClick={() => setDropdownOpen(!dropdownOpen)}
                          className={cn(
                            "h-9.5 w-full flex items-center justify-between border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs rounded-lg px-3 outline-none transition-all text-left cursor-pointer",
                            dropdownOpen ? "border-emerald-500 ring-2 ring-emerald-500/20" : "hover:border-[var(--m-border-primary)]"
                          )}
                        >
                          <span className={businessType ? "text-[var(--m-text-primary)]" : "text-[var(--m-text-muted)]"}>
                            {businessType
                              ? businessTypes.find((t) => t.value === businessType)?.label
                              : "Select type..."}
                          </span>
                          <ChevronDown className={cn("size-4 text-slate-500 transition-transform duration-200", dropdownOpen && "rotate-180")} />
                        </button>

                        <AnimatePresence>
                          {dropdownOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.15, ease: "easeOut" }}
                              className="absolute top-[calc(100%+4px)] left-0 w-full z-50 rounded-lg border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)] shadow-xl overflow-hidden py-1"
                            >
                              {businessTypes.map((type) => {
                                const isSelected = businessType === type.value;
                                return (
                                  <button
                                    key={type.value}
                                    type="button"
                                    onClick={() => {
                                      setBusinessType(type.value);
                                      setDropdownOpen(false);
                                    }}
                                    className={cn(
                                      "w-full text-left px-3 py-2 text-xs transition-colors block cursor-pointer",
                                      isSelected
                                        ? "bg-emerald-500/10 text-emerald-400 font-semibold"
                                        : "text-[var(--m-text-primary)] hover:bg-emerald-500 hover:text-slate-950"
                                    )}
                                  >
                                    {type.label}
                                  </button>
                                );
                              })}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="password" className="text-xs font-bold text-[var(--m-text-secondary)]">
                        Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="h-9.5 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 pr-10 px-3 rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="confirmPassword" className="text-xs font-bold text-[var(--m-text-secondary)]">
                        Confirm Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          className="h-9.5 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 pr-10 px-3 rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Password indicators removed for clean signup interface */}

                  <Button
                    type="submit"
                    disabled={loading || !isPasswordFormValid}
                    className="mt-2 h-10 w-full bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:scale-[1.005] active:scale-[0.995] font-bold text-xs transition-all shadow-[0_0_12px_rgba(16,185,129,0.18)] disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" /> Sending...
                      </span>
                    ) : (
                      "Send OTP Code"
                    )}
                  </Button>
                </form>

                <p className="mt-5 text-center text-xs text-[var(--m-text-muted)]">
                  Already have an account?{" "}
                  <Link href="/login" className="text-emerald-500 hover:text-emerald-400 font-bold">
                    Sign In
                  </Link>
                </p>
              </CardContent>
            </motion.div>
          )}

          {step === "otp" && (
            <motion.div
              key="otp"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-full"
            >
              <div className="flex flex-col items-center text-center pb-3 pt-5 px-6">
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <KeyRound className="h-6 w-6" />
                </div>
                <CardTitle className="text-xl font-bold tracking-tight text-[var(--m-text-heading)]">
                  Enter OTP Code
                </CardTitle>
                <CardDescription className="text-xs text-[var(--m-text-tertiary)] mt-1">
                  We&apos;ve sent a 6-digit verification code to <span className="text-white font-medium">{email}</span>.
                </CardDescription>
              </div>
              <CardContent className="flex flex-col items-center px-6 pb-6">
                {error && (
                  <div className="w-full mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
                    {error}
                  </div>
                )}

                <motion.div
                  className="flex gap-2.5 justify-center my-4"
                  variants={shakeVariants}
                  animate={isShaking ? "shake" : "idle"}
                >
                  {otp.map((val, idx) => {
                    const isBoxFocused = focusedOtpIndex === idx;
                    return (
                      <motion.input
                        key={idx}
                        ref={(el) => {
                          inputRefs.current[idx] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        value={val}
                        onFocus={() => setFocusedOtpIndex(idx)}
                        onBlur={() => setFocusedOtpIndex(null)}
                        onChange={(e) => handleOtpChange(e.target.value, idx)}
                        onKeyDown={(e) => handleOtpKeyDown(e, idx)}
                        onPaste={idx === 0 ? handleOtpPaste : undefined}
                        className={cn(
                          "h-11 w-11 flex-shrink-0 rounded-xl border text-center text-xl font-bold transition-all focus:outline-none focus:ring-2",
                          error
                            ? "border-red-500 focus:border-red-500 focus:ring-red-500/20 text-red-400"
                            : isBoxFocused
                            ? "border-emerald-500 bg-slate-800 text-white ring-2 ring-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.25)] scale-105"
                            : val
                            ? "border-emerald-500/80 bg-slate-800 text-white focus:border-emerald-500 focus:ring-emerald-500/20"
                            : "border-slate-700 bg-slate-800 text-slate-400 focus:border-emerald-500 focus:ring-emerald-500/20"
                        )}
                        style={{ width: "44px", height: "44px" }}
                        whileFocus={{ scale: 1.05 }}
                        transition={{ duration: 0.12 }}
                        disabled={loading}
                      />
                    );
                  })}
                </motion.div>

                {loading && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 my-2">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                    Registering account...
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-3 items-center w-full">
                  <button
                    onClick={handleResendOtp}
                    disabled={resendTimer > 0}
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wider transition-colors",
                      resendTimer > 0
                        ? "text-slate-500 cursor-not-allowed"
                        : "text-emerald-500 hover:text-emerald-400 cursor-pointer"
                    )}
                  >
                    {resendTimer > 0 ? `Resend Code in ${resendTimer}s` : "Resend OTP Code"}
                  </button>

                  <button
                    onClick={() => {
                      setError(null);
                      setStep("details");
                    }}
                    className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors mt-1"
                  >
                    <ArrowLeft className="h-4 w-4" /> Change Details
                  </button>
                </div>
              </CardContent>
            </motion.div>
          )}

          {step === "success" && (
            <motion.div
              key="success"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-full flex flex-col items-center text-center px-6 py-6"
            >
              {/* Checkmark Circle */}
              <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 shadow-lg shadow-emerald-500/10">
                <div className="absolute inset-0 rounded-full bg-emerald-500/5 blur-xl animate-pulse" />
                <motion.div
                  className="absolute h-24 w-24 rounded-full border border-emerald-500/10"
                  initial={{ scale: 0.8, opacity: 0.8 }}
                  animate={{ scale: 1.25, opacity: 0 }}
                  transition={{ delay: 0.25, duration: 1.1, repeat: Infinity, ease: "easeOut" }}
                />

                {/* Confetti Sparks */}
                {Array.from({ length: 12 }).map((_, i) => {
                  const angle = (i * 360) / 12;
                  const distance = 40 + Math.random() * 20;
                  const x = Math.cos((angle * Math.PI) / 180) * distance;
                  const y = Math.sin((angle * Math.PI) / 180) * distance;
                  return (
                    <motion.div
                      key={i}
                      className="absolute h-1.5 w-1.5 rounded-full bg-emerald-500/80"
                      initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                      animate={{
                        x,
                        y,
                        scale: [0, 1, 0.8, 0],
                        opacity: [1, 1, 0.4, 0],
                      }}
                      transition={{
                        delay: 0.35,
                        duration: 0.7 + Math.random() * 0.35,
                        ease: "easeOut",
                      }}
                    />
                  );
                })}

                <svg
                  className="h-9 w-9 text-emerald-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <motion.path
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                    variants={checkmarkPathVariants}
                    initial="hidden"
                    animate="visible"
                  />
                </svg>
              </div>

              <h2 className="text-2xl font-extrabold text-[var(--m-text-heading)] tracking-tight mb-2">
                Registration Successful
              </h2>
              <p className="text-xs text-[var(--m-text-tertiary)] max-w-sm mb-6 leading-relaxed">
                Your email has been verified and your account has been successfully created. Welcome aboard!
              </p>

              <div className="w-full px-2">
                <motion.div whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }} className="w-full">
                  <Button
                    onClick={() => router.push("/dashboard")}
                    className="w-full h-10 bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-bold rounded-xl shadow-lg transition-all duration-300 border-none text-xs"
                  >
                    Go to Dashboard
                  </Button>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}
