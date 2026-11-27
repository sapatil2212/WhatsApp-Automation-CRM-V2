"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Briefcase, Car, Check, ChevronDown, Dumbbell, GraduationCap, Hotel, PawPrint, Scissors, Search, Stethoscope, Store, Wrench, X } from "lucide-react";

import { cn } from "@/lib/utils";

/** Signup business categories. The label is what gets saved as the business type. */
export const BUSINESS_CATEGORY_GROUPS = [
  {
    group: "Health & fitness",
    items: [
      { label: "Medical & Allied Health", hint: "Clinics, hospitals, dental, physiotherapy, diagnostics", icon: Stethoscope },
      { label: "Gym & Fitness", hint: "Gyms, yoga, CrossFit, Zumba, fitness studios", icon: Dumbbell },
    ],
  },
  {
    group: "Beauty & lifestyle",
    items: [
      { label: "Beauty & Personal Care", hint: "Salons, spas, makeup artists, barbers", icon: Scissors },
      { label: "Pet Services", hint: "Pet grooming, boarding, training", icon: PawPrint },
    ],
  },
  {
    group: "Services",
    items: [
      { label: "Professional Services", hint: "CA, legal, consultants, agencies", icon: Briefcase },
      { label: "Trades & Home Services", hint: "Plumbing, electrical, cleaning, repairs", icon: Wrench },
      { label: "Automotive Services", hint: "Car and bike service, garages, dealers", icon: Car },
    ],
  },
  {
    group: "Education & hospitality",
    items: [
      { label: "Education & Training", hint: "Schools, coaching classes, courses", icon: GraduationCap },
      { label: "Hospitality", hint: "Hotels, restaurants, travel, events", icon: Hotel },
    ],
  },
  {
    group: "Something else",
    items: [{ label: "Other", hint: "Any other business", icon: Store }],
  },
] as const;

type Item = (typeof BUSINESS_CATEGORY_GROUPS)[number]["items"][number];
const ALL: Item[] = BUSINESS_CATEGORY_GROUPS.flatMap((g) => [...g.items]);

export function CategoryPicker({ id, value, onChange, disabled, triggerClassName }: { id?: string; value: string; onChange: (v: string) => void; disabled?: boolean; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = ALL.find((i) => i.label === value);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    return BUSINESS_CATEGORY_GROUPS.map((g) => ({ group: g.group, items: g.items.filter((i) => !s || i.label.toLowerCase().includes(s) || i.hint.toLowerCase().includes(s) || g.group.toLowerCase().includes(s)) })).filter((g) => g.items.length);
  }, [q]);
  const flat = groups.flatMap((g) => g.items);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    const t = setTimeout(() => search.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      clearTimeout(t);
    };
  }, [open]);

  const choose = (label: string) => {
    onChange(label);
    setOpen(false);
    setQ("");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter" && flat[active]) { e.preventDefault(); choose(flat[active].label); }
  };

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => { setOpen((o) => !o); setActive(Math.max(0, flat.findIndex((i) => i.label === value))); }}
        className={cn("flex items-center gap-2 text-left", triggerClassName)}
      >
        {selected ? (
          <>
            <selected.icon className="size-4 shrink-0 text-emerald-500" />
            <span className="min-w-0 flex-1 truncate">{selected.label}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[var(--m-text-muted)]">Choose your business category</span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-[var(--m-text-muted)] transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-[var(--m-border-secondary)] bg-[var(--m-bg-primary)] shadow-xl" onKeyDown={onKey}>
          <div className="relative border-b border-[var(--m-border-secondary)]">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--m-text-muted)]" />
            <input
              ref={search}
              value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              placeholder="Search, e.g. gym, salon, clinic"
              aria-label="Search categories"
              className="h-9 w-full bg-transparent pl-8 pr-8 text-base text-[var(--m-text-primary)] outline-none placeholder:text-[var(--m-text-muted)] sm:text-[13px]"
            />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)]"><X className="size-3.5" /></button>}
          </div>
          <div id={listId} role="listbox" className="max-h-72 overflow-y-auto overscroll-contain py-1">
            {groups.length === 0 ? (
              <p className="px-3 py-5 text-center text-[12px] text-[var(--m-text-tertiary)]">No match. Choose &quot;Other&quot;.</p>
            ) : (
              groups.map((g) => (
                <div key={g.group} role="group" aria-label={g.group}>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--m-text-muted)]">{g.group}</p>
                  {g.items.map((i) => {
                    const idx = flat.indexOf(i);
                    const on = i.label === value;
                    return (
                      <button
                        key={i.label}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => choose(i.label)}
                        className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors", idx === active ? "bg-[var(--m-bg-secondary)]" : "")}
                      >
                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", on ? "bg-emerald-500 !text-white" : "bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)]")}><i.icon className="size-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[var(--m-text-primary)]">{i.label}</span>
                          <span className="block truncate text-[11px] text-[var(--m-text-tertiary)]">{i.hint}</span>
                        </span>
                        {on && <Check className="size-4 shrink-0 text-emerald-500" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
