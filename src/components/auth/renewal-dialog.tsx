"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";

import { formatPaise, planById, SELF_SERVE_PLANS } from "@/lib/billing/plans";
import { postJson, type CheckoutOrder } from "@/components/billing/use-razorpay-checkout";
import { cn } from "@/lib/utils";
import { authPrimaryButton } from "./auth-field";
import { PromoCodeField, type AppliedPromo } from "./promo-code-field";
import { AuthCheckout } from "./signup-checkout";

export interface ExpiredInfo { email: string; name: string | null; plan: string | null }

const BUYABLE = SELF_SERVE_PLANS.filter((p) => p.selfServe && p.pricePaise);

/**
 * Subscription ended: the account cannot sign in, so the renewal order is
 * created with the email + password just typed on the login form.
 */
export function RenewalDialog({ info, password, onClose, onRenewed }: {
  info: ExpiredInfo;
  password: string;
  onClose: () => void;
  onRenewed: (kind: "paid" | "free") => void;
}) {
  const current = planById(info.plan);
  const [planId, setPlanId] = useState(current?.selfServe && current.pricePaise ? current.id : (BUYABLE.find((p) => p.popular) ?? BUYABLE[0])?.id ?? "");
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const [step, setStep] = useState<"choose" | "pay">("choose");
  const plan = planById(planId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const createOrder = useCallback(
    () => postJson<CheckoutOrder>("/api/billing/renewal/login", { email: info.email, password, plan: planId, promoCode: promo?.code ?? "" }),
    [info.email, password, planId, promo],
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Renew subscription">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        className="relative z-10 w-full max-w-sm overflow-hidden rounded-xl border border-[var(--m-border-secondary)] bg-[var(--m-bg-primary)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--m-border-secondary)] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--m-text-heading)]">Renew your subscription</h2>
            <p className="truncate text-[12px] text-[var(--m-text-tertiary)]">{info.name ? `${info.name} · ` : ""}{info.email}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[var(--m-text-muted)] hover:bg-[var(--m-bg-secondary)] hover:text-[var(--m-text-primary)]">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {step === "choose" ? (
            <>
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-[var(--m-text-secondary)]">Plan</p>
                {BUYABLE.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                      planId === p.id ? "border-emerald-500/60 bg-emerald-500/10" : "border-[var(--m-border-secondary)] hover:border-emerald-500/40",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", planId === p.id ? "border-emerald-500 bg-emerald-500 !text-white" : "border-[var(--m-border-secondary)]")}>
                        {planId === p.id && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-[var(--m-text-heading)]">{p.name}{current?.id === p.id ? " (current)" : ""}</span>
                        <span className="block truncate text-[11px] text-[var(--m-text-tertiary)]">{p.tagline}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-bold text-[var(--m-text-heading)]">{formatPaise(p.pricePaise!)}<span className="text-[10px] font-medium text-[var(--m-text-muted)]">{p.period}</span></span>
                  </button>
                ))}
              </div>
              <PromoCodeField plan={planId} email={info.email} value={promo} onChange={setPromo} />
              <button type="button" disabled={!plan} onClick={() => setStep("pay")} className={authPrimaryButton}>
                Continue to payment <ArrowRight className="size-4" />
              </button>
              <p className="text-center text-[11px] text-[var(--m-text-muted)]">Your subscription restarts for one month as soon as the payment succeeds.</p>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep("choose")} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)]">
                <ArrowLeft className="size-3.5" /> Change plan or promo
              </button>
              <AuthCheckout createOrder={createOrder} planName={plan?.name ?? ""} period="1 month renewal" promoCode={promo?.code ?? null} onActivated={onRenewed} />
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
