"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  BarChart3,
  Bot,
  CheckCheck,
  Inbox,
  Megaphone,
  MessagesSquare,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InteractiveGrid } from "@/components/marketing/interactive-grid";

type Variant = "login" | "signup";

// ─── Brand mark (theme-safe, drawn in the DOM rather than from a PNG) ─────────
export function AuthBrand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2.5">
        <div className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 shadow-[0_6px_18px_rgba(16,185,129,0.35)]">
          <MessagesSquare className="size-4.5 text-white" strokeWidth={2.4} />
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-300 ring-2 ring-[var(--m-bg-secondary)]" />
        </div>
        <span className="text-[19px] font-extrabold tracking-tight text-[var(--m-text-heading)]">
          Chat<span className="text-emerald-500">NexGen</span>
        </span>
      </div>
      {!compact && (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--m-text-muted)]">
          <BadgeCheck className="size-3 text-emerald-500" />
          Official WhatsApp Business API
        </span>
      )}
    </div>
  );
}

// ─── Copy per variant ────────────────────────────────────────────────────────
const COPY: Record<
  Variant,
  {
    eyebrow: string;
    titleLead: string;
    titleAccent: string;
    subtitle: string;
    highlights: string[];
  }
> = {
  login: {
    eyebrow: "Your workspace is waiting",
    titleLead: "Pick up every conversation",
    titleAccent: "where it left off.",
    subtitle:
      "Shared inbox, AI replies and campaign analytics — one calm control room for your entire WhatsApp operation.",
    highlights: ["Unified team inbox", "AI answers in seconds", "Meta-verified API"],
  },
  signup: {
    eyebrow: "Start free, scale fast",
    titleLead: "Send personalized campaigns on",
    titleAccent: "WhatsApp.",
    subtitle:
      "Set up your AI agent, sync your CRM and broadcast to thousands — without writing a single line of code.",
    highlights: ["Guided onboarding", "0% markup on Meta fees", "Live in under 30 minutes"],
  },
};

// ─── Live preview data ──────────────────────────────────────────────────────
const CHAT: { from: "them" | "me"; text: string; time: string }[] = [
  { from: "them", text: "Hi! Is the Diwali bundle still in stock? 🎁", time: "10:02" },
  { from: "me", text: "Yes — it ships today. Want me to reserve one for you?", time: "10:02" },
  { from: "them", text: "Please do, I'll pay on delivery.", time: "10:03" },
  { from: "me", text: "Locked in ✅ Order #4821 is reserved.", time: "10:03" },
];

const CAMPAIGNS = [
  { name: "Diwali offer blast", sent: 94, detail: "12,450 delivered" },
  { name: "Abandoned cart nudge", sent: 78, detail: "4,120 delivered" },
  { name: "Appointment reminders", sent: 62, detail: "2,890 delivered" },
];

const BARS = [38, 62, 48, 86, 72, 94, 66];

const TABS = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "insights", label: "Insights", icon: BarChart3 },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TRUST = [
  "UrbanThreads",
  "GlowStudio",
  "Vaidya Clinics",
  "EduPrime",
  "Skyline Realty",
  "AutoCare",
  "NutriBox",
];

export function AuthVisualPanel({ variant }: { variant: Variant }) {
  const copy = COPY[variant];
  const [tab, setTab] = useState<TabId>("inbox");
  const [visible, setVisible] = useState(2);
  const [delivered, setDelivered] = useState(24318);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  // Loop the conversation so the panel always feels alive
  useEffect(() => {
    if (tab !== "inbox") return;
    const id = setInterval(() => {
      setVisible((v) => (v >= CHAT.length ? 2 : v + 1));
    }, 1700);
    return () => clearInterval(id);
  }, [tab]);

  useEffect(() => {
    const id = setInterval(() => {
      setDelivered((v) => v + Math.floor(Math.random() * 4) + 1);
    }, 4200);
    return () => clearInterval(id);
  }, []);

  const handleMove = (e: React.MouseEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -7, y: px * 9 });
  };

  return (
    <div className="relative flex h-full min-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[26px] border border-[var(--m-border-glass)] bg-[var(--m-bg-secondary)] p-7 xl:p-9">
      {/* Ambient light + interactive grid */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 0%, rgba(16,185,129,0.20), transparent 55%), radial-gradient(circle at 95% 95%, rgba(20,184,166,0.16), transparent 55%)",
        }}
      />
      <InteractiveGrid gridSize={44} className="opacity-40" />
      <div className="pointer-events-none absolute -left-16 top-1/3 size-64 rounded-full bg-emerald-500/10 blur-[90px]" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <AuthBrand />

        {/* Headline */}
        <div className="mt-9">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-400">
            <Sparkles className="size-3" />
            {copy.eyebrow}
          </span>
          <h2 className="mt-4 text-[30px] font-extrabold leading-[1.12] tracking-tight text-[var(--m-text-heading)] xl:text-[34px]">
            {copy.titleLead}{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-400 bg-clip-text text-transparent">
              {copy.titleAccent}
            </span>
          </h2>
          <p className="mt-3 max-w-[400px] text-[12.5px] leading-relaxed text-[var(--m-text-tertiary)]">
            {copy.subtitle}
          </p>
        </div>

        {/* Interactive preview */}
        <div className="mt-7 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 rounded-xl border border-[var(--m-border-glass)] bg-[var(--m-bg-primary)]/50 p-1">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTab(id);
                    setVisible(2);
                  }}
                  className={cn(
                    "relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[10.5px] font-bold transition-colors",
                    active
                      ? "text-emerald-400"
                      : "text-[var(--m-text-muted)] hover:text-[var(--m-text-secondary)]"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="auth-tab-pill"
                      className="absolute inset-0 rounded-lg border border-emerald-500/25 bg-emerald-500/10"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <Icon className="relative size-3.5" />
                  <span className="relative">{label}</span>
                </button>
              );
            })}
          </div>

          <div
            ref={cardRef}
            onMouseMove={handleMove}
            onMouseLeave={() => setTilt({ x: 0, y: 0 })}
            className="relative mt-3 min-h-[260px] flex-1 [perspective:1100px]"
          >
            <motion.div
              animate={{ rotateX: tilt.x, rotateY: tilt.y }}
              transition={{ type: "spring", stiffness: 160, damping: 18 }}
              className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--m-border-glass)] bg-[var(--m-bg-glass)]/85 p-3.5 shadow-[0_20px_50px_rgba(2,6,23,0.35)] backdrop-blur-xl [transform-style:preserve-3d]"
            >
              <AnimatePresence mode="wait" initial={false}>
                {tab === "inbox" && (
                  <motion.div
                    key="inbox"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="flex h-full flex-col"
                  >
                    <div className="flex items-center justify-between border-b border-[var(--m-border-glass)] pb-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-[10px] font-bold text-white">
                          PS
                        </div>
                        <div>
                          <p className="text-[11px] font-bold text-[var(--m-text-primary)]">Priya Sharma</p>
                          <p className="flex items-center gap-1 text-[9px] text-emerald-400">
                            <span className="size-1.5 rounded-full bg-emerald-400" /> AI agent handling
                          </p>
                        </div>
                      </div>
                      <span className="rounded-md border border-[var(--m-border-glass)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-[var(--m-text-muted)]">
                        WhatsApp
                      </span>
                    </div>

                    <div className="mt-2.5 flex flex-1 flex-col justify-end gap-2">
                      {CHAT.slice(0, visible).map((m, i) => (
                        <motion.div
                          key={`${m.text}-${i}`}
                          initial={{ opacity: 0, y: 10, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ type: "spring", stiffness: 320, damping: 26 }}
                          className={cn(
                            "flex max-w-[84%] flex-col rounded-xl px-2.5 py-1.5",
                            m.from === "me"
                              ? "ml-auto rounded-br-sm border border-emerald-500/25 bg-emerald-500/12 text-emerald-50"
                              : "rounded-bl-sm border border-[var(--m-border-glass)] bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)]"
                          )}
                        >
                          <span className="text-[10.5px] leading-snug">{m.text}</span>
                          <span
                            className={cn(
                              "mt-0.5 flex items-center justify-end gap-1 text-[8px]",
                              m.from === "me" ? "text-emerald-300/80" : "text-[var(--m-text-muted)]"
                            )}
                          >
                            {m.time}
                            {m.from === "me" && <CheckCheck className="size-2.5" />}
                          </span>
                        </motion.div>
                      ))}

                      {visible < CHAT.length && (
                        <div className="flex w-12 items-center justify-center gap-1 rounded-xl rounded-bl-sm border border-[var(--m-border-glass)] bg-[var(--m-bg-tertiary)] px-2 py-2">
                          {[0, 1, 2].map((d) => (
                            <motion.span
                              key={d}
                              className="size-1 rounded-full bg-emerald-400"
                              animate={{ opacity: [0.25, 1, 0.25] }}
                              transition={{ duration: 1.1, repeat: Infinity, delay: d * 0.16 }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {tab === "campaigns" && (
                  <motion.div
                    key="campaigns"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="flex h-full flex-col gap-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold text-[var(--m-text-primary)]">Live broadcasts</p>
                      <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-400">
                        <Zap className="size-2.5" /> Sending
                      </span>
                    </div>
                    {CAMPAIGNS.map((c, i) => (
                      <div
                        key={c.name}
                        className="rounded-xl border border-[var(--m-border-glass)] bg-[var(--m-bg-primary)]/40 p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[10.5px] font-semibold text-[var(--m-text-secondary)]">
                            {c.name}
                          </p>
                          <span className="shrink-0 text-[9px] font-bold text-emerald-400">{c.sent}%</span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--m-bg-tertiary)]">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${c.sent}%` }}
                            transition={{ duration: 0.9, delay: i * 0.12, ease: "easeOut" }}
                            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400"
                          />
                        </div>
                        <p className="mt-1 text-[9px] text-[var(--m-text-muted)]">{c.detail}</p>
                      </div>
                    ))}
                  </motion.div>
                )}

                {tab === "insights" && (
                  <motion.div
                    key="insights"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="flex h-full flex-col"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold text-[var(--m-text-primary)]">This week</p>
                      <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400">
                        <TrendingUp className="size-2.5" /> +38%
                      </span>
                    </div>
                    <div className="mt-3 flex flex-1 items-end gap-2">
                      {BARS.map((h, i) => (
                        <div key={i} className="flex h-full flex-1 flex-col justify-end gap-1">
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: `${h}%` }}
                            transition={{ duration: 0.7, delay: i * 0.06, ease: "easeOut" }}
                            className={cn(
                              "w-full rounded-md",
                              i === BARS.length - 2
                                ? "bg-gradient-to-t from-emerald-500/40 to-emerald-400"
                                : "bg-gradient-to-t from-teal-500/20 to-teal-400/60"
                            )}
                          />
                          <span className="text-center text-[8px] text-[var(--m-text-muted)]">
                            {["M", "T", "W", "T", "F", "S", "S"][i]}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-[var(--m-border-glass)] bg-[var(--m-bg-primary)]/40 px-2 py-1.5">
                        <p className="text-[8.5px] uppercase tracking-wider text-[var(--m-text-muted)]">
                          Read rate
                        </p>
                        <p className="text-[12px] font-bold text-emerald-400">98.4%</p>
                      </div>
                      <div className="rounded-lg border border-[var(--m-border-glass)] bg-[var(--m-bg-primary)]/40 px-2 py-1.5">
                        <p className="text-[8.5px] uppercase tracking-wider text-[var(--m-text-muted)]">
                          Avg. reply
                        </p>
                        <p className="text-[12px] font-bold text-emerald-400">1.2s</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Floating chips */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="pointer-events-none absolute -right-2 -top-3 flex items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-[var(--m-bg-secondary)]/95 px-2.5 py-1.5 shadow-lg backdrop-blur"
            >
              <Bot className="size-3.5 text-emerald-400" />
              <div>
                <p className="text-[9px] font-bold leading-none text-[var(--m-text-primary)]">AI agent</p>
                <p className="mt-0.5 text-[8px] leading-none text-emerald-400">online 24×7</p>
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [0, -5, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="pointer-events-none absolute -bottom-4 -left-3 rounded-xl border border-[var(--m-border-glass)] bg-[var(--m-bg-secondary)]/95 px-3 py-1.5 shadow-lg backdrop-blur"
            >
              <p className="text-[8px] uppercase tracking-wider text-[var(--m-text-muted)]">
                Messages today
              </p>
              <p className="text-[13px] font-extrabold tabular-nums text-[var(--m-text-heading)]">
                {delivered.toLocaleString("en-IN")}
              </p>
            </motion.div>
          </div>
        </div>

        {/* Highlights */}
        <div className="relative z-10 mt-7 flex flex-wrap gap-1.5">
          {copy.highlights.map((h) => (
            <span
              key={h}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--m-border-glass)] bg-[var(--m-bg-primary)]/50 px-2.5 py-1 text-[10px] font-semibold text-[var(--m-text-tertiary)]"
            >
              <span className="size-1 rounded-full bg-emerald-400" />
              {h}
            </span>
          ))}
        </div>

        {/* Social proof */}
        <div className="relative z-10 mt-6 border-t border-[var(--m-border-glass)] pt-4">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--m-text-muted)]">
            Trusted by 2,500+ growing businesses
          </p>
          <div className="relative mt-2.5 overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[var(--m-bg-secondary)] to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--m-bg-secondary)] to-transparent" />
            <style>{`
              @keyframes auth-trust-marquee {
                0% { transform: translateX(0); }
                100% { transform: translateX(-50%); }
              }
              .auth-trust-track {
                display: flex;
                width: max-content;
                gap: 1.5rem;
                animation: auth-trust-marquee 22s linear infinite;
              }
              .auth-trust-track:hover { animation-play-state: paused; }
            `}</style>
            <div className="auth-trust-track">
              {[...TRUST, ...TRUST].map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="shrink-0 text-[11px] font-bold tracking-tight text-[var(--m-text-tertiary)]/70 transition-colors hover:text-[var(--m-text-secondary)]"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
