"use client";

import { useCallback, useState } from "react";

/** What the server returns from /api/billing/checkout and /api/billing/renewal(/login). */
export type CheckoutOrder =
  | { mode: "razorpay"; keyId: string; test: boolean; orderId: string; originalPaise: number; discountPaise: number; finalPaise: number; currency: string; description: string; prefill: { name: string; email: string; contact: string } }
  | { mode: "free"; originalPaise: number; discountPaise: number; finalPaise: number };

export type RazorpayOrderInfo = Extract<CheckoutOrder, { mode: "razorpay" }>;
export type CheckoutBusy = "starting" | "paying" | "confirming" | null;

interface RazorpayResponse { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
interface RazorpayInstance { open(): void; on(event: string, cb: (r: { error?: { description?: string } }) => void): void }
declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance }
}

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => resolve(Boolean(window.Razorpay)));
    s.addEventListener("error", () => resolve(false));
    if (!existing) {
      s.src = SCRIPT;
      s.async = true;
      document.body.appendChild(s);
    }
  });
}

/** POST JSON to an API route that answers with the `{ success, data, message }` envelope. */
export async function postJson<T>(path: string, json: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });
  const body = await res.json().catch(() => null);
  if (res.status === 429) throw new Error("Too many tries. Wait a minute and try again.");
  if (!res.ok || !body?.success) throw new Error(body?.message || "Something went wrong. Please try again.");
  return body.data as T;
}

/** The webhook may confirm the payment a few seconds after the browser callback fails. */
async function waitForWebhook(orderId: string) {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`/api/billing/razorpay/status?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (body?.data?.status === "paid") return true;
    if (body?.data?.status === "failed") return false;
  }
  return false;
}

/**
 * Razorpay Checkout state shared by signup, the login renewal dialog and the
 * Subscription page. The server creates the order (and re-checks any promo);
 * this opens the payment window and confirms the result.
 */
export function useRazorpayCheckout({ onActivated, initialBusy = null }: { onActivated: (kind: "paid" | "free") => void; initialBusy?: CheckoutBusy }) {
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [busy, setBusy] = useState<CheckoutBusy>(initialBusy);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (o: RazorpayOrderInfo) => {
      setError(null);
      setBusy("paying");
      if (!(await loadRazorpay()) || !window.Razorpay) {
        setBusy(null);
        setError("Could not load the payment window. Check your connection or disable ad blockers, then try again.");
        return;
      }
      const rzp = new window.Razorpay({
        key: o.keyId,
        order_id: o.orderId,
        amount: o.finalPaise,
        currency: o.currency,
        name: "ChatNexGen",
        description: o.description,
        image: "/favicon.png",
        prefill: o.prefill,
        theme: { color: "#00DF82" },
        modal: { ondismiss: () => setBusy(null) },
        handler: async (r: RazorpayResponse) => {
          setBusy("confirming");
          try {
            await postJson("/api/billing/razorpay/verify", { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
            onActivated("paid");
          } catch (e) {
            if (await waitForWebhook(o.orderId)) return onActivated("paid");
            setError((e as Error).message);
            setBusy(null);
          }
        },
      });
      rzp.on("payment.failed", (r) => {
        setError(r.error?.description ? `Payment failed: ${r.error.description}. You can try again.` : "Payment failed. You can try again.");
      });
      rzp.open();
    },
    [onActivated],
  );

  /** Takes a freshly created order. Only sets state after the request resolves, so it is safe inside effects. */
  const accept = useCallback(
    (o: CheckoutOrder, openNow = false) => {
      if (o.mode === "free") return onActivated("free");
      setOrder(o);
      if (openNow) void open(o);
      else setBusy(null);
    },
    [onActivated, open],
  );

  const fail = useCallback((e: unknown) => {
    setError((e as Error)?.message || "Something went wrong. Please try again.");
    setBusy(null);
  }, []);

  /** Creates an order, then (optionally) opens the payment window straight away. */
  const start = useCallback(
    (create: () => Promise<CheckoutOrder>, openNow = false) => {
      setError(null);
      setBusy("starting");
      return create().then((o) => accept(o, openNow)).catch(fail);
    },
    [accept, fail],
  );

  const pay = useCallback(() => {
    if (order?.mode === "razorpay") void open(order);
  }, [order, open]);

  const reset = useCallback(() => {
    setOrder(null);
    setError(null);
    setBusy(null);
  }, []);

  return { order, busy, error, setError, start, accept, fail, pay, reset };
}
