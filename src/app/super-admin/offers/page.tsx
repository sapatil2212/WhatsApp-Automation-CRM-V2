"use client";

import { useState } from "react";
import { CreditCard, History, Megaphone, Tag } from "lucide-react";

import { PopupsTab } from "@/components/super-admin/offers/popups-tab";
import { PromoTab } from "@/components/super-admin/offers/promo-tab";
import { HistoryTab } from "@/components/super-admin/offers/history-tab";
import { PaymentsTab } from "@/components/super-admin/offers/payments-tab";

const TABS = [
  { id: "popups", label: "Pop-ups", icon: Megaphone },
  { id: "promos", label: "Promo codes", icon: Tag },
  { id: "history", label: "Promo history", icon: History },
  { id: "payments", label: "Payments", icon: CreditCard },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function OffersPage() {
  // Deep links: /super-admin/offers?tab=payments. The admin shell renders pages only
  // after its client-side session check, so reading the URL here is safe.
  const [tab, setTab] = useState<Tab>(() => {
    const t = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return TABS.some((x) => x.id === t) ? (t as Tab) : "popups";
  });
  const [historyPromo, setHistoryPromo] = useState("");
  const go = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", `?tab=${t}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Offers</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Home-page pop-ups, signup promo codes, their usage history and online payments.</p>
      </div>
      <div className="flex flex-wrap rounded-xl border border-border/70 bg-card p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "popups" && <PopupsTab />}
      {tab === "promos" && <PromoTab onShowHistory={(id) => { setHistoryPromo(id); go("history"); }} />}
      {tab === "history" && <HistoryTab promoId={historyPromo} onPromoChange={setHistoryPromo} />}
      {tab === "payments" && <PaymentsTab />}
    </div>
  );
}
