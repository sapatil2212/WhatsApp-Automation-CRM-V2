"use client";

import { useEffect, useState } from "react";
import {
  Info, AlertTriangle, AlertCircle, CheckCircle2,
  Sparkles, X, ArrowRight
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: "info" | "warning" | "success" | "alert" | "maintenance";
  priority: "low" | "normal" | "urgent";
  isDismissible: boolean;
  actionLabel?: string | null;
  actionUrl?: string | null;
}

export function TenantAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    // Load dismissed IDs from local storage
    try {
      const stored = localStorage.getItem("dismissed_announcements");
      if (stored) {
        setDismissedIds(JSON.parse(stored));
      }
    } catch {}

    fetch("/api/announcements")
      .then((res) => (res.ok ? res.json() : { announcements: [] }))
      .then((data) => {
        if (Array.isArray(data.announcements)) {
          setAnnouncements(data.announcements);
        }
      })
      .catch((err) => console.error("Error fetching announcements:", err));
  }, []);

  const handleDismiss = (id: string) => {
    const updated = [...dismissedIds, id];
    setDismissedIds(updated);
    try {
      localStorage.setItem("dismissed_announcements", JSON.stringify(updated));
    } catch {}
  };

  const activeBanners = announcements.filter((a) => !dismissedIds.includes(a.id));

  if (activeBanners.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {activeBanners.map((a) => {
        const style = {
          info: {
            bg: "bg-gradient-to-r from-blue-50 to-indigo-50/60 border-blue-200 text-blue-900",
            icon: Info,
            iconColor: "text-blue-600",
            btn: "bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-500/20",
          },
          warning: {
            bg: "bg-gradient-to-r from-amber-50 to-orange-50/60 border-amber-200 text-amber-950",
            icon: AlertTriangle,
            iconColor: "text-amber-600",
            btn: "bg-amber-600 hover:bg-amber-700 text-white shadow-sm shadow-amber-500/20",
          },
          success: {
            bg: "bg-gradient-to-r from-emerald-50 to-teal-50/60 border-emerald-200 text-emerald-950",
            icon: CheckCircle2,
            iconColor: "text-emerald-600",
            btn: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-500/20",
          },
          alert: {
            bg: "bg-gradient-to-r from-red-50 to-rose-50/60 border-red-200 text-red-950",
            icon: AlertCircle,
            iconColor: "text-red-600",
            btn: "bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-500/20",
          },
          maintenance: {
            bg: "bg-gradient-to-r from-violet-50 to-purple-50/60 border-violet-200 text-violet-950",
            icon: Sparkles,
            iconColor: "text-violet-600",
            btn: "bg-violet-600 hover:bg-violet-700 text-white shadow-sm shadow-violet-500/20",
          },
        }[a.type] || {
          bg: "bg-slate-50 border-slate-200 text-slate-800",
          icon: Info,
          iconColor: "text-slate-600",
          btn: "bg-slate-800 hover:bg-slate-900 text-white",
        };

        const Icon = style.icon;

        return (
          <div
            key={a.id}
            className={cn(
              "relative rounded-xl border p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs transition-all",
              style.bg
            )}
          >
            <div className="flex items-start gap-2.5 flex-1 pr-6 sm:pr-0">
              <div className="p-1.5 rounded-lg bg-white/80 shadow-xs shrink-0 mt-0.5 sm:mt-0">
                <Icon className={cn("size-4", style.iconColor)} />
              </div>
              <div>
                <p className="text-xs font-bold leading-tight flex items-center gap-2">
                  {a.title}
                  {a.priority === "urgent" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-700">
                      Urgent
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-normal">{a.content}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              {a.actionLabel && a.actionUrl && (
                <Link
                  href={a.actionUrl}
                  className={cn(
                    "text-[11px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95",
                    style.btn
                  )}
                >
                  {a.actionLabel}
                  <ArrowRight className="size-3" />
                </Link>
              )}

              {a.isDismissible && (
                <button
                  onClick={() => handleDismiss(a.id)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/50 transition"
                  title="Dismiss banner"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
