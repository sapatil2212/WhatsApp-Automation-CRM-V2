"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  CheckCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Paperclip,
  PartyPopper,
  QrCode,
  Sparkles,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthField, authInputClass } from "@/components/auth/auth-field";

const WHATSAPP_CONTACT = "917745868073";

// ─── Renewal Payment QR Modal ──────────────────────────────────────────────────
function RenewalModal({
  userId,
  userEmail,
  onClose,
}: {
  userId: string;
  userEmail: string;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [sending, setSending]     = useState(false);
  const [done, setDone]           = useState(false);
  const [error, setError]         = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProofFile(e.target.files?.[0] ?? null);
  };

  const handleSendProof = async () => {
    setSending(true);
    setError("");

    try {
      // Mark payment proof as attached for renewal
      const res = await fetch("/api/auth/payment-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) throw new Error("Could not submit renewal status.");

      const message = encodeURIComponent(
        `🧾 *Subscription Renewal Proof*\n\n` +
        `Hello! My subscription ended and I have completed renewal payment.\n\n` +
        `*Email:* ${userEmail}\n` +
        `*Proof File:* ${proofFile?.name ?? "Attached"}\n\n` +
        `Please reactivate my workspace. Thank you! 🙏`
      );

      await new Promise((r) => setTimeout(r, 650));
      window.open(`https://wa.me/${WHATSAPP_CONTACT}?text=${message}`, "_blank");
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Failed to submit renewal proof.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/75 backdrop-blur-md"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="relative w-full max-w-sm rounded-2xl border border-[var(--m-border-glass)]/50 bg-[var(--m-bg-glass)]/95 backdrop-blur-2xl shadow-2xl overflow-hidden z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {!done && (
          <button
            onClick={onClose}
            className="absolute top-3.5 right-3.5 z-10 w-7 h-7 rounded-xl flex items-center justify-center text-[var(--m-text-muted)] hover:bg-white/10 hover:text-[var(--m-text-primary)] transition-all duration-200 cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        )}

        {!done ? (
          <div className="p-6 flex flex-col items-center gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <QrCode className="size-5 text-emerald-400" />
              </div>
              <h2 className="text-base font-bold text-[var(--m-text-heading)]">Renew Subscription</h2>
              <p className="text-[11px] text-[var(--m-text-tertiary)] leading-relaxed">
                Scan the QR code below to pay. Upload your confirmation screenshot to activate your account.
              </p>
            </div>

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
                <p className="text-[10px] text-red-400 text-center font-bold">{error}</p>
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
                {proofFile ? proofFile.name : "Attach Payment Screenshot"}
              </button>
              {proofFile && (
                <p className="text-[10px] text-emerald-400/80 text-center">
                  ✓ {proofFile.name} attached
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
                  Sending Renewal proof...
                </>
              ) : (
                <>
                  <CheckCircle className="size-3.5" />
                  Pay Done — Submit Screenshot
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="p-8 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <PartyPopper className="size-8 text-emerald-400" />
            </div>

            <div>
              <h2 className="text-lg font-bold text-[var(--m-text-heading)]">Renewal Submitted! 🎉</h2>
              <p className="text-[11px] text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
                Your payment proof is successfully submitted. You will be notified on WhatsApp/email once your subscription is reactivated.
              </p>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl border border-[var(--m-border-glass)]/45 bg-[var(--m-bg-secondary)] hover:bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)] text-[11px] font-bold transition-all"
            >
              Close
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function LoginPageInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  // Renewal state
  const [showRenewalModal, setShowRenewalModal] = useState(false);
  const [expiredUserId, setExpiredUserId]       = useState<string | null>(null);

  const isVerified = searchParams.get("verified") === "true";
  const errorParam = searchParams.get("error");
  const redirectTo = searchParams.get("redirect") || "/dashboard";

  // ── Check if user already has an active session ───────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          return res.json().then((data) => {
            if (!cancelled && data?.user) {
              router.replace(redirectTo);
            } else {
              setCheckingSession(false);
            }
          });
        } else {
          if (!cancelled) setCheckingSession(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, redirectTo]);

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--m-bg-primary)]">
        <Loader2 className="size-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  // ── Handle login ───────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // First, fetch the login endpoint directly to check subscription/verification status
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      let data: any = {};
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = await res.json().catch(() => ({}));
      } else {
        const text = await res.text().catch(() => "");
        throw new Error(
          res.status === 404
            ? "Authentication endpoint not available. Please refresh the page and verify your connection."
            : `Authentication error (${res.status}): ${text.slice(0, 100) || "Invalid server response"}`
        );
      }

      if (!res.ok) {
        // If subscription is expired, display the QR renewal modal
        if (data.error === "subscription_expired") {
          // If we have user ID in response, save it
          if (data.userId) {
            setExpiredUserId(data.userId);
          } else {
            // Find user ID from database or use email
            try {
              const usersRes = await fetch("/api/super-admin/users"); // fallback search
              if (usersRes.ok) {
                const usersData = await usersRes.json();
                const matched = usersData.users?.find((u: any) => u.email.toLowerCase() === email.toLowerCase());
                if (matched) setExpiredUserId(matched.id);
              }
            } catch (err) {
              console.error(err);
            }
          }
          setError("Your subscription has ended. Please renew using the Subscribe Now option below.");
          setLoading(false);
          return;
        }
        setError(data.message || data.error || "Invalid email or password");
        setLoading(false);
        return;
      }

      // Now authenticate via Supabase
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      router.replace(redirectTo);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <>
      <AuthShell
        variant="login"
        topRight={
          <p className="text-[var(--m-text-tertiary)]">
            Not a member yet?{" "}
            <Link href="/signup" className="font-semibold text-emerald-500 hover:text-emerald-400">
              Sign up
            </Link>
          </p>
        }
      >
        <div>
          <div className="mb-8">
            <p className="text-xs uppercase tracking-wide text-[var(--m-text-tertiary)]">Welcome back</p>
            <h1 className="mt-1 text-2xl font-bold text-[var(--m-text-heading)]">Log in to ChatNexGen</h1>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {isVerified && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-400"
              >
                <CheckCircle className="mt-px size-3.5 shrink-0" />
                Email verified successfully! You can now sign in.
              </motion.div>
            )}
            {errorParam && (
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-[11px] text-red-400">
                {errorParam === "invalid-verification-token"
                  ? "Invalid or expired verification link."
                  : "Email verification failed."}
              </div>
            )}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-red-400"
              >
                {error}
                {error.includes("subscription has ended") && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!expiredUserId) {
                        try {
                          const uRes = await fetch("/api/super-admin/users");
                          if (uRes.ok) {
                            const uData = await uRes.json();
                            const matched = uData.users?.find((u: any) => u.email.toLowerCase() === email.toLowerCase());
                            if (matched) {
                              setExpiredUserId(matched.id);
                              setShowRenewalModal(true);
                              return;
                            }
                          }
                        } catch (err) {
                          console.error(err);
                        }
                        alert("Please type your registered email address first.");
                        return;
                      }
                      setShowRenewalModal(true);
                    }}
                    className="mt-2 block w-full rounded-lg bg-emerald-500 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-900 transition-all hover:bg-emerald-400"
                  >
                    Subscribe Now
                  </button>
                )}
              </motion.div>
            )}

            <AuthField label="Email address" htmlFor="email">
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={loading}
                className={authInputClass}
              />
            </AuthField>

            <AuthField label="Password" htmlFor="password">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={loading}
                className={`${authInputClass} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label="Toggle password visibility"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--m-text-muted)] transition-colors hover:text-[var(--m-text-primary)]"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </AuthField>

            <button
              type="submit"
              disabled={loading}
              id="sign-in-btn"
              className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#00DF82] text-[13px] font-semibold text-slate-950 transition-colors hover:bg-[#00c673] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Continue"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              href="/forgot-password"
              className="text-xs text-[var(--m-text-secondary)] hover:text-emerald-500"
            >
              Forgot Password?
            </Link>
          </div>
        </div>
      </AuthShell>

      {/* Renewal Modal */}
      <AnimatePresence>
        {showRenewalModal && expiredUserId && (
          <RenewalModal
            userId={expiredUserId}
            userEmail={email}
            onClose={() => setShowRenewalModal(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--m-bg-primary)]">
          <Loader2 className="size-6 animate-spin text-emerald-500" />
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
