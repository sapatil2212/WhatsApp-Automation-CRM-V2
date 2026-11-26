"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Lock, Moon, ShieldCheck, Sun } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  // Already signed in? Go straight to the portal.
  useEffect(() => {
    let live = true;
    fetch("/api/super-admin/auth", { cache: "no-store" })
      .then((res) => {
        if (!live) return;
        if (res.ok) router.replace("/super-admin");
        else setChecking(false);
      })
      .catch(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(res.status === 429 ? "Too many attempts. Wait a minute and try again." : d.error ?? `Sign-in failed (${res.status}).`);
        setLoading(false);
        return;
      }
      router.replace("/super-admin");
    } catch {
      setError("Network error. Check your connection and try again.");
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-muted/30">
      <div className="flex items-center justify-between px-5 pt-5 sm:px-8">
        <Link href="/" aria-label="ChatNexGen home" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo/chatnexgen-logo-light.png" alt="ChatNexGen" className="h-7 w-auto object-contain dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo/chatnexgen-logo.png" alt="ChatNexGen" className="hidden h-7 w-auto object-contain dark:block" />
        </Link>
        <button
          type="button"
          onClick={() => setMode(mode === "light" ? "dark" : "light")}
          aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
          className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {mode === "light" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
        </button>
      </div>

      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[380px]">
          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm sm:p-7">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="size-5" />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight">Admin sign in</h1>
                <p className="text-[12px] text-muted-foreground">ChatNexGen super admin portal</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
              {error && (
                <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="admin-email" className="text-[12px]">Email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@company.com"
                  disabled={loading}
                  className="h-9 text-base sm:text-[13px]"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="admin-password" className="text-[12px]">Password</Label>
                <div className="relative">
                  <Input
                    id="admin-password"
                    type={showPass ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    disabled={loading}
                    className="h-9 pr-9 text-base sm:text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPass ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>

              <Button type="submit" id="super-admin-login-btn" disabled={loading || !email.trim() || !password} className="h-9 w-full gap-1.5">
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">Restricted area. Sign-in attempts are rate limited.</p>
        </div>
      </main>
    </div>
  );
}
