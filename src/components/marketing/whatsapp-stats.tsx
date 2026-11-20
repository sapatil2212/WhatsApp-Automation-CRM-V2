"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Languages, MessageCircle, MousePointerClick, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Stat {
  title: string;
  value: number;
  suffix: string;
  label: string;
  description: string;
  icon: LucideIcon;
  cardClassName: string;
  iconClassName: string;
}

const STATS: Stat[] = [
  {
    title: "98% average open rate",
    value: 98,
    suffix: "%",
    label: "Average open rate",
    description:
      "Messages land in the app customers check dozens of times a day, so reminders, updates and offers are actually seen.",
    icon: MessageCircle,
    cardClassName: "bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/50 hover:shadow-emerald-500/10",
    iconClassName: "text-emerald-500",
  },
  {
    title: "5x higher click-through vs. email",
    value: 5,
    suffix: "x",
    label: "Higher click-through vs. email",
    description:
      "Chat replies, payment links and booking links are one tap away: no inbox, no spam folder, no drop-off.",
    icon: MousePointerClick,
    cardClassName: "bg-sky-500/10 border-sky-500/20 hover:border-sky-500/50 hover:shadow-sky-500/10",
    iconClassName: "text-sky-500",
  },
  {
    title: "2B+ active users worldwide",
    value: 2,
    suffix: "B+",
    label: "Active users worldwide",
    description:
      "Meet leads where they already message. There is no new app to download, remember or forget.",
    icon: Users,
    cardClassName: "bg-violet-500/10 border-violet-500/20 hover:border-violet-500/50 hover:shadow-violet-500/10",
    iconClassName: "text-violet-500",
  },
  {
    title: "71+ languages supported",
    value: 71,
    suffix: "+",
    label: "Languages supported",
    description:
      "Run local-language replies and campaigns from the same inbox, without stitching together extra tools.",
    icon: Languages,
    cardClassName: "bg-amber-500/10 border-amber-500/20 hover:border-amber-500/50 hover:shadow-amber-500/10",
    iconClassName: "text-amber-500",
  },
];

function AnimatedNumber({ value, start }: { value: number; start: boolean }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!start) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [start, value]);

  return <span className="tabular-nums">{display}</span>;
}

export function WhatsAppStats() {
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  // Counters animate once, when the section scrolls into view.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="why-whatsapp" ref={sectionRef} className="relative py-16 sm:py-20 px-8 sm:px-20 lg:px-32">
      <div className="mx-auto max-w-[1360px]">
        <div className="grid items-start gap-6 md:grid-cols-12 md:gap-8">
          <div className="flex flex-col md:col-span-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-500">
              Why marketers choose WhatsApp
            </p>
            <h2 className="mt-3 text-2xl font-semibold leading-[1.12] tracking-tight text-[var(--m-text-heading)] sm:text-3xl md:text-4xl lg:text-5xl">
              The channel your customers <br className="hidden sm:inline" />
              already open
            </h2>
          </div>

          <div className="flex flex-col items-start md:col-span-6 md:pl-6 md:pt-6">
            <p className="max-w-xl text-xs leading-relaxed text-[var(--m-text-tertiary)] sm:text-sm md:text-base">
              Four rounded industry benchmarks explain why businesses move their front desk to WhatsApp. Every reply,
              reminder and payment link arrives in the app your customers already use.
            </p>
            <Link
              href="/contact-us"
              className="mt-5 inline-flex w-fit items-center gap-1.5 border-b-2 border-[var(--m-text-heading)] pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--m-text-heading)] transition-colors hover:border-emerald-500 hover:text-emerald-500"
            >
              <span>See it in action</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:mt-14 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
          {STATS.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.title}
                className={cn(
                  "group flex h-full flex-col rounded-3xl border p-6 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:-translate-y-1 hover:shadow-xl sm:p-7",
                  stat.cardClassName
                )}
              >
                <div className="mb-5 flex w-full items-start justify-between gap-3">
                  <div>
                    <p className="flex items-baseline text-3xl font-semibold tracking-tight text-[var(--m-text-heading)] sm:text-4xl">
                      <AnimatedNumber value={stat.value} start={visible} />
                      <span className="text-xl font-semibold opacity-80 sm:text-2xl">{stat.suffix}</span>
                    </p>
                    <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--m-text-tertiary)]">
                      {stat.label}
                    </p>
                  </div>
                  <span className="grid size-11 shrink-0 place-items-center rounded-full border border-[var(--m-border-primary)] bg-[var(--m-bg-primary)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110 group-hover:rotate-6">
                    <Icon className={cn("size-5", stat.iconClassName)} />
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--m-text-secondary)] sm:text-sm">
                  {stat.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
