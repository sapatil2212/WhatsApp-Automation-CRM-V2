'use client';

import { useMemo, useState } from 'react';

/**
 * Lightweight, dependency-free SVG charts that follow the theme tokens.
 * Interactive: hover shows exact values.
 */

export const SERIES_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#64748b'];

function niceMax(n: number) {
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / pow) * pow;
}

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function AreaChart({
  labels,
  series,
  height = 220,
}: {
  labels: string[];
  series: Array<{ name: string; values: number[]; color?: string }>;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 8, t: 10, b: 24 };
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => pad.l + (i / n) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const labelEvery = Math.max(1, Math.ceil(labels.length / 7));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Trend chart" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeDasharray="3 4" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{t}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % labelEvery === 0 || i === labels.length - 1 ? (
          <text key={l} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{shortDate(l)}</text>
        ) : null))}
        {series.map((s, si) => {
          const color = s.color ?? SERIES_COLORS[si % SERIES_COLORS.length];
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.name}>
              <defs>
                <linearGradient id={`g-${si}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <polygon points={`${x(0)},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}`} fill={`url(#g-${si})`} />
              <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="stroke-foreground/30" />
            {series.map((s, si) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color ?? SERIES_COLORS[si % SERIES_COLORS.length]} className="stroke-background" strokeWidth={2} />
            ))}
          </g>
        )}
        {labels.map((_, i) => (
          <rect key={i} x={x(i) - (W - pad.l - pad.r) / n / 2} y={0} width={(W - pad.l - pad.r) / n} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md" style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 60px), calc(100% - 140px))` }}>
          <p className="font-medium">{shortDate(labels[hover])}</p>
          {series.map((s, si) => (
            <p key={s.name} className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: s.color ?? SERIES_COLORS[si % SERIES_COLORS.length] }} />
              {s.name}: <span className="font-semibold text-foreground">{s.values[hover] ?? 0}</span>
            </p>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {series.map((s, si) => (
          <span key={s.name} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ backgroundColor: s.color ?? SERIES_COLORS[si % SERIES_COLORS.length] }} />{s.name}</span>
        ))}
      </div>
    </div>
  );
}

export function BarList({ items, format = (n: number) => n.toLocaleString(), empty = 'No data yet' }: {
  items: Array<{ label: string; value: number; color?: string; hint?: string }>;
  format?: (n: number) => string;
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={it.label} className="group">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate capitalize">{it.label.replace(/_/g, ' ')}</span>
            <span className="shrink-0 font-semibold tabular-nums">{format(it.value)}{it.hint ? <span className="ml-1 font-normal text-muted-foreground">{it.hint}</span> : null}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-2 rounded-full transition-all duration-500 group-hover:opacity-80" style={{ width: `${(it.value / max) * 100}%`, backgroundColor: it.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Donut({ items, size = 160, center }: { items: Array<{ label: string; value: number; color?: string }>; size?: number; center?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((s, i) => s + i.value, 0);
  const arcs = useMemo(() => {
    const cumulative = items.map((_, i) => items.slice(0, i).reduce((sum, x) => sum + x.value, 0));
    return items.map((it, i) => ({
      ...it,
      start: total ? cumulative[i] / total : 0,
      end: total ? (cumulative[i] + it.value) / total : 0,
      color: it.color ?? SERIES_COLORS[i % SERIES_COLORS.length],
    }));
  }, [items, total]);
  const r = 60;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label="Distribution chart">
        <circle cx={80} cy={80} r={r} fill="none" className="stroke-muted" strokeWidth={20} />
        {arcs.map((a, i) => (
          <circle
            key={a.label}
            cx={80}
            cy={80}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={hover === i ? 24 : 20}
            strokeDasharray={`${(a.end - a.start) * c} ${c}`}
            strokeDashoffset={-a.start * c}
            transform="rotate(-90 80 80)"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="cursor-pointer transition-all"
          />
        ))}
        <text x={80} y={76} textAnchor="middle" className="fill-foreground text-[22px] font-bold">{hover !== null ? arcs[hover].value : total}</text>
        <text x={80} y={96} textAnchor="middle" className="fill-muted-foreground text-[10px]">{hover !== null ? arcs[hover].label.replace(/_/g, ' ') : center ?? 'total'}</text>
      </svg>
      <ul className="min-w-[120px] space-y-1.5 text-xs">
        {arcs.map((a, i) => (
          <li key={a.label} className={`flex items-center gap-2 ${hover === i ? 'font-semibold' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="size-2.5 rounded-full" style={{ backgroundColor: a.color }} />
            <span className="capitalize">{a.label.replace(/_/g, ' ')}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{total ? Math.round((a.value / total) * 100) : 0}%</span>
          </li>
        ))}
        {!arcs.length && <li className="text-muted-foreground">No data yet</li>}
      </ul>
    </div>
  );
}
