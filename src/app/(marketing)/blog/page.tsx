"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Sparkles, Calendar, BookOpen, ArrowRight } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";

export default function BlogPage() {
  const [filter, setFilter] = useState<"all" | "marketing" | "api">("all");

  const posts = [
    {
      title: "Five WhatsApp Business API Templates to Drive E-commerce Recoveries",
      cat: "marketing",
      date: "May 2026",
      read: "4 min read",
      desc: "Learn how to optimize quick-reply configurations and variables to bypass customer inbox fatigue and boost returns.",
      href: "/whatsapp-marketing",
    },
    {
      title: "Avoiding Meta Number Bans: A Complete Compliance Guideline",
      cat: "api",
      date: "May 2026",
      read: "6 min read",
      desc: "Understand high-quality template scores, opt-out triggers, and official Meta policies to keep your business account active.",
      href: "/features",
    },
    {
      title: "How to Build Automated Flows for Inbound WhatsApp CRM",
      cat: "api",
      date: "May 2026",
      read: "8 min read",
      desc: "An architectural guide to setting up webhooks, managing token boundaries, and handling hand-offs to human agents.",
      href: "/crm",
    },
  ];

  const filtered = posts.filter((p) => filter === "all" || p.cat === filter);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-16">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3 animate-pulse" /> article feed
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          Editorial Insights <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            for Modern Commerce.
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          Read guides on WhatsApp automation workflows, compliance safety rules, and AI sales tactics.
        </p>
      </div>

      {/* Filters bar */}
      <div className="flex gap-2 border-b border-[var(--m-border-primary)] pb-6 justify-center">
        {[
          { id: "all", label: "All Insights" },
          { id: "marketing", label: "Marketing Hacks" },
          { id: "api", label: "API & Engineering" },
        ].map((tag) => (
          <button
            key={tag.id}
            onClick={() => setFilter(tag.id as any)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
              filter === tag.id
                ? "bg-[var(--m-bg-secondary)] border-emerald-500/30 text-emerald-400 shadow-md"
                : "bg-[var(--m-bg-card)] border-[var(--m-border-glass)] text-[var(--m-text-muted)] hover:text-[var(--m-text-secondary)]"
            }`}
          >
            {tag.label}
          </button>
        ))}
      </div>

      {/* Posts List */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {filtered.map((post) => (
          <Link key={post.title} href={post.href} className="block group">
            <SpotlightCard interactive={true} className="flex flex-col justify-between min-h-[300px] h-full">
              <div className="space-y-4">
                <div className="flex gap-3 text-[10px] text-[var(--m-text-muted)] font-semibold">
                  <span className="flex items-center gap-1"><Calendar className="size-3" /> {post.date}</span>
                  <span className="flex items-center gap-1"><BookOpen className="size-3" /> {post.read}</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--m-text-secondary)] group-hover:text-emerald-400 transition-colors leading-snug">
                    {post.title}
                  </h4>
                  <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">{post.desc}</p>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-[var(--m-border-primary)] flex items-center justify-between text-xs font-bold text-[var(--m-text-tertiary)] group-hover:text-[var(--m-text-heading)]">
                <span>Explore Guide</span>
                <ArrowRight className="size-3.5 group-hover:translate-x-1 transition-transform text-emerald-400" />
              </div>
            </SpotlightCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
