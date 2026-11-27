"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Gift, X } from "lucide-react";

interface Offer {
  id: string;
  kind: "welcome" | "exit_intent";
  title: string;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  promoCode: string | null;
  delaySeconds: number;
  frequency: "session" | "day" | "week" | "always";
  version: number;
}

const WINDOW_MS = { session: 0, day: 86_400_000, week: 7 * 86_400_000, always: 0 } as const;

/** Whether this visitor may see the offer again (per offer and per version, so an edited offer shows again). */
function allowed(o: Offer): boolean {
  if (o.frequency === "always") return true;
  const key = `cnx.offer.${o.id}.${o.version}`;
  try {
    if (o.frequency === "session") return !sessionStorage.getItem(key);
    const last = Number(localStorage.getItem(key) ?? 0);
    return Date.now() - last > WINDOW_MS[o.frequency];
  } catch {
    return true;
  }
}

function remember(o: Offer) {
  const key = `cnx.offer.${o.id}.${o.version}`;
  try {
    if (o.frequency === "session") sessionStorage.setItem(key, "1");
    else if (o.frequency !== "always") localStorage.setItem(key, String(Date.now()));
  } catch {
    /* private mode: show again next time */
  }
}

const track = (id: string, type: "view" | "click" | "dismiss") =>
  void fetch(`/api/public/offers/${id}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }), keepalive: true }).catch(() => undefined);

/** CTA target, with the promo code attached when it points at signup. */
function ctaHref(o: Offer): string {
  const url = o.ctaUrl || "/signup";
  if (!o.promoCode || !url.startsWith("/signup")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}promo=${encodeURIComponent(o.promoCode)}`;
}

/**
 * Home-page pop-ups set up in Super Admin → Offers.
 *   welcome      opens a few seconds after the visitor lands
 *   exit intent  opens when the pointer leaves through the top of the window
 *                (desktop), or on a quick scroll back to the top (phones)
 * Only one pop-up is shown per visit, and each respects its frequency.
 */
export function OfferPopups() {
  const [offers, setOffers] = useState<{ welcome: Offer | null; exitIntent: Offer | null } | null>(null);
  const [open, setOpen] = useState<Offer | null>(null);
  const shownThisVisit = useRef(false);
  const clicked = useRef(false);

  useEffect(() => {
    let live = true;
    fetch("/api/public/offers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && b?.data && setOffers(b.data))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const show = useCallback((o: Offer) => {
    if (shownThisVisit.current || !allowed(o)) return;
    shownThisVisit.current = true;
    remember(o);
    setOpen(o);
    track(o.id, "view");
  }, []);

  // Welcome pop-up after its delay.
  useEffect(() => {
    const o = offers?.welcome;
    if (!o) return;
    const t = setTimeout(() => show(o), Math.max(0, o.delaySeconds) * 1000);
    return () => clearTimeout(t);
  }, [offers, show]);

  // Exit intent.
  useEffect(() => {
    const o = offers?.exitIntent;
    if (!o) return;
    const armedAt = Date.now() + 4000; // never right after landing
    const onLeave = (e: MouseEvent) => {
      if (Date.now() < armedAt || e.relatedTarget || e.clientY > 10) return;
      show(o);
    };
    // Phones have no pointer: a fast scroll back to the top after reading is the usual sign of leaving.
    let maxY = 0;
    let lastY = window.scrollY;
    let lastT = performance.now();
    const onScroll = () => {
      const y = window.scrollY;
      const t = performance.now();
      maxY = Math.max(maxY, y);
      const speed = (lastY - y) / Math.max(1, t - lastT); // px/ms upward
      if (Date.now() > armedAt && maxY > window.innerHeight * 1.5 && y < window.innerHeight * 0.4 && speed > 1.2) show(o);
      lastY = y;
      lastT = t;
    };
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse) window.addEventListener("scroll", onScroll, { passive: true });
    else document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [offers, show]);

  if (!open) return null;
  return (
    <OfferModal
      offer={open}
      onClose={() => { if (!clicked.current) track(open.id, "dismiss"); setOpen(null); }}
      onCta={() => { clicked.current = true; track(open.id, "click"); }}
    />
  );
}

export function OfferModal({ offer, onClose: onClosed, onCta, preview }: { offer: Pick<Offer, "id" | "kind" | "title" | "body" | "imageUrl" | "ctaLabel" | "ctaUrl" | "promoCode">; onClose: () => void; onCta?: () => void; preview?: boolean }) {
  const [copied, setCopied] = useState(false);
  // `shown` drives the enter/exit transition; the parent is told only after the exit finishes.
  const [shown, setShown] = useState(false);
  const closing = useRef(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  const onClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(onClosed, reduce ? 0 : 280);
  }, [onClosed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    if (!offer.promoCode) return;
    try {
      await navigator.clipboard.writeText(offer.promoCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code is still visible */
    }
  };

  const href = ctaHref(offer as Offer);
  const external = /^https:\/\//.test(href);
  const hasText = Boolean(offer.title || offer.body);
  const hasCta = Boolean(offer.ctaLabel || offer.ctaUrl);
  const hasContent = hasText || Boolean(offer.promoCode) || hasCta;

  return (
    <div
      className={`${preview ? "absolute" : "fixed"} inset-0 z-[300] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm transition-opacity duration-300 ease-out motion-reduce:transition-none sm:items-center sm:p-4 ${shown ? "opacity-100" : "opacity-0"}`}
      role="dialog"
      aria-modal="true"
      aria-label={offer.title || "Offer"}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`relative w-full max-w-md overflow-hidden rounded-t-2xl bg-white text-slate-900 shadow-2xl transition-all duration-300 ease-out motion-reduce:transition-none sm:rounded-2xl ${shown ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"}`}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-2.5 top-2.5 z-10 grid size-8 place-items-center rounded-full bg-white/90 text-slate-600 shadow-sm transition-colors hover:bg-white hover:text-slate-900">
          <X className="size-4" />
        </button>
        {offer.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={offer.imageUrl} alt="" className="max-h-64 w-full object-cover" />
        ) : hasContent ? (
          <div className="flex h-24 items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600">
            <Gift className="size-10 text-white" />
          </div>
        ) : null}
        {hasContent && <div className="space-y-3 p-5 text-center">
          {offer.kind === "exit_intent" && hasText && <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Wait, before you go</p>}
          {offer.title && <h2 className="text-xl font-bold leading-snug">{offer.title}</h2>}
          {offer.body && <p className="whitespace-pre-line text-sm text-slate-600">{offer.body}</p>}
          {offer.promoCode && (
            <button type="button" onClick={copy} className="mx-auto flex items-center gap-2 rounded-lg border-2 border-dashed border-emerald-500 bg-emerald-50 px-4 py-2 font-mono text-base font-bold tracking-wider text-emerald-700 transition-colors hover:bg-emerald-100">
              {offer.promoCode}
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          )}
          {offer.promoCode && <p className="text-[11px] text-slate-500">{copied ? "Copied. It's applied automatically at signup." : "Tap to copy. It's applied automatically at signup."}</p>}
          {hasCta && <Link
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            onClick={(e) => {
              if (preview) return e.preventDefault();
              onCta?.();
              if (!external) onClose();
            }}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-[#00DF82] text-sm font-semibold !text-white shadow-[0_6px_24px_rgba(0,223,130,0.25)] transition-colors hover:bg-[#00c673]"
          >
            {offer.ctaLabel || "Claim offer"}
          </Link>}
          <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-700">No thanks</button>
        </div>}
      </div>
    </div>
  );
}
