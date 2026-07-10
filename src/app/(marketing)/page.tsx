"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Bot, MessageSquare, Users, Check, ChevronDown, ChevronUp, Landmark, Star } from "lucide-react";
import { ReferenceGrid } from "@/components/marketing/reference-grid";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { MagneticButton } from "@/components/marketing/magnetic-button";
import { AIChatSimulation } from "@/components/marketing/ai-chat-simulation";
import { ReferenceDashboard } from "@/components/marketing/reference-dashboard";
import { SocialProofMetrics } from "@/components/marketing/social-proof-metrics";
import { BookDemoTrigger } from "@/components/marketing/book-demo-trigger";

interface FAQItem {
  q: string;
  a: string;
}

export default function HomePage() {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const testimonials = [
    {
      name: "Dr. Ananya Sharma",
      role: "Clinic Operations Director",
      company: "Aura Health Clinics",
      content: "Switching to ChatNexGen automated our patient booking flow. Clients schedule check-ups directly on WhatsApp, and the AI resolves clinic FAQs instantly. Handovers to our front desk are perfectly seamless.",
      stars: 5,
    },
    {
      name: "Rohan Mehta",
      role: "Founder & CEO",
      company: "CraftedThreads E-Commerce",
      content: "Our customer engagement rates skyrocketed with ChatNexGen's automated order status and shipping alerts. Using the official WhatsApp Business API ensures we maintain a solid reputation and perfect compliance.",
      stars: 5,
    },
    {
      name: "Sneha Nair",
      role: "Lead Product Owner",
      company: "VentureScale SaaS",
      content: "ChatNexGen's visual pipeline editor is custom-built for chat threads. We easily classify inbound leads, auto-assign tickets to support agents, and monitor drop-offs with absolute visual clarity.",
      stars: 5,
    },
  ];

  const faqs: FAQItem[] = [
    {
      q: "What is ChatNexGen and how does it work?",
      a: "ChatNexGen is an AI-powered WhatsApp CRM and customer support platform that integrates with the official WhatsApp Business API. It allows your team to manage conversations in a shared inbox, automate responses via custom AI agents, track leads through kanban pipelines, and sync schedules directly via WhatsApp.",
    },
    {
      q: "Is ChatNexGen compliant with WhatsApp policies?",
      a: "Yes. ChatNexGen is fully compliant with Meta and WhatsApp Business Platform policies. We exclusively utilize official WhatsApp Business API endpoints. We do not support bulk messaging spam, contact scraping, or blast tools, ensuring your business number maintains high reliability.",
    },
    {
      q: "Do I need a WhatsApp Business Account (WABA)?",
      a: "Yes. To run active automation, you need a verified Meta Business Account and a clean phone number. ChatNexGen's support team guides you through the entire Meta Business Verification process to establish your official partner status.",
    },
    {
      q: "What are the subscription rates and API charges?",
      a: "Our flat platform subscription starts at ₹2,999/month per WABA number. WhatsApp's conversation-based rates are charged directly by Meta; ChatNexGen passes through these official Meta charges with absolutely 0% markup.",
    },
    {
      q: "How does the AI Assistant resolve queries?",
      a: "You can upload your database guidelines, FAQs, and service files directly to the platform. Our AI parses user intent, answers client inquiries using your knowledge base guidelines, and flags human agents when a manual takeover is required.",
    },
  ];

  const pricingCards = [
    {
      name: "Starter",
      tag: "Self-Managed Setup",
      price: "₹799",
      period: "/month",
      desc: "Full platform access for self-service automation, visual flow builders, and shared team inbox.",
      features: [
        "Official WhatsApp Business API",
        "Visual Flow & Chatbot Builder",
        "Shared Collaborative Inbox",
        "27+ Native Integrations",
        "0% Markup on Meta API fees",
      ],
      cta: "Get Started",
      link: "/signup",
      primary: false,
    },
    {
      name: "Growth",
      tag: "Done-With-You Setup",
      price: "₹1,499",
      period: " first month",
      renewal: "₹799/month after",
      desc: "Perfect for growing teams. We guide your configuration, verify accounts, and deploy core channels.",
      features: [
        "Everything in Starter plan",
        "Meta Business Verification Assistance",
        "WhatsApp Co-existence Configuration",
        "Custom Integrations Wired In",
        "Dedicated Account Setup Session",
      ],
      cta: "Get Started",
      link: "/signup",
      primary: true,
    },
    {
      name: "Managed",
      tag: "Done-For-You Strategy",
      price: "₹2,999",
      period: " pilot month",
      renewal: "₹799/month after",
      desc: "Fully managed operations. Our automation experts write templates, design bots, and report results.",
      features: [
        "Everything in Growth plan",
        "2-3 Custom Automations built for you",
        "Message Templates written & approved",
        "Dedicated Account Manager",
        "Monthly 1-on-1 Strategy Calls",
      ],
      cta: "Get Started",
      link: "/signup",
      primary: false,
    },
  ];

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

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
      <section className="relative w-full min-h-[88vh] flex flex-col items-center justify-start pt-20 md:pt-28 pb-0 px-4 md:px-6 overflow-hidden">
        {/* Grid Background */}
        <ReferenceGrid gridSize={85} />
        
        <div className="max-w-6xl mx-auto flex flex-col items-center text-center relative z-10 pt-4">
          {/* Tagline Badge */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/50 text-[var(--m-text-secondary)] text-[11px] font-semibold mb-8 shadow-lg transition-all duration-300"
          >
            🚀 AI-Powered WhatsApp CRM & Business Automation
          </motion.div>
          
          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.1] max-w-3xl text-[var(--m-text-heading)] transition-colors duration-300"
          >
            The AI WhatsApp CRM built for customer engagement
          </motion.h1>
          
          {/* Descriptive Paragraph */}
          <motion.p
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-xs sm:text-sm md:text-sm max-w-xl mt-5 leading-relaxed text-[var(--m-text-tertiary)] transition-colors duration-300"
          >
            Sync team conversations, qualify leads automatically, handle support chats with AI assistance, and streamline appointment scheduling on WhatsApp—fully compliant with Meta guidelines.
          </motion.p>
          
          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-row items-center justify-center gap-4 mt-8 w-full relative z-20"
          >
            <MagneticButton>
              <Link
                href="/login"
                className="bg-[#00DF82] hover:bg-[#00c673] text-slate-950 px-8 py-3 rounded-full text-xs font-semibold transition-all shadow-[0_4px_20px_rgba(0,223,130,0.15)] flex items-center justify-center"
              >
                Get Started
              </Link>
            </MagneticButton>
            <BookDemoTrigger className="bg-[var(--m-bg-secondary)]/85 border border-[var(--m-border-primary)] hover:bg-[var(--m-bg-tertiary)]/85 text-[var(--m-text-secondary)] px-8 py-3 rounded-full text-xs font-semibold transition-all flex items-center justify-center">
              Learn More
            </BookDemoTrigger>
          </motion.div>
        </div>

        {/* Dashboard Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 55 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="w-full max-w-6xl mt-10 mx-auto relative z-10"
        >
          <ReferenceDashboard />
        </motion.div>
      </section>



      {/* 3. HOW IT WORKS SECTION */}
      <section className="py-24 px-4 md:px-6 max-w-6xl mx-auto space-y-16 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto space-y-4"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-[var(--m-text-heading)] transition-colors duration-300">
            How it works
          </h2>
          <p className="text-sm text-[var(--m-text-tertiary)] transition-colors duration-300">
            Link and operate your official WhatsApp automation setup in minutes.
          </p>
        </motion.div>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
          {/* Connecting Line */}
          <motion.div
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="absolute top-[20px] left-[20px] w-[calc(66.666%)] h-[1px] bg-emerald-500/20 hidden md:block z-0 origin-left"
          />

          {/* Step 1 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
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
          </motion.div>

          {/* Step 2 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
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
          </motion.div>

          {/* Step 3 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
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
          </motion.div>
        </div>
      </section>

      {/* 4. AI CHAT EXPERIENCE STORY */}
      <section className="py-24 px-4 md:px-6 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative">
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
      </section>

      {/* 5. SOCIAL PROOF / METRICS */}
      <section className="py-24 px-4 md:px-6 border-y border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/10 transition-colors duration-300 relative">
        <div className="max-w-6xl mx-auto space-y-12 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto space-y-4"
          >
            <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[11px] font-semibold tracking-wide uppercase">
              ✨ Social Proof
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-[var(--m-text-heading)] transition-colors duration-300">
              Trusted by growing businesses
            </h2>
            <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto transition-colors duration-300">
              Scale customer engagement and run team operations using our compliant WhatsApp CRM engine.
            </p>
          </motion.div>

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

        <div className="text-center space-y-4 max-w-3xl mx-auto px-4 md:px-6">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Success Stories</span>
          <h2 className="text-3xl sm:text-4xl font-semibold text-[var(--m-text-heading)] tracking-tight">
            What our clients are saying
          </h2>
          <p className="text-sm text-[var(--m-text-tertiary)]">
            Read comments from clinic managers, e-commerce brands, and sales leaders.
          </p>
        </div>

        {/* Marquee Wrapper */}
        <div className="relative w-full overflow-hidden py-4 select-none">
          {/* Fade gradients */}
          <div className="absolute inset-y-0 left-0 w-16 md:w-32 bg-gradient-to-r from-[var(--m-bg-primary)] to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-16 md:w-32 bg-gradient-to-l from-[var(--m-bg-primary)] to-transparent z-10 pointer-events-none" />

          <div className="animate-testimonial-marquee flex gap-6">
            {/* Duplicated list to enable seamless loop */}
            {[...testimonials, ...testimonials, ...testimonials, ...testimonials].map((t, idx) => (
              <div key={idx} className="w-[320px] sm:w-[380px] shrink-0">
                <SpotlightCard interactive={true} glowColor="rgba(20, 184, 166, 0.08)">
                  <div className="space-y-4 flex flex-col justify-between h-full min-h-[165px]">
                    <div className="space-y-2">
                      <div className="flex items-center gap-0.5 text-amber-400">
                        {[...Array(t.stars)].map((_, i) => (
                          <Star key={i} className="size-3.5 fill-current" />
                        ))}
                      </div>
                      <p className="text-xs text-[var(--m-text-tertiary)] italic leading-relaxed pt-1">
                        "{t.content}"
                      </p>
                    </div>
                    <div className="border-t border-[var(--m-border-primary)]/50 pt-3 mt-4">
                      <h4 className="text-xs font-bold text-[var(--m-text-primary)]">{t.name}</h4>
                      <p className="text-[10px] text-[var(--m-text-muted)]">{t.role} • {t.company}</p>
                    </div>
                  </div>
                </SpotlightCard>
              </div>
            ))}
          </div>
        </div>
      </section>



      {/* 8. PRICING PREVIEW */}
      <section className="py-24 px-4 md:px-6 border-t border-[var(--m-border-primary)] max-w-6xl mx-auto space-y-16">
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
            <Landmark className="size-3.5" /> Pricing Options
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[var(--m-text-heading)]">
            One platform. Flat rates.
          </h2>
          <p className="text-sm text-[var(--m-text-tertiary)]">
            Active subscriptions are flat ₹2,999/month per WABA number. Select the initial setup tier that fits your team.
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
                      <span className="bg-emerald-500 text-slate-950 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full tracking-wider">
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
                    {plan.features.slice(0, 4).map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <Check className="size-3.5 text-emerald-400 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={plan.link || "/pricing"}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 ${
                      plan.primary
                        ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
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
      <section className="py-24 px-4 md:px-6 border-t border-[var(--m-border-primary)] max-w-4xl mx-auto space-y-16">
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
          {faqs.map((faq, index) => {
            const isOpen = activeFaq === index;
            return (
              <div
                key={index}
                className="border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/10 rounded-xl overflow-hidden transition-all duration-300"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(index)}
                  className="w-full px-6 py-4 flex items-center justify-between text-left font-semibold text-xs sm:text-sm text-[var(--m-text-secondary)] hover:text-[var(--m-text-heading)] transition-colors"
                >
                  <span>{faq.q}</span>
                  {isOpen ? <ChevronUp className="size-4 text-emerald-400" /> : <ChevronDown className="size-4 text-[var(--m-text-muted)]" />}
                </button>
                
                {isOpen && (
                  <div className="px-6 pb-5 pt-1 text-xs text-[var(--m-text-tertiary)] leading-relaxed border-t border-[var(--m-border-primary)]/40 bg-[var(--m-bg-secondary)]/20">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 10. GIANT CTA SECTION */}
      <section className="py-24 px-4 md:px-6 relative text-center max-w-6xl mx-auto border-t border-[var(--m-border-primary)] transition-colors duration-300">
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
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-6 py-3 rounded-xl text-xs font-semibold transition-all shadow-[0_0_16px_rgba(16,185,129,0.2)] hover:shadow-[0_0_24px_rgba(16,185,129,0.4)] flex items-center gap-1.5"
              >
                Start Free Trial <ArrowRight className="size-3.5" />
              </Link>
            </MagneticButton>
            <BookDemoTrigger className="px-6 py-3 rounded-xl text-xs font-semibold transition-all border bg-[var(--m-bg-secondary)] border-[var(--m-border-primary)] text-[var(--m-text-secondary)] hover:bg-[var(--m-bg-tertiary)]">
              Contact Enterprise
            </BookDemoTrigger>
          </div>
        </div>
      </section>
    </div>
  );
}
