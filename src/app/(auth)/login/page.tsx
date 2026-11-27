"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { CreditCard, Eye, EyeOff, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthField, AuthNotice, authInputClass, authPrimaryButton } from "@/components/auth/auth-field";
import { RenewalDialog, type ExpiredInfo } from "@/components/auth/renewal-dialog";

const ERROR_TEXT: Record<string, string> = {
  email_unverified: "Please verify your email address first. Check your inbox for the code we sent when you signed up.",
  pending_approval: "Your account is waiting for approval. We'll notify you on WhatsApp/email once it's active.",
};

/** Login errors that belong to one field; account-level ones (approval, renewal) stay above the form. */
const FIELD_OF: Record<string, "email" | "password"> = { email_unverified: "email" };

function LoginPageInner() {
  const searchParamsForEmail = useSearchParams();
  const [email, setEmail] = useState(() => searchParamsForEmail.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState<ExpiredInfo | null>(null);
  const [showRenewal, setShowRenewal] = useState(false);
  const [renewed, setRenewed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const isVerified = searchParams.get("verified") === "true";
  const errorParam = searchParams.get("error");
  // Only allow same-site relative redirects.
  const rawRedirect = searchParams.get("redirect") || searchParams.get("from") || "/dashboard";
  const redirectTo = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/dashboard";

  // Already signed in? Go straight to the app.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (!cancelled && data?.user) router.replace(redirectTo);
        else if (!cancelled) setCheckingSession(false);
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

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setExpired(null);
    const errs: { email?: string; password?: string } = {};
    if (!email.trim()) errs.email = "Enter your email.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = "Enter a valid email, like you@company.com.";
    if (!password) errs.password = "Enter your password.";
    setFieldErrors(errs);
    if (errs.email || errs.password) {
      document.getElementById(errs.email ? "email" : "password")?.focus();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const isJson = (res.headers.get("content-type") || "").includes("application/json");
      const data = isJson ? await res.json().catch(() => ({})) : {};
      if (!isJson) throw new Error(res.status === 404 ? "Sign-in is unavailable right now. Refresh the page and try again." : `Sign-in failed (${res.status}). Please try again.`);

      if (!res.ok) {
        if (data.error === "subscription_expired") {
          setExpired({ email: email.trim(), name: data.name ?? null, plan: data.plan ?? null });
          setError("Your subscription has ended. Renew to continue using ChatNexGen.");
        } else {
          const text = ERROR_TEXT[data.error as string] || data.message || data.error || "Incorrect email or password.";
          const field = (data.field as "email" | "password" | undefined) ?? FIELD_OF[data.error as string];
          if (field) {
            setFieldErrors({ [field]: text });
            document.getElementById(field)?.focus();
          } else {
            setError(text);
          }
        }
        setLoading(false);
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        setFieldErrors({ password: authError.message || "Incorrect email or password." });
        setLoading(false);
        return;
      }
      router.replace(redirectTo);
    } catch (err) {
      setError((err instanceof Error && err.message) || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <>
      <AuthShell
        variant="login"
      >
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">Welcome back</h1>
          <p className="text-sm text-[var(--m-text-tertiary)]">Log in to your ChatNexGen workspace.</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-3.5" noValidate>
          {isVerified && <AuthNotice tone="success">Email verified. You can log in once your account is approved.</AuthNotice>}
          {renewed && <AuthNotice tone="success">Payment received. Your subscription is active again{loading ? ", signing you in…" : ". Log in to continue."}</AuthNotice>}
          {errorParam && (
            <AuthNotice tone="error">{errorParam === "invalid-verification-token" ? "This verification link is invalid or has expired." : "Email verification failed."}</AuthNotice>
          )}
          {error && (
            <AuthNotice tone="error">
              {error}
              {expired && (
                <button type="button" onClick={() => setShowRenewal(true)} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-emerald-500 text-[12px] font-semibold !text-white hover:bg-emerald-400">
                  <CreditCard className="size-3.5" /> Renew subscription
                </button>
              )}
            </AuthNotice>
          )}

          <AuthField label="Email" htmlFor="email" error={fieldErrors.email}>
            <Input id="email" type="email" placeholder="you@company.com" value={email} onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined })); }} required autoComplete="email" autoFocus disabled={loading} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "email-error" : undefined} className={authInputClass} />
          </AuthField>

          <AuthField
            label="Password"
            htmlFor="password"
            error={fieldErrors.password}
            action={<Link href="/forgot-password" className="text-[11px] font-medium text-emerald-500 hover:text-emerald-400">Forgot password?</Link>}
          >
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Your password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined })); }}
              required
              autoComplete="current-password"
              disabled={loading}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              className={`${authInputClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--m-text-muted)] transition-colors hover:text-[var(--m-text-primary)]"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </AuthField>

          <button type="submit" disabled={loading} id="sign-in-btn" className={`mt-1 ${authPrimaryButton}`}>
            {loading ? <><Loader2 className="size-4 animate-spin" /> Logging in…</> : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-center text-[12px] text-[var(--m-text-tertiary)]">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-semibold text-emerald-500 hover:text-emerald-400">Sign up</Link>
        </p>
      </AuthShell>

      <AnimatePresence>
        {showRenewal && expired && (
          <RenewalDialog
            info={expired}
            password={password}
            onClose={() => setShowRenewal(false)}
            onRenewed={() => {
              setShowRenewal(false);
              setExpired(null);
              setError(null);
              setRenewed(true);
              void handleLogin();
            }}
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
