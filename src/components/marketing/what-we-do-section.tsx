import Link from "next/link";
import { ArrowRight, BarChart3, Target, Wallet, type LucideIcon } from "lucide-react";

interface Pillar {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Tint classes work on both the dark and light marketing themes. */
  cardClassName: string;
  iconClassName: string;
}

const PILLARS: Pillar[] = [
  {
    title: "Better enquiry reach",
    description:
      "Every enquiry gets an instant reply. Our 24/7 WhatsApp AI assistant answers from your knowledge base, shares your offerings, and books appointments automatically.",
    icon: Target,
    cardClassName: "bg-violet-500/10 border-violet-500/20 hover:border-violet-500/50 hover:shadow-violet-500/10",
    iconClassName: "text-violet-500",
  },
  {
    title: "Better analytics",
    description:
      "Track every conversation, lead, booking and follow-up in real time. Unified CRM pipelines and campaign delivery reports show what drives conversions and retention.",
    icon: BarChart3,
    cardClassName: "bg-sky-500/10 border-sky-500/20 hover:border-sky-500/50 hover:shadow-sky-500/10",
    iconClassName: "text-sky-500",
  },
  {
    title: "Better revenue",
    description:
      "Stop losing revenue to missed follow-ups and forgotten renewals. Automated WhatsApp reminders and campaigns to opted-in contacts bring customers back and lift repeat business.",
    icon: Wallet,
    cardClassName: "bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/50 hover:shadow-emerald-500/10",
    iconClassName: "text-emerald-500",
  },
];

export function WhatWeDoSection() {
  return (
    <section id="about" className="relative py-16 sm:py-20 px-8 sm:px-20 lg:px-32">
      <div className="mx-auto max-w-[1360px]">
        <div className="grid items-start gap-6 md:grid-cols-12 md:gap-8">
          <div className="flex flex-col md:col-span-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-500">What We Do</p>
            <h2 className="mt-3 text-2xl font-semibold leading-[1.12] tracking-tight text-[var(--m-text-heading)] sm:text-3xl md:text-4xl lg:text-5xl">
              We solve daily WhatsApp <br className="hidden sm:inline" />
              growth challenges
            </h2>
          </div>

          <div className="flex flex-col items-start md:col-span-6 md:pl-6 md:pt-6">
            <p className="max-w-xl text-xs leading-relaxed text-[var(--m-text-tertiary)] sm:text-sm md:text-base">
              We help businesses get faster replies, higher retention and predictable collections, bringing WhatsApp
              automation, CRM and a shared inbox together in one platform.
            </p>
            <Link
              href="/about-us"
              className="mt-5 inline-flex w-fit items-center gap-1.5 border-b-2 border-[var(--m-text-heading)] pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--m-text-heading)] transition-colors hover:border-emerald-500 hover:text-emerald-500"
            >
              <span>More About Us</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:mt-14 sm:gap-6 md:grid-cols-3">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.title}
                className={`group flex flex-col rounded-3xl border p-6 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:-translate-y-1 hover:shadow-xl sm:p-8 ${pillar.cardClassName}`}
              >
                <div className="mb-5 flex w-full items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-[var(--m-text-heading)] sm:text-xl">{pillar.title}</h3>
                  <span className="grid size-11 shrink-0 place-items-center rounded-full border border-[var(--m-border-primary)] bg-[var(--m-bg-primary)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110 group-hover:rotate-6">
                    <Icon className={`size-5 ${pillar.iconClassName}`} />
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--m-text-secondary)] sm:text-sm">
                  {pillar.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
