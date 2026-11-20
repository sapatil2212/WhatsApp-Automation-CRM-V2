"use client";

import { useState } from "react";
import type { Deal, PipelineStage } from "@/types";
import { AlertCircle, CalendarDays, Check, Clock, X } from "lucide-react";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

export function formatMoney(value: number, currency?: string) {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency: currency || "USD",
      notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  } catch {
    return `${currency ?? ""} ${Math.round(Number(value || 0)).toLocaleString()}`;
  }
}

const AVATAR = ["bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-teal-500"];
function avatarClass(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}
function initials(name?: string | null, fallback?: string | null) {
  const src = (name || "").trim();
  if (!src) return fallback ? "#" : "?";
  const p = src.split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function daysSince(iso: string | undefined, now: number) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const [now] = useState(() => Date.now());
  const contactLabel = deal.contact?.name || (deal.contact?.phone ? `+${deal.contact.phone}` : "No contact");
  const close = deal.expected_close_date ? new Date(deal.expected_close_date) : null;
  const open = !deal.status || deal.status === "active" || deal.status === "open";
  const overdue = Boolean(close && open && close.getTime() < now - 86_400_000);
  const age = daysSince(deal.updated_at ?? deal.created_at, now);

  return (
    <button
      type="button"
      onClick={(e) => {
        // A tap still fires onClick: the pointer sensor needs 5px of movement to start a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer overflow-hidden rounded-xl border border-border/80 bg-card py-3 pl-4 pr-3 text-left shadow-xs transition-all ${
        isOverlay ? "rotate-1 shadow-xl ring-2 ring-primary/30" : "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
      }`}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: stage?.color ?? "#94a3b8" }} />

      <div className="flex items-start justify-between gap-2">
        <h4 className="line-clamp-2 flex-1 text-sm font-semibold leading-snug">{deal.title}</h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            <Check className="size-3" /> Won
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
            <X className="size-3" /> Lost
          </span>
        )}
      </div>

      <p className="mt-1.5 text-base font-bold tabular-nums">{formatMoney(deal.value, deal.currency)}</p>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-foreground ${avatarClass(deal.contact_id ?? deal.id)}`}>
            {initials(deal.contact?.name, deal.contact?.phone)}
          </span>
          <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
        </div>
        {deal.assignee?.full_name && (
          <span title={`Owner: ${deal.assignee.full_name}`} className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
            {initials(deal.assignee.full_name)}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        {close ? (
          <span className={`inline-flex items-center gap-1 ${overdue ? "font-medium text-red-600 dark:text-red-400" : ""}`}>
            {overdue ? <AlertCircle className="size-3" /> : <CalendarDays className="size-3" />}
            {overdue ? "Overdue · " : ""}
            {close.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </span>
        ) : (
          <span className="italic">No close date</span>
        )}
        <span className={`inline-flex items-center gap-1 ${open && age > 14 ? "text-amber-600 dark:text-amber-400" : ""}`} title="Days since last update">
          <Clock className="size-3" /> {age}d
        </span>
      </div>
    </button>
  );
}
