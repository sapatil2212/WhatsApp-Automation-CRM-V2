"use client";

import React, { useState } from "react";
import { Sparkles, MapPin, DollarSign, Send, ArrowRight } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";

export default function CareersPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const jobs = [
    {
      role: "Full Stack Software Engineer (Next.js & Node.js)",
      loc: "Pune, India / Hybrid",
      sal: "Competitive (Based on Experience)",
      desc: "Build and optimize high-throughput multi-tenant SaaS features, WhatsApp Cloud API webhook pipelines, and responsive React interfaces.",
    },
    {
      role: "Technical Customer Success & Implementation Lead",
      loc: "Pune, India / Remote (India)",
      sal: "Competitive (Based on Experience)",
      desc: "Guide business clients through Meta Business verification, WhatsApp Cloud API credential configuration, and template approval compliance.",
    },
    {
      role: "AI & Automation Workflow Specialist",
      loc: "Remote (India)",
      sal: "Competitive (Based on Experience)",
      desc: "Design conversational workflows, prompt templates, and CRM integration blueprints for healthcare, e-commerce, and B2B clients.",
    },
  ];

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setEmail("");
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3 animate-pulse" /> join us
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          Careers at <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Brightwave Digital Products LLP.
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          We are engineering the future of WhatsApp Business communication from Pune, India. Join us in building compliant, scalable multi-tenant SaaS tools.
        </p>
      </div>

      {/* Open roles */}
      <div className="space-y-6">
        <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--m-text-muted)] block border-b border-[var(--m-border-primary)] pb-3">
          CURRENT OPEN POSITIONS (INDIA)
        </span>

        <div className="space-y-4">
          {jobs.map((job) => (
            <SpotlightCard key={job.role} interactive={true} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 p-6">
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-[var(--m-text-primary)]">{job.role}</h4>
                <p className="text-xs text-[var(--m-text-tertiary)] max-w-xl">{job.desc}</p>
                <div className="flex gap-4 pt-1.5 text-[10px] text-[var(--m-text-muted)] font-semibold uppercase tracking-wider">
                  <span className="flex items-center gap-1"><MapPin className="size-3" /> {job.loc}</span>
                  <span className="flex items-center gap-1"><DollarSign className="size-3" /> {job.sal}</span>
                </div>
              </div>
              <a
                href={`mailto:careers@chatnexgen.online?subject=Application:%20${encodeURIComponent(job.role)}`}
                className="bg-[var(--m-bg-secondary)] hover:bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)] text-xs font-bold px-4 py-2.5 rounded-lg border border-[var(--m-border-primary)] shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                Apply via Email <ArrowRight className="size-3.5" />
              </a>
            </SpotlightCard>
          ))}
        </div>
      </div>

      {/* Speculative Application */}
      <div className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-card)] p-8 backdrop-blur-md relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/5 to-teal-950/5 pointer-events-none" />
        <div className="max-w-2xl mx-auto text-center space-y-4 relative z-10">
          <h3 className="text-xl sm:text-2xl font-extrabold text-[var(--m-text-primary)]">Don't see your specific role?</h3>
          <p className="text-xs text-[var(--m-text-tertiary)] max-w-md mx-auto leading-relaxed">
            We are always interested in connecting with passionate engineers and customer success leaders in India.
          </p>
          <div className="pt-2">
            <a
              href="mailto:careers@chatnexgen.online?subject=General%20Inquiry%20-%20Brightwave%20Digital%20Products%20LLP"
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 !text-white text-xs font-bold px-6 py-2.5 rounded-lg transition-colors cursor-pointer"
            >
              <Send className="size-3.5" /> Send Resume to careers@chatnexgen.online
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
