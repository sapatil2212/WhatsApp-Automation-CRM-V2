"use client";

import React from "react";
import { Sparkles, Bot, Users, MessageSquare, Layers, Calendar, Network, Zap } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";

export default function AboutUsPage() {
  const services = [
    {
      title: "WhatsApp CRM",
      desc: "Manage WhatsApp chat threads in a high-fidelity kanban board. Categorize discussions, assign pipelines, track estimated deal values, and tag leads without losing context.",
      icon: Layers,
      glow: "rgba(16, 185, 129, 0.12)",
    },
    {
      title: "Lead Management",
      desc: "Capture lead profiles instantly from Click-to-WhatsApp ads or inbound queries. Segment lists, apply user-defined properties, and assign custom variables to optimize sales follow-ups.",
      icon: Users,
      glow: "rgba(20, 184, 166, 0.12)",
    },
    {
      title: "AI Chatbots",
      desc: "Train smart customer-facing assistants on your company documentation, FAQs, and product catalogs. Resolve queries autonomously 24/7 with natural context understanding.",
      icon: Bot,
      glow: "rgba(16, 185, 129, 0.12)",
    },
    {
      title: "Appointment Automation",
      desc: "Sync bookings and client meetings directly through WhatsApp chats. Allow users to check slots and reserve consultations, sending dynamic automated invites automatically.",
      icon: Calendar,
      glow: "rgba(20, 184, 166, 0.12)",
    },
    {
      title: "Customer Support Automation",
      desc: "Route inquiries to proper team queues, handle recurrent queries through instant replies, and configure fallback mechanisms for human-agent handovers.",
      icon: MessageSquare,
      glow: "rgba(16, 185, 129, 0.12)",
    },
    {
      title: "Workflow Automation",
      desc: "Connect events and external APIs (such as Shopify checkouts or CRM updates) to trigger message alerts, payment reminders, or status changes in real-time.",
      icon: Network,
      glow: "rgba(20, 184, 166, 0.12)",
    },
    {
      title: "Team Collaboration",
      desc: "Unify customer communication in a collaborative shared team inbox. Co-assign threads, write internal notes, and manage agent permissions from a unified view.",
      icon: Zap,
      glow: "rgba(16, 185, 129, 0.12)",
    },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3 animate-pulse" /> our profile
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          About <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">ChatNexGen</span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto leading-relaxed mt-4">
          ChatNexGen is an AI-powered WhatsApp CRM platform helping businesses automate customer communication, manage leads, improve customer support, and streamline operations using the official WhatsApp Business API in accordance with Meta guidelines.
        </p>
      </div>

      {/* Core values block */}
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--m-text-heading)]">Our Core Services</h2>
          <p className="text-xs text-[var(--m-text-tertiary)]">Enterprise-grade utilities designed to accelerate customer engagement</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-6">
          {services.map((service, index) => {
            const Icon = service.icon;
            return (
              <SpotlightCard key={index} glowColor={service.glow} interactive={true}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Icon className="size-4 text-emerald-400" />
                  </div>
                  <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{service.title}</h4>
                </div>
                <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed">
                  {service.desc}
                </p>
              </SpotlightCard>
            );
          })}
        </div>
      </div>
    </div>
  );
}
