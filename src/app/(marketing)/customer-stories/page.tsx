"use client";

import React from "react";
import { MessageSquare, Sparkles, Star, Quote } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";

export default function CustomerStoriesPage() {
  const playbooks = [
    {
      title: "B2B Lead Qualification & Routing",
      domain: "Agencies & SaaS Teams",
      architecture: "Click-to-WhatsApp Ads → Cloud API Webhook → Team Inbox",
      desc: "Capture prospect inquiries directly from Meta advertising campaigns. Auto-tag leads, assign priority tiers, and route hot prospects to available sales reps in under two seconds.",
      features: ["Instant Ad Ingestion", "Agent Ticket Assignment", "Custom Variable Sync"],
    },
    {
      title: "Automated Order Tracking & Alerts",
      domain: "D2C & E-Commerce Retail",
      architecture: "Store Webhook → Verified WhatsApp Template → Delivery Receipts",
      desc: "Keep buyers informed at every stage of fulfillment. Dispatch order confirmations, shipping tracking numbers, and delivery confirmations using pre-approved Meta utility templates.",
      features: ["0% Meta Fee Markup", "Real-Time Read Receipts", "Automated Fallback Handling"],
    },
    {
      title: "Clinic & Appointment Automation",
      domain: "Healthcare & Professional Services",
      architecture: "Booking Calendar → Scheduled Notification → Human Triage",
      desc: "Minimize appointment drop-offs by triggering automated WhatsApp reminders 24 hours prior to consultations. Patients can confirm or request rescheduling in a single tap.",
      features: ["Consent-Verified Templates", "Interactive Buttons", "Multi-Agent Shared Inbox"],
    },
    {
      title: "Customer Support Shared Inbox",
      domain: "Multi-Agent Support Teams",
      architecture: "Inbound User Message → AI Intent Parser → Agent Assignment",
      desc: "Unify support operations in a single shared collaborative inbox. Provide instant answers to frequent queries while enabling seamless escalation to human specialists.",
      features: ["Role-Based Access", "Private Internal Notes", "Conversation History"],
    },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3 animate-pulse" /> implementation playbooks
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          Architecture <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            &amp; Workflow Blueprints.
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          Explore production-tested WhatsApp Business Cloud API workflows designed for high-concurrency engagement and full Meta policy compliance.
        </p>
      </div>

      {/* Blueprints grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {playbooks.map((p, index) => (
          <SpotlightCard key={index} interactive={true} className="p-8 flex flex-col justify-between min-h-[320px]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-bold text-[var(--m-text-primary)]">{p.title}</h4>
                  <span className="text-[10px] text-emerald-400 font-semibold">{p.domain}</span>
                </div>
              </div>
              <div className="rounded-lg bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] p-2.5 text-[11px] font-mono text-[var(--m-text-secondary)]">
                {p.architecture}
              </div>
              <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed">{p.desc}</p>
            </div>
            <div className="border-t border-[var(--m-border-primary)]/50 pt-4 mt-6">
              <div className="flex flex-wrap gap-2">
                {p.features.map((f, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)] border border-[var(--m-border-secondary)]">
                    ✓ {f}
                  </span>
                ))}
              </div>
            </div>
          </SpotlightCard>
        ))}
      </div>
    </div>
  );
}
