"use client";

import React from "react";
import { Landmark } from "lucide-react";

export default function RefundPolicyPage() {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-20 space-y-10">
      <div className="space-y-4 border-b border-[var(--m-border-primary)] pb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
          <Landmark className="size-3" /> Refund Policy
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-[var(--m-text-heading)] tracking-tight">
          Subscription & Refund Policy
        </h1>
        <p className="text-xs text-[var(--m-text-muted)]">Last updated: June 23, 2026</p>
      </div>

      <div className="space-y-8 text-xs sm:text-sm text-[var(--m-text-secondary)] leading-relaxed">
        <p>
          At ChatNexGen, we deliver professional WhatsApp CRM and communication automation services. This policy clarifies terms regarding recurring subscriptions, setup configurations, custom developments, consulting sessions, and billing queries.
        </p>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">1. SaaS Subscriptions</h3>
          <p>
            Our software platform is provided on a subscription basis (monthly or annually).
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>Subscribing plans carry a flat rate pass-through for Meta Business Platform usage fees without markups.</li>
            <li>All subscription payments are non-refundable once the billing cycle begins.</li>
            <li>You can cancel your subscription at any time to avoid future renewals; your dashboard access will remain active until the end of your prepaid period.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">2. Account Onboarding & Setup Fees</h3>
          <p>
            Setup and integration fees cover the direct labor involved in configuring your Meta Business Manager, applying for WhatsApp Business Account status, and mapping numbers.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>These onboarding fees are non-refundable once configuration or account consultation has commenced.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">3. Custom Development Workflows</h3>
          <p>
            Fees collected for custom chatbot integrations, dedicated API plugins, webhook configurations, and customized flow building are governed by project-specific service level agreements (SLAs).
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>Since custom engineering involves dedicated development resources, these items are non-refundable once development milestones begin.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">4. Consultation Services</h3>
          <p>
            Fees for professional consultation sessions, strategy planning calls, and Meta compliance audits are earned upon booking. If you need to reschedule a consulting slot, you must contact your representative at least 24 hours in advance. No-shows or cancellations inside 24 hours are non-refundable.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">5. Billing Disputes & Resolution</h3>
          <p>
            If you identify a duplicate charge or billing error on your statement, you agree to raise an inquiry with our support department within 14 days of the invoice date.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>We investigate all queries in good faith and correct verified platform glitches or billing errors immediately.</li>
            <li>Initiating unauthorized chargebacks without contacting our billing desk will result in immediate workspace lockouts and possible collection procedures.</li>
          </ul>
        </section>

        <section className="space-y-3 text-center pt-8 border-t border-[var(--m-border-primary)]/50">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">6. Contact Support</h3>
          <p>
            For any queries regarding billing, invoice breakdowns, or cancellations, please contact our support desk:
          </p>
          <div className="text-xs text-[var(--m-text-tertiary)] mt-3">
            <p className="font-bold text-[var(--m-text-primary)]">ChatNexGen Technologies</p>
            <p>
              Email: <a href="mailto:chatnexgen@gmail.com" className="text-emerald-400 hover:underline">chatnexgen@gmail.com</a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
