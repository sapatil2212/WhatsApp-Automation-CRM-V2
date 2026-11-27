"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

const STATS = [
  { value: 98, suffix: "%", label: "Open Rates" },
  { value: 0, text: "45-60%", label: "Click Rates" },
  { value: 2.6, suffix: "Bn+", decimals: 1, label: "Active Users" },
] as const;

const GLYPHS = ["✉", "☎", "✓", "◉", "@", "#", "✦", "↗", "●", "▣", "♡", "☺"];
const CELL = 34;

/** Faint grid of chat/mail glyphs that lights up around the pointer. */
function GlyphField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, visible = true;
    const mouse = { x: -9999, y: -9999, on: false };
    let cells: { x: number; y: number; g: string; phase: number }[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cells = [];
      for (let y = CELL / 2; y < h; y += CELL)
        for (let x = CELL / 2; x < w; x += CELL)
          cells.push({ x, y, g: GLYPHS[Math.floor(Math.random() * GLYPHS.length)], phase: Math.random() * Math.PI * 2 });
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const c of cells) {
        const twinkle = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t / 1600 + c.phase);
        let a = 0.05 + twinkle * 0.06;
        let size = 1;
        if (mouse.on) {
          const d = Math.hypot(c.x - mouse.x, c.y - mouse.y);
          if (d < 130) {
            const k = 1 - d / 130;
            a += k * 0.75;
            size += k * 0.5;
          }
        }
        ctx.fillStyle = `rgba(74, 222, 128, ${a})`;
        if (size > 1.01) {
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.scale(size, size);
          ctx.fillText(c.g, 0, 0);
          ctx.restore();
        } else ctx.fillText(c.g, c.x, c.y);
      }
    };

    const loop = (t: number) => {
      if (visible) draw(t);
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.on = mouse.x >= 0 && mouse.y >= 0 && mouse.x <= r.width && mouse.y <= r.height;
    };
    const onLeave = () => (mouse.on = false);

    resize();
    draw(0);
    const ro = new ResizeObserver(() => { resize(); draw(0); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    if (!reduce) raf = requestAnimationFrame(loop);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />;
}

function CountUp({ to, decimals = 0, suffix = "", text, run }: { to: number; decimals?: number; suffix?: string; text?: string; run: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run || text) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(to); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1400);
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, to, text]);
  if (text) return <>{text}</>;
  return <>{v.toFixed(decimals)}{suffix}</>;
}

/** "The inbox problem" band shown under the home hero. Always dark, whatever the site theme. */
export function InboxProblem() {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setSeen(true), io.disconnect()), { threshold: 0.15 });
    io.observe(el);
    const fallback = setTimeout(() => setSeen(true), 1500);
    return () => { io.disconnect(); clearTimeout(fallback); };
  }, []);

  const scrollNext = () => {
    const next = ref.current?.nextElementSibling as HTMLElement | null;
    next?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const rise = (delay: number): React.CSSProperties => ({
    opacity: seen ? 1 : 0,
    transform: seen ? "translateY(0)" : "translateY(16px)",
    transition: `opacity 700ms ease-out ${delay}ms, transform 700ms ease-out ${delay}ms`,
  });
  const base = "motion-reduce:!transition-none";

  return (
    <section ref={ref} className="relative isolate overflow-hidden bg-[#030806] py-20 sm:py-28" aria-labelledby="inbox-problem-heading">
      <GlyphField />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(3,8,6,0)_0%,#030806_75%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-[radial-gradient(ellipse_70%_100%_at_50%_100%,rgba(34,197,94,0.28),transparent)]" />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
        <p className={cn("text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400", base)} style={rise(0)}>The inbox problem</p>

        <h2 id="inbox-problem-heading" className="mt-8 w-full whitespace-nowrap font-bold leading-[1.15] tracking-tight" style={{ fontSize: "clamp(1.05rem, 4.6vw, 3rem)" }}>
          <span className="relative inline-block text-white/45">
            Your customers won&apos;t open your email.
            <span
              aria-hidden
              className="absolute -left-1 top-[56%] h-[0.08em] min-h-[2px] -translate-y-1/2 rounded-full bg-emerald-400 transition-[width] duration-1000 ease-out motion-reduce:transition-none"
              style={{ width: seen ? "calc(100% + 0.5rem)" : "0%", transitionDelay: "500ms" }}
            />
          </span>
          <span className={cn("mt-2 block", base)} style={{ ...rise(1300), color: "#ffffff" }}>
            They will open your <span className="text-emerald-400">WhatsApp.</span>
          </span>
        </h2>

        <div className="mt-10 grid w-full max-w-xl grid-cols-3 gap-3 sm:gap-4">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={cn(
                "rounded-xl border border-white/10 bg-white/[0.04] px-2 py-4 backdrop-blur-sm hover:-translate-y-1 hover:border-emerald-400/40 hover:bg-emerald-400/[0.07]",
                base,
                "",
              )}
              style={rise(1700 + i * 120)}
            >
              <p className="text-xl font-bold tabular-nums sm:text-2xl" style={{ color: "#ffffff" }}>
                <CountUp to={s.value} decimals={"decimals" in s ? s.decimals : 0} suffix={"suffix" in s ? s.suffix : ""} text={"text" in s ? s.text : undefined} run={seen} />
              </p>
              <p className="mt-1 text-[11px] text-white/60">{s.label}</p>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={scrollNext}
          className={cn("group mt-12 inline-flex items-center gap-1.5 text-xs text-white/55 hover:text-emerald-300", base, "")}
          style={rise(2200)}
        >
          See how one WhatsApp broadcast reaches all of them
          <ArrowDown className="size-3 transition-transform group-hover:translate-y-0.5" />
        </button>
      </div>
    </section>
  );
}