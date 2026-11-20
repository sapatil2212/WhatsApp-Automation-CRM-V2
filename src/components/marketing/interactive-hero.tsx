import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarCheck,
  Check,
  Inbox,
  Megaphone,
  Send,
  ShieldCheck,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { BookDemoTrigger } from "./book-demo-trigger";
import { AIChatSimulation } from "./ai-chat-simulation";

const HERO = {
  eyebrow: "Tired of repetitive messages & missed leads?",
  titleBefore: "Simplify Customer Communication with",
  titleHighlight: "WhatsApp",
  titleAfter: "Automation",
  subtitle:
    "Automate lead replies, appointment bookings and follow-ups with a 24/7 AI assistant, a shared team inbox and a visual CRM pipeline, all on the official WhatsApp Business API.",
  points: ["Official Meta Cloud API", "0% markup on Meta fees", "Live in under 30 minutes"],
};

const FEATURES: { label: string; icon: LucideIcon }[] = [
  { label: "AI Auto-Replies", icon: Bot },
  { label: "Shared Team Inbox", icon: Inbox },
  { label: "CRM Pipelines", icon: Users },
  { label: "Broadcast Campaigns", icon: Megaphone },
  { label: "Flow Builder", icon: Workflow },
  { label: "Appointment Booking", icon: CalendarCheck },
  { label: "Click-to-WhatsApp Ads", icon: Send },
  { label: "Live Analytics", icon: BarChart3 },
  { label: "Instant Webhooks", icon: Zap },
  { label: "Official Meta Cloud API", icon: ShieldCheck },
];

const ROW_A = FEATURES;
const ROW_B = [...FEATURES.slice(5), ...FEATURES.slice(0, 5)];

// Support number already used by the signup/renewal flows.
const WHATSAPP_CONTACT = "917745868073";

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm5.83 14.07c-.24.68-1.4 1.25-1.92 1.32-.53.07-1.2.1-3.64-.89-2.8-1.15-4.6-3.99-4.74-4.18-.14-.19-1.14-1.52-1.14-2.9 0-1.38.72-2.06.98-2.35.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.42-.07.66.5.24.58.82 2.01.89 2.16.07.15.12.33.02.53-.1.2-.15.33-.3.51-.15.18-.32.4-.46.54-.15.15-.31.31-.13.62.18.31.8 1.32 1.72 2.14 1.18 1.05 2.17 1.38 2.48 1.53.31.15.49.13.67-.08.18-.21.78-.91.99-1.22.21-.31.42-.26.7-.15.28.11 1.78.84 2.09.99.31.15.52.22.6.35.08.13.08.76-.16 1.44z" />
    </svg>
  );
}

function MarqueeRow({ items, reverse }: { items: typeof FEATURES; reverse?: boolean }) {
  // Two copies so the -50% loop is seamless.
  const loop = [...items, ...items];
  return (
    <div className="hero-mq relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
      <div className={`hero-mq-track flex w-max items-center gap-3 pr-3 ${reverse ? "hero-mq-rev" : ""}`}>
        {loop.map(({ label, icon: Icon }, i) => (
          <span
            key={`${label}-${i}`}
            aria-hidden={i >= items.length}
            className="group inline-flex shrink-0 cursor-default select-none items-center gap-2 rounded-full border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/60 px-3.5 py-1.5 text-[11px] font-semibold text-[var(--m-text-secondary)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:-translate-y-0.5 hover:scale-[1.03] hover:border-emerald-500/60 hover:bg-emerald-500/10 hover:text-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10"
          >
            <Icon className="size-4 text-emerald-500 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-6" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function InteractiveHero() {
  return (
    <section className="hero-gradient relative -mt-16 overflow-hidden pt-[76px] pb-6 sm:pt-20 sm:pb-8 lg:pt-[84px] px-8 sm:px-20 lg:px-32">
      <style>{`
        .hero-gradient { background: linear-gradient(135deg, #07120e 0%, #0a1b14 100%); }
        [data-mtheme="light"] .hero-gradient { background: linear-gradient(135deg, #f8fdfa 0%, #eef9f3 100%); }
        @keyframes hero-mq { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes hero-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        .hero-mq-track { animation: hero-mq 38s linear infinite; }
        .hero-mq-rev { animation-direction: reverse; animation-duration: 46s; }
        .hero-mq:hover .hero-mq-track { animation-play-state: paused; }
        .hero-float { animation: hero-float 5s ease-in-out infinite; }
        .hero-float-2 { animation-delay: -2.5s; }
        @media (prefers-reduced-motion: reduce) {
          .hero-mq-track, .hero-float { animation: none; }
        }
      `}</style>

      {/* Grid backdrop that fades out in a circle around the right-hand visual */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--m-grid-stroke)_1px,transparent_1px),linear-gradient(to_bottom,var(--m-grid-stroke)_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:radial-gradient(circle_at_75%_42%,#000_0%,rgba(0,0,0,0.6)_28%,transparent_62%)] [-webkit-mask-image:radial-gradient(circle_at_75%_42%,#000_0%,rgba(0,0,0,0.6)_28%,transparent_62%)]"
      />
      <div className="relative z-10 mx-auto max-w-[1360px]">
        <div className="grid items-center gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-4">
          {/* Left */}
          <div className="flex flex-col items-start">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold text-emerald-500">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              {HERO.eyebrow}
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--m-text-heading)] sm:text-4xl lg:text-[2.6rem] lg:leading-[1.12]">
              {HERO.titleBefore}{" "}
              <span className="relative inline-block text-emerald-500">
                {HERO.titleHighlight}
                <svg className="absolute -bottom-2 left-0 w-full text-emerald-500/40" viewBox="0 0 200 12" fill="none" aria-hidden>
                  <path d="M2 9.5C50 3.5 150 2 198 8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </span>{" "}
              {HERO.titleAfter}
            </h1>

            <p className="mt-4 max-w-lg text-sm leading-relaxed text-[var(--m-text-tertiary)]">
              {HERO.subtitle}
            </p>

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <Link
                href="/login"
                className="group inline-flex items-center justify-center gap-2 rounded-lg bg-[#00DF82] px-5 py-2.5 text-xs font-semibold text-slate-950 shadow-[0_6px_24px_rgba(0,223,130,0.25)] transition-all duration-300 ease-out hover:-translate-y-px hover:bg-[#00c673]"
              >
                Get Started
                <ArrowRight className="size-4 transition-transform duration-300 ease-out group-hover:translate-x-1" />
              </Link>
              <BookDemoTrigger className="inline-flex items-center justify-center rounded-lg border border-[var(--m-border-secondary)] bg-[var(--m-bg-primary)]/60 px-5 py-2.5 text-xs font-semibold text-[var(--m-text-secondary)] transition-all duration-300 ease-out hover:-translate-y-px hover:border-emerald-500/50 hover:text-emerald-500">
                Book a Live Demo
              </BookDemoTrigger>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[10px] font-medium sm:text-[11px]">
              {HERO.points.map((point) => (
                <span key={point} className="flex items-center gap-1.5 text-[var(--m-text-secondary)]">
                  <Check className="size-4 stroke-[3] text-emerald-500" />
                  {point}
                </span>
              ))}
            </div>
          </div>

          {/* Right: phone with floating stat pills */}
          <div className="relative mx-auto flex w-full justify-center py-2">
            <div className="relative" style={{ zoom: 0.7 }}>
              <AIChatSimulation />

              <div className="hero-float pointer-events-none absolute -right-10 top-16 z-20 hidden items-center gap-2 rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-primary)] px-3.5 py-2 shadow-xl sm:flex">
                <div className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                  <WhatsAppIcon className="size-5" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--m-text-heading)]">98% Open Rate</p>
                  <p className="text-[10px] text-[var(--m-text-tertiary)]">vs 12% on Email</p>
                </div>
              </div>

              <div className="hero-float hero-float-2 pointer-events-none absolute -left-12 bottom-24 z-20 hidden items-center gap-2 rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-primary)] px-3.5 py-2 shadow-xl sm:flex">
                <div className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                  <Bot className="size-5" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--m-text-heading)]">Replies in &lt;1s</p>
                  <p className="text-[10px] font-medium text-emerald-500">● 24/7 AI Assistant</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature marquee: two rows moving in opposite directions, pause on hover */}
        <div className="mt-6 border-t border-[var(--m-border-primary)] pt-4">
          <p className="text-center text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[var(--m-text-muted)]">
            Everything you need to run WhatsApp, in one platform
          </p>
          <div className="mt-3 space-y-2">
            <MarqueeRow items={ROW_A} />
            <MarqueeRow items={ROW_B} reverse />
          </div>
        </div>
      </div>

      {/* Floating WhatsApp widget */}
      <a
        href={`https://wa.me/${WHATSAPP_CONTACT}?text=${encodeURIComponent("Hi ChatNexGen! I'd like to see a demo of WhatsApp CRM automation.")}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 flex size-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-xl transition-transform duration-300 ease-out hover:scale-105 active:scale-95"
        aria-label="Chat with ChatNexGen on WhatsApp"
      >
        <WhatsAppIcon className="size-6" />
      </a>
    </section>
  );
}
