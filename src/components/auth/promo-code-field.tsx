"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Tag, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatPaise } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { authInputClass } from "./auth-field";

export interface AppliedPromo {
  code: string;
  label: string;
  description: string | null;
  originalPaise: number;
  discountPaise: number;
  finalPaise: number;
}

async function validate(code: string, plan: string, email: string): Promise<AppliedPromo> {
  const res = await fetch("/api/billing/promo/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, plan, email }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(res.status === 429 ? "Too many tries. Wait a minute and try again." : body?.message || "Could not apply this code.");
  return body.data as AppliedPromo;
}

/**
 * Promo code input with Apply. Re-checks the applied code when the plan
 * changes (codes can be limited to plans). The server checks it again when the
 * payment is created, so this is a preview only.
 */
export function PromoCodeField({ plan, email, value, onChange, initialCode }: { plan: string; email: string; value: AppliedPromo | null; onChange: (v: AppliedPromo | null) => void; initialCode?: string | null }) {
  const [open, setOpen] = useState(Boolean(initialCode));
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triedInitial = useRef(false);

  const apply = async (raw = code) => {
    const c = raw.trim();
    if (!c) return setError("Enter a promo code.");
    setBusy(true);
    setError(null);
    try {
      onChange(await validate(c, plan, email.trim()));
    } catch (e) {
      onChange(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Codes from a link (/signup?promo=CODE) are applied straight away.
  useEffect(() => {
    if (initialCode && !triedInitial.current) {
      triedInitial.current = true;
      setOpen(true);
      setCode(initialCode.toUpperCase());
      void apply(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  // A different plan may change the discount or make the code invalid.
  const lastPlan = useRef(plan);
  useEffect(() => {
    if (lastPlan.current === plan) return;
    lastPlan.current = plan;
    if (value) void apply(value.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Check className="size-4 shrink-0 text-emerald-500" />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-emerald-500">
              {value.code} applied · {value.label}
            </p>
            <p className="truncate text-[11px] text-[var(--m-text-tertiary)]">You save {formatPaise(value.discountPaise)}{value.description ? ` · ${value.description}` : ""}</p>
          </div>
        </div>
        <button type="button" onClick={() => { onChange(null); setCode(""); setError(null); }} aria-label="Remove promo code" className="shrink-0 rounded p-1 text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)]">
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 self-start text-[12px] font-medium text-emerald-500 hover:text-emerald-400">
        <Tag className="size-3.5" /> Have a promo code?
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="promoCode" className="text-[11px] font-medium text-[var(--m-text-secondary)]">Promo code</label>
      <div className="flex gap-2">
        <Input
          id="promoCode"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void apply(); } }}
          placeholder="e.g. WELCOME20"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "promoCode-error" : undefined}
          className={cn(authInputClass, "font-mono uppercase tracking-wide", error && "!border-rose-500")}
        />
        <button
          type="button"
          onClick={() => void apply()}
          disabled={busy || !code.trim()}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/60 px-4 text-[12px] font-semibold text-emerald-500 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Apply
        </button>
      </div>
      {error && <p id="promoCode-error" role="alert" className="text-[11px] font-medium text-rose-500">{error}</p>}
    </div>
  );
}
