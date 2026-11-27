import React from "react";
import Link from "next/link";
import { ArrowRight, Bot, Check, ChevronDown, Landmark } from "lucide-react";
import { PLANS } from "@/lib/billing/plans";
import { InteractiveHero } from "@/components/marketing/interactive-hero";
import { OfferPopups } from "@/components/marketing/offer-popups";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { MagneticButton } from "@/components/marketing/magnetic-button";
import { AIChatSimulation } from "@/components/marketing/ai-chat-simulation";

import { SocialProofMetrics } from "@/components/marketing/social-proof-metrics";
import { BookDemoTrigger } from "@/components/marketing/book-demo-trigger";
import { WhatWeDoSection } from "@/components/marketing/what-we-do-section";
import { InboxProblem } from "@/components/marketing/inbox-problem";
import { WhatsAppStats } from "@/components/marketing/whatsapp-stats";

interface FAQItem {
  q: string;
  a: string;
}

export default function HomePage() {
  const useCases = [
    {
      title: "Appointment Reminders & Triage",
      category: "Healthcare & Wellness",
      content: "Automate patient consultation reminders, handle rescheduling, and answer clinic FAQs with instant routing to front-desk staff.",
      metric: "Zero Missed Appointments",
      tag: "Clinical Automation",
    },
    {
      title: "Order Alerts & Delivery Tracking",
      category: "D2C & Online Retail",
      content: "Send real-time dispatch updates, tracking notifications, and opt-in customer service responses via verified Meta Cloud API templates.",
      metric: "Direct Customer Reach",
      tag: "E-Commerce",
    },
    {
      title: "Inbound Lead Qualification",
      category: "B2B & Professional Services",
      content: "Capture leads from Click-to-WhatsApp ads, qualify prospects automatically, and assign conversation cards in the shared team inbox.",
      metric: "Sub-Second Ingestion",
      tag: "Sales Pipelines",
    },
  ];

  const faqs: FAQItem[] = [
    {
      q: "What is ChatNexGen and how does it work?",
      a: "ChatNexGen is a WhatsApp Business communication and automation SaaS platform operated by Brightwave Digital Products LLP. It enables businesses to connect their own WhatsApp Business Account via Meta Cloud API, manage conversations in a collaborative team inbox, build automated response flows, and organize deals in visual kanban pipelines.",
    },
    {
      q: "Is ChatNexGen compliant with WhatsApp policies?",
      a: "Yes. ChatNexGen strictly follows Meta's Business Messaging Policy and Commerce Policy. We integrate exclusively via the official WhatsApp Cloud API. We strictly require user opt-in consent and provide automated opt-out mechanisms (STOP keyword), protecting your business reputation.",
    },
    {
      q: "Do I need my own WhatsApp Business Account (WABA)?",
      a: "Yes. Under our multi-tenant architecture, each business authorizes and connects their own WhatsApp Business Account using their Phone Number ID and permanent Meta access token. You maintain complete ownership of your customer relationships and phone numbers.",
    },
    {
      q: "What are the subscription rates and Meta API fees?",
      a: "Self-Managed is ₹999/month per WhatsApp number (you run everything), Fully Managed is ₹1,999/month (our team runs it for you), and Custom plans are quoted for larger setups. Meta conversation-based fees (Utility, Authentication, Marketing, Service) are paid directly to Meta according to their official regional card rates; ChatNexGen passes through Meta API charges with 0% markup.",
    },
    {
      q: "How does the AI Assistant resolve queries?",
      a: "You can upload your database guidelines, FAQs, and service files directly to the platform. Our AI parses user intent, answers client inquiries using your knowledge base guidelines, and flags human agents when a manual takeover is required.",
    },
  ];

  const pricingCards = PLANS.map((p) => ({
    name: p.name,
    tag: p.tagline,
    price: p.price,
    period: p.period,
    renewal: p.selfServe ? "per WhatsApp number" : "Pricing tailored to your setup",
    desc: p.description,
    features: p.features,
    cta: p.cta,
    link: p.selfServe ? `/signup?plan=${p.id}` : "/book-demo",
    primary: Boolean(p.popular),
  }));
  return (
    <div className="w-full flex flex-col overflow-hidden">
      {/* FAQ Schema Injector */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": faqs.map((faq) => ({
              "@type": "Question",
              "name": faq.q,
              "acceptedAnswer": {
                "@type": "Answer",
                "text": faq.a,
              },
            })),
          }),
        }}
      />

      {/* 1. HERO SECTION */}
      <OfferPopups />
      <InteractiveHero />
      <InboxProblem />

      {/* 2. WHAT WE DO */}
      <WhatWeDoSection />

      {/* 2b. WHY WHATSAPP STATS */}
      <WhatsAppStats />

      {/* 3. HOW IT WORKS SECTION */}
      <section className="box-content py-24 px-8 sm:px-20 lg:px-32 max-w-[1360px] mx-auto space-y-16 relative">
        <div
          className="text-center max-w-3xl mx-auto space-y-4"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-[var(--m-text-heading)] transition-colors duration-300">
            How it works
          </h2>
          <p className="text-sm text-[var(--m-text-tertiary)] transition-colors duration-300">
            Link and operate your official WhatsApp automation setup in minutes.
          </p>
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
          {/* Connecting Line */}
          <div
            className="absolute top-[20px] left-[20px] w-[calc(66.666%)] h-[1px] bg-emerald-500/20 hidden md:block z-0 origin-left"
          />

          {/* Step 1 */}
          <div
            className="relative flex flex-col items-center md:items-start text-center md:text-left z-10 group"
          >
            <div className="w-10 h-10 rounded-lg border border-emerald-500/30 bg-[var(--m-bg-primary)] flex items-center justify-center text-xs font-semibold text-emerald-400 mb-6 shadow-md shadow-emerald-500/5 group-hover:border-emerald-500 group-hover:text-emerald-300 transition-all duration-300">
              01
            </div>
            <div className="max-w-xs space-y-3">
              <h3 className="text-base md:text-lg font-semibold text-[var(--m-text-heading)] leading-snug transition-colors duration-300">
                Connect and Verify — Official Meta API
              </h3>
              <p className="text-xs md:text-sm text-[var(--m-text-tertiary)] leading-relaxed transition-colors duration-300">
                Connect your business phone number via official Meta processes. Our compliance guidelines make setup straightforward, preparing you for immediate customer support.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div
            className="relative flex flex-col items-center md:items-start text-center md:text-left z-10 group"
          >
            <div className="w-10 h-10 rounded-lg border border-emerald-500/30 bg-[var(--m-bg-primary)] flex items-center justify-center text-xs font-semibold text-emerald-400 mb-6 shadow-md shadow-emerald-500/5 group-hover:border-emerald-500 group-hover:text-emerald-300 transition-all duration-300">
              02
            </div>
            <div className="max-w-xs space-y-3">
              <h3 className="text-base md:text-lg font-semibold text-[var(--m-text-heading)] leading-snug transition-colors duration-300">
                AI Customer Support on Autopilot
              </h3>
              <p className="text-xs md:text-sm text-[var(--m-text-tertiary)] leading-relaxed transition-colors duration-300">
                Customer engagement campaigns reach opted-in contacts seamlessly. Automated replies run in the background according to Meta guidelines, resolving inquiries 24/7.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div
            className="relative flex flex-col items-center md:items-start text-center md:text-left z-10 group"
          >
            <div className="w-10 h-10 rounded-lg border border-emerald-500/30 bg-[var(--m-bg-primary)] flex items-center justify-center text-xs font-semibold text-emerald-400 mb-6 shadow-md shadow-emerald-500/5 group-hover:border-emerald-500 group-hover:text-emerald-300 transition-all duration-300">
              03
            </div>
            <div className="max-w-xs space-y-3">
              <h3 className="text-base md:text-lg font-semibold text-[var(--m-text-heading)] leading-snug transition-colors duration-300">
                Track Leads in Shared CRM Pipeline
              </h3>
              <p className="text-xs md:text-sm text-[var(--m-text-tertiary)] leading-relaxed transition-colors duration-300">
                Monitor open rates, query resolutions, and appointments. Assign leads to human agents and check conversation histories on a secure, visual interface.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. AI CHAT EXPERIENCE STORY */}
      <section className="py-24 px-8 sm:px-20 lg:px-32 relative">
        <div className="max-w-[1360px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 uppercase tracking-wide">
            <Bot className="size-4" /> Smart Customer Support
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-tight text-[var(--m-text-heading)] transition-colors duration-300">
            An AI Assistant that Resolves Queries 24/7.
          </h2>
          <p className="text-sm leading-relaxed text-[var(--m-text-tertiary)] transition-colors duration-300">
            Our AI customer support assistant reads inbound messages, recognizes user intent, responds using your custom knowledge base, and assigns tags to route high-value leads to proper team queues.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="flex gap-2">
              <span className="text-emerald-400 font-bold font-mono">✓</span>
              <div>
                <h4 className="text-xs font-semibold text-[var(--m-text-secondary)] transition-colors duration-300">
                  Secure Data Controls
                </h4>
                <p className="text-[11px] mt-0.5 text-[var(--m-text-tertiary)] transition-colors duration-300">
                  Fully encrypted storage systems protecting lead data.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="text-emerald-400 font-semibold font-mono">✓</span>
              <div>
                <h4 className="text-xs font-semibold text-[var(--m-text-secondary)] transition-colors duration-300">
                  Instant Booking Sync
                </h4>
                <p className="text-[11px] mt-0.5 text-[var(--m-text-tertiary)] transition-colors duration-300">
                  Allows clients to check slots and reserve meetings on WhatsApp.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* WhatsApp Chat simulation visual component */}
        <div className="relative">
          <div className="absolute inset-0 bg-emerald-500/5 blur-[90px] pointer-events-none" />
          <AIChatSimulation />
        </div>
        </div>
      </section>

      {/* 5. SOCIAL PROOF / METRICS */}
      <section className="py-24 px-8 sm:px-20 lg:px-32 border-y border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/10 transition-colors duration-300 relative">
        <div className="max-w-[1360px] mx-auto space-y-12 relative z-10">
          <div
            className="text-center max-w-3xl mx-auto space-y-4"
          >
            <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[11px] font-semibold tracking-wide uppercase">
              ✨ Platform Standards
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-[var(--m-text-heading)] transition-colors duration-300">
              Engineered for High Reliability
            </h2>
            <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto transition-colors duration-300">
              Built on official Meta WhatsApp Cloud API webhooks with strict data isolation for every tenant.
            </p>
          </div>

          <SocialProofMetrics />
        </div>
      </section>

      {/* 6. TESTIMONIALS SECTION */}
      <section className="py-24 max-w-full overflow-hidden space-y-12 relative">
        <style>{`
          @keyframes testimonial-marquee {
            0% {
              transform: translateX(0%);
            }
            100% {
              transform: translateX(-50%);
            }
          }
          .animate-testimonial-marquee {
            display: flex;
            width: max-content;
            animation: testimonial-marquee 45s linear infinite;
          }
          .animate-testimonial-marquee:hover {
            animation-play-state: paused;
          }
        `}</style>

        <div className="text-center space-y-4 max-w-3xl mx-auto px-8 sm:px-20 lg:px-32">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Industry Blueprints</span>
          <h2 className="text-3xl sm:text-4xl font-semibold text-[var(--m-text-heading)] tracking-tight">
            Built for Real-World Customer Workflows
          </h2>
          <p className="text-sm text-[var(--m-text-tertiary)]">
            Explore how modern teams deploy official WhatsApp Business automation across sectors.
          </p>
        </div>

        {/* Marquee Wrapper */}
        <div className="relative w-full overflow-hidden py-4 select-none">
          {/* Fade gradients */}
          <div className="absolute inset-y-0 left-0 w-16 md:w-32 bg-gradient-to-r from-[var(--m-bg-primary)] to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-16 md:w-32 bg-gradient-to-l from-[var(--m-bg-primary)] to-transparent z-10 pointer-events-none" />

          <div className="animate-testimonial-marquee flex gap-6">
            {/* Duplicated list to enable seamless loop */}
            {[...useCases, ...useCases, ...useCases, ...useCases].map((u, idx) => (
              <div key={idx} className="w-[320px] sm:w-[380px] shrink-0">
                <SpotlightCard interactive={false}>
                  <div className="space-y-4 flex flex-col justify-between h-full min-h-[165px]">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {u.tag}
                      </div>
                      <h4 className="text-sm font-bold text-[var(--m-text-primary)]">{u.title}</h4>
                      <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed pt-1">
                        {u.content}
                      </p>
                    </div>
                    <div className="border-t border-[var(--m-border-primary)]/50 pt-3 mt-4 flex items-center justify-between">
                      <span className="text-[10px] text-[var(--m-text-muted)] font-medium">{u.category}</span>
                      <span className="text-[10px] text-teal-400 font-semibold">{u.metric}</span>
                    </div>
                  </div>
                </SpotlightCard>
              </div>
            ))}
          </div>
        </div>
      </section>



      {/* 8. PRICING PREVIEW */}
      <section className="box-content py-24 px-8 sm:px-20 lg:px-32 border-t border-[var(--m-border-primary)] max-w-[1360px] mx-auto space-y-16">
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
            <Landmark className="size-3.5" /> Pricing Options
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[var(--m-text-heading)]">
            Simple pricing.
          </h2>
          <p className="text-sm text-[var(--m-text-tertiary)]">
            ₹999/month if you manage it, ₹1,999/month if we manage everything, or a custom plan. Prices per WhatsApp number, exclusive of GST.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {pricingCards.map((plan, idx) => (
            <SpotlightCard
              key={idx}
              interactive={true}
              className={plan.primary ? "border-emerald-500/50 shadow-lg relative" : "border-[var(--m-border-primary)]/80"}
              glowColor={plan.primary ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.08)"}
            >
              <div className="space-y-6 flex flex-col justify-between h-full">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--m-text-muted)]">{plan.name}</span>
                    {plan.primary && (
                      <span className="bg-emerald-500 !text-white text-[9px] font-bold uppercase px-2 py-0.5 rounded-full tracking-wider">
                        Recommended
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-semibold text-[var(--m-text-tertiary)]">{plan.tag}</h4>
                  
                  <div className="flex items-baseline gap-1 py-2 border-y border-[var(--m-border-primary)]/50">
                    <span className="text-3xl font-extrabold text-[var(--m-text-heading)]">{plan.price}</span>
                    <span className="text-xs text-[var(--m-text-muted)]">{plan.period}</span>
                  </div>
                  {plan.renewal && (
                    <p className="text-[10px] text-emerald-400 font-medium">{plan.renewal}</p>
                  )}
                  <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed pt-1">
                    {plan.desc}
                  </p>
                </div>

                <div className="space-y-4 pt-4">
                  <ul className="space-y-2 border-t border-[var(--m-border-primary)]/40 pt-4 text-xs text-[var(--m-text-tertiary)]">
                    {plan.features.slice(0, 5).map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <Check className="size-3.5 text-emerald-400 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={plan.link || "/pricing"}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ease-out text-center flex items-center justify-center gap-1.5 ${
                      plan.primary
                        ? "bg-emerald-500 !text-white hover:bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                        : "bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] text-[var(--m-text-secondary)] hover:bg-[var(--m-bg-tertiary)]"
                    }`}
                  >
                    {plan.cta}
                  </Link>
                </div>
              </div>
            </SpotlightCard>
          ))}
        </div>
      </section>

      {/* 9. FAQ SECTION */}
      <section className="box-content py-24 px-8 sm:px-20 lg:px-32 border-t border-[var(--m-border-primary)] max-w-4xl mx-auto space-y-16">
        <div className="text-center space-y-4">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Common Questions</span>
          <h2 className="text-3xl sm:text-4xl font-semibold text-[var(--m-text-heading)] tracking-tight">
            Frequently Asked Questions
          </h2>
          <p className="text-sm text-[var(--m-text-tertiary)]">
            Find details regarding API guidelines, verification steps, and compliant workflows.
          </p>
        </div>

        <div className="space-y-4 pt-6">
          {faqs.map((faq, index) => (
            <details
              key={index}
              className="group border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/10 rounded-xl overflow-hidden"
            >
              <summary className="w-full px-6 py-4 flex items-center justify-between text-left font-semibold text-xs sm:text-sm text-[var(--m-text-secondary)] hover:text-[var(--m-text-heading)] transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span>{faq.q}</span>
                <ChevronDown className="size-4 text-[var(--m-text-muted)] transition-transform group-open:rotate-180 group-open:text-emerald-400" />
              </summary>
              <div className="px-6 pb-5 pt-3 text-xs text-[var(--m-text-tertiary)] leading-relaxed border-t border-[var(--m-border-primary)]/40 bg-[var(--m-bg-secondary)]/20">
                {faq.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* 10. GIANT CTA SECTION */}
      <section className="box-content py-24 px-8 sm:px-20 lg:px-32 relative text-center max-w-[1360px] mx-auto border-t border-[var(--m-border-primary)] transition-colors duration-300">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] h-[350px] rounded-full bg-emerald-500/5 blur-[120px] pointer-events-none" />

        <div className="space-y-6 relative z-10">
          <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight text-[var(--m-text-heading)] transition-colors duration-300">
            Ready to Automate your WhatsApp?
          </h2>
          <p className="text-sm max-w-xl mx-auto text-[var(--m-text-tertiary)] transition-colors duration-300">
            Get started in minutes. Connect your Meta Business account, setup your AI customer support workspace, and watch your business scale.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <MagneticButton>
              <Link
                href="/login"
                className="bg-emerald-500 hover:bg-emerald-400 !text-white px-6 py-3 rounded-xl text-xs font-semibold transition-all duration-300 ease-out shadow-[0_0_16px_rgba(16,185,129,0.2)] hover:shadow-[0_0_24px_rgba(16,185,129,0.4)] flex items-center gap-1.5"
              >
                Start Free Trial <ArrowRight className="size-3.5" />
              </Link>
            </MagneticButton>
            <BookDemoTrigger className="px-6 py-3 rounded-xl text-xs font-semibold transition-all duration-300 ease-out border bg-[var(--m-bg-secondary)] border-[var(--m-border-primary)] text-[var(--m-text-secondary)] hover:bg-[var(--m-bg-tertiary)]">
              Contact Enterprise
            </BookDemoTrigger>
          </div>
        </div>
      </section>
    </div>
  );
}
