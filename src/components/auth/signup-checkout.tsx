"use client";

import { useEffect, useRef } from "react";
import { Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";

import { formatPaise } from "@/lib/billing/plans";
import { postJson, useRazorpayCheckout, type CheckoutOrder } from "@/components/billing/use-razorpay-checkout";
import { AuthNotice, authPrimaryButton, authSecondaryButton } from "./auth-field";

/**
 * Order summary + "Pay" button in the auth-page style. Creates the order on
 * mount through `createOrder` (the server applies the promo again), opens
 * Razorpay Checkout and confirms the payment. If the browser loses the
 * callback, it polls the order while the webhook confirms it.
 */
export function AuthCheckout({ createOrder, planName, period = "1 month", promoCode, onActivated }: {
  createOrder: () => Promise<CheckoutOrder>;
  planName: string;
  period?: string;
  promoCode: string | null;
  onActivated: (kind: "paid" | "free") => void;
}) {
  const { order, busy, error, start, accept, fail, pay } = useRazorpayCheckout({ onActivated, initialBusy: "starting" });
  const started = useRef(false);
  const createRef = useRef(createOrder);

  // First order on mount (retries go through `start`).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createRef.current().then((o) => accept(o)).catch(fail);
  }, [accept, fail]);

  const checkout = order?.mode === "razorpay" ? order : null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--m-border-secondary)] p-3">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-[var(--m-text-secondary)]">{planName} plan · {period}</span>
          <span className="text-[var(--m-text-primary)]">{order ? formatPaise(order.originalPaise) : "—"}</span>
        </div>
        {order && order.discountPaise > 0 && (
          <div className="mt-1 flex items-center justify-between text-[12px]">
            <span className="text-emerald-500">Promo {promoCode}</span>
            <span className="text-emerald-500">−{formatPaise(order.discountPaise)}</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-[var(--m-border-secondary)] pt-2">
          <span className="text-[13px] font-semibold text-[var(--m-text-heading)]">Total to pay</span>
          <span className="text-[17px] font-bold text-[var(--m-text-heading)]">{order ? formatPaise(order.finalPaise) : "—"}</span>
        </div>
      </div>

      {error && <AuthNotice tone="error">{error}</AuthNotice>}

      {checkout ? (
        <button type="button" onClick={pay} disabled={busy !== null} className={authPrimaryButton}>
          {busy === "confirming" ? <><Loader2 className="size-4 animate-spin" /> Confirming payment…</> : busy === "paying" ? <><Loader2 className="size-4 animate-spin" /> Opening secure payment…</> : <><Lock className="size-4" /> Pay {formatPaise(checkout.finalPaise)} securely</>}
        </button>
      ) : busy === "starting" ? (
        <button type="button" disabled className={authPrimaryButton}><Loader2 className="size-4 animate-spin" /> Preparing your payment…</button>
      ) : (
        <button type="button" onClick={() => void start(createOrder)} className={authSecondaryButton}><RefreshCw className="size-3.5" /> Try again</button>
      )}

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[var(--m-text-muted)]">
        <ShieldCheck className="size-3.5 text-emerald-500" /> UPI, cards, netbanking and wallets via Razorpay. Your account activates as soon as the payment succeeds.
      </p>
      {checkout?.test && <p className="text-center text-[10px] font-medium text-amber-500">Test mode: no real money is charged.</p>}
    </div>
  );
}

/** Signup step 3: pays for a new account. */
export function SignupCheckout({ userId, plan, planName, promoCode, onActivated }: {
  userId: string;
  plan: string;
  planName: string;
  promoCode: string | null;
  onActivated: (kind: "paid" | "free") => void;
}) {
  return (
    <AuthCheckout
      createOrder={() => postJson<CheckoutOrder>("/api/billing/checkout", { userId, plan, promoCode: promoCode ?? "" })}
      planName={planName}
      promoCode={promoCode}
      onActivated={onActivated}
    />
  );
}
