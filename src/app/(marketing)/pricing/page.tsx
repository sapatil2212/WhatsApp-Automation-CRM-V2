"use client";

import React from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { BookDemoTrigger } from "@/components/marketing/book-demo-trigger";
import { PLANS } from "@/lib/billing/plans";

export default function PricingPage() {
  const plans = PLANS;

  const features = {
    platform: {
      title: "The Platform",
      rows: [
        { name: "Official WhatsApp Business API", self: "check", managed: "check", custom: "check" },
        { name: "Shared Team Inbox", self: "check", managed: "check", custom: "check" },
        { name: "No-Code Flow & Automation Builder", self: "check", managed: "check", custom: "check" },
        { name: "AI Assistant (trained on your docs)", self: "You set it up", managed: "We configure it", custom: "We configure it" },
        { name: "27+ Integrations", self: "check", managed: "check", custom: "check" },
        { name: "0% Message Markup", self: "check", managed: "check", custom: "check" },
        { name: "Click-to-WhatsApp Ads (CTWA)", self: "check", managed: "check", custom: "check" },
        { name: "Multiple WhatsApp numbers / branches", self: "Per number", managed: "Per number", custom: "check" }
      ]
    },
    setup: {
      title: "Setup & Management",
      rows: [
        { name: "Meta Business Verification", self: "DIY", managed: "check", custom: "check" },
        { name: "WhatsApp Number & Co-existence Setup", self: "DIY", managed: "check", custom: "check" },
        { name: "Message Templates Written & Approved", self: "DIY", managed: "check", custom: "check" },
        { name: "Automations Built For You", self: "DIY", managed: "check", custom: "check" },
        { name: "Integrations Wired In", self: "DIY", managed: "check", custom: "check" },
        { name: "Custom Development", self: "—", managed: "—", custom: "check" }
      ]
    },
    support: {
      title: "Support",
      rows: [
        { name: "Setup Guides & Support Group", self: "check", managed: "check", custom: "check" },
        { name: "Dedicated Account Manager", self: "—", managed: "check", custom: "check" },
        { name: "Strategy Call", self: "—", managed: "Monthly", custom: "Monthly" },
        { name: "Priority Support & SLA", self: "—", managed: "—", custom: "check" }
      ]
    }
  };
  const renderValue = (val: string) => {
    if (val === "check") {
      return (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400">
          <Check className="size-3.5" />
        </span>
      );
    }
    if (val === "DIY") {
      return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] text-[var(--m-text-tertiary)]">DIY</span>;
    }
    if (val === "—") {
      return <span className="text-xs text-[var(--m-text-muted)]">—</span>;
    }
    return <span className="text-xs font-semibold px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{val}</span>;
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-24">
      {/* Page Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3" /> pricing
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          Pricing <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            You manage it, or we do.
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          Same platform on every plan. Pick ₹999/month to run it yourself, ₹1,999/month and our team runs it for you, or a custom plan for bigger setups.
        </p>
      </div>

      {/* Plan Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {plans.map((plan) => (
          <SpotlightCard
            key={plan.id}
            interactive={true}
            className={plan.popular ? "border-emerald-500/50 shadow-lg shadow-emerald-950/5 relative" : "border-[var(--m-border-primary)]/85"}
            glowColor={plan.popular ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.08)"}
          >
            {plan.badge && (
              <div className="absolute top-4 right-4 bg-emerald-500 text-slate-950 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full tracking-wider">
                {plan.badge}
              </div>
            )}
            <div className="space-y-6 flex flex-col justify-between h-full">
              <div className="space-y-4">
                <span className="text-xs font-bold text-[var(--m-text-tertiary)] uppercase tracking-widest">{plan.name}</span>
                <h4 className="text-base text-[var(--m-text-heading)] font-semibold min-h-[24px]">{plan.tagline}</h4>

                <div className="flex items-baseline gap-1 py-2 border-y border-[var(--m-border-primary)]/50">
                  <span className="text-3xl sm:text-4xl font-extrabold text-[var(--m-text-heading)]">{plan.price}</span>
                  {plan.period && <span className="text-xs text-[var(--m-text-muted)]">{plan.period} per WhatsApp number</span>}
                  {!plan.period && <span className="text-xs text-[var(--m-text-muted)]">pricing for your needs</span>}
                </div>
                <p className="text-xs leading-relaxed text-[var(--m-text-tertiary)]">{plan.description}</p>
                <ul className="space-y-2 pt-1 text-xs text-[var(--m-text-secondary)]">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-4 pt-4">
                {plan.selfServe ? (
                  <Link
                    href={`/signup?plan=${plan.id}`}
                    className={`w-full py-3 rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 ${plan.popular ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]" : "bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] hover:bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)]"}`}
                  >
                    {plan.cta}
                  </Link>
                ) : (
                  <BookDemoTrigger className="w-full py-3 rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] hover:bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)]">
                    {plan.cta}
                  </BookDemoTrigger>
                )}
                <div className="text-[10px] text-[var(--m-text-muted)] text-center leading-relaxed">{plan.footnote}</div>
              </div>
            </div>
          </SpotlightCard>
        ))}
      </div>

      <div className="text-center pt-4">
        <p className="text-xs text-[var(--m-text-muted)] font-medium">*Pricing exclusive of GST</p>
      </div>

      {/* Feature Comparison Matrix */}
      <div className="space-y-8 pt-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--m-text-heading)]">Compare Plan Features</h2>
          <p className="text-xs text-[var(--m-text-tertiary)]">What you get on each plan</p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/10 backdrop-blur-md">
          <table className="w-full min-w-[600px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/40 text-[var(--m-text-secondary)] font-bold text-xs">
                <th className="p-4 w-[40%]">Features</th>
                <th className="p-4 text-center w-[20%]">Self-Managed<div className="text-[10px] font-medium text-[var(--m-text-muted)]">₹999/mo</div></th>
                <th className="p-4 text-center w-[20%]">Fully Managed<div className="text-[10px] font-medium text-[var(--m-text-muted)]">₹1,999/mo</div></th>
                <th className="p-4 text-center w-[20%]">Custom<div className="text-[10px] font-medium text-[var(--m-text-muted)]">Quoted</div></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(features).map(([key, section]) => (
                <React.Fragment key={key}>
                  <tr className="bg-[var(--m-bg-secondary)]/20 border-b border-[var(--m-border-primary)]">
                    <td colSpan={4} className="px-4 py-3 text-xs uppercase font-extrabold tracking-wider text-emerald-400">
                      {section.title}
                    </td>
                  </tr>
                  {section.rows.map((row, rIdx) => (
                    <tr 
                      key={rIdx} 
                      className="border-b border-[var(--m-border-primary)]/50 hover:bg-[var(--m-bg-secondary)]/15 transition-colors duration-150"
                    >
                      <td className="p-4 text-xs font-semibold text-[var(--m-text-secondary)]">{row.name}</td>
                      <td className="p-4 text-center">{renderValue(row.self)}</td>
                      <td className="p-4 text-center">{renderValue(row.managed)}</td>
                      <td className="p-4 text-center">{renderValue(row.custom)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Callout */}
      <div className="text-center space-y-4">
        <BookDemoTrigger className="inline-flex items-center gap-1 text-sm font-semibold transition-colors text-emerald-500 hover:text-emerald-400">
          Not sure which plan? Talk to us →
        </BookDemoTrigger>
      </div>
    </div>
  );
}
