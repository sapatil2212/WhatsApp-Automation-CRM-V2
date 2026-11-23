'use client';

/**
 * Custom pickers for the public booking page: a dropdown (list or grid of
 * options, optional search) and a calendar date picker. Both open directly under
 * the field on every screen size. Keyboard: arrows,
 * Enter/Space, Home/End, Escape. Public page, so light theme only.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Search, type LucideIcon } from 'lucide-react';

const triggerCls =
  'flex h-8 w-full items-center gap-1.5 rounded-lg border bg-white pl-2 pr-1.5 text-left text-[12px] outline-none transition sm:h-9 sm:gap-2 sm:pl-2.5 sm:pr-2 sm:text-[13px] focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-50';

// ── shared popover ─────────────────────────────────────────────

function useDismiss(open: boolean, close: () => void, refs: Array<React.RefObject<HTMLElement | null>>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!refs.some((r) => r.current?.contains(target))) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // refs are stable ref objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);
}

type Placement = { max: number; left: number; width: number };
const DEFAULT_PLACE: Placement = { max: 320, left: 0, width: 0 };
const EDGE = 8; // keep panels this far from the screen edges

/**
 * The panel always opens directly below its field. If there is not enough
 * room below, the page scrolls up just enough to fit it (never pushing the
 * field under the sticky header); the height is capped to what fits. The
 * panel is at least `minWidth` wide and is shifted left if it would run off
 * the right edge (half-width fields on phones).
 */
function placeBelow(el: HTMLElement | null, desired: number, minWidth: number): Placement {
  if (!el || typeof window === 'undefined') return { ...DEFAULT_PLACE, max: desired };
  const header = 64; // sticky business bar
  const gap = 4;
  let r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;

  let below = vh - r.bottom - gap - EDGE;
  if (below < desired) {
    const room = document.documentElement.scrollHeight - (window.scrollY + vh); // how far the page can still scroll
    const shift = Math.max(0, Math.min(desired - below, r.top - header - EDGE, room));
    if (shift > 0) {
      window.scrollBy({ top: shift, behavior: 'auto' });
      r = el.getBoundingClientRect();
      below = vh - r.bottom - gap - EDGE;
    }
  }

  const width = Math.min(Math.max(r.width, minWidth), vw - EDGE * 2);
  let left = 0;
  if (r.left + width > vw - EDGE) left = vw - EDGE - (r.left + width);
  if (r.left + left < EDGE) left = EDGE - r.left;
  return { max: Math.max(160, Math.min(desired, below)), left, width };
}

/** Popover anchored directly under the field. */
function Popover({ place, panelRef, children }: { place: Placement; panelRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  return (
    <div
      ref={panelRef}
      className="absolute top-full z-30 mt-1 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900 shadow-lg animate-in fade-in-0 slide-in-from-top-1"
      style={{ maxHeight: place.max, left: place.left, width: place.width || '100%' }}
    >
      {children}
    </div>
  );
}

function Trigger({ id, open, disabled, loading, icon: Icon, label, placeholder, onOpen, onKeyDown, labelledBy, invalid }: {
  id: string; open: boolean; disabled?: boolean; loading?: boolean; icon: LucideIcon; label?: string; placeholder: string; onOpen: () => void; onKeyDown?: (e: React.KeyboardEvent) => void; labelledBy?: string; invalid?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className={`${triggerCls} ${open ? 'border-emerald-500 ring-2 ring-emerald-500/20' : invalid ? 'border-red-400' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <Icon className={`size-3.5 shrink-0 ${label ? 'text-emerald-600' : 'text-slate-400'}`} />
      <span className={`min-w-0 flex-1 truncate ${label ? 'text-slate-900' : 'text-slate-400'}`}>{label || placeholder}</span>
      {loading ? <Loader2 className="size-3.5 shrink-0 animate-spin text-slate-400" /> : <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
    </button>
  );
}

// ── Dropdown ───────────────────────────────────────────────────────────

export interface DropdownOption {
  value: string;
  label: string;
  /** Second line (list layout). */
  sub?: string;
  /** Right-aligned text, e.g. a price. */
  right?: string;
  /** Small avatar text (initials) or image URL, list layout. */
  avatar?: { text: string; src?: string | null };
  disabled?: boolean;
  /** Options with the same group render under one heading. */
  group?: string;
}

interface DropdownProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder: string;
  /** Accessible name of the option list. */
  title: string;
  icon: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  /** id of the visible label element. */
  labelledBy?: string;
  /** "grid" renders compact chips (e.g. time slots). */
  layout?: 'list' | 'grid';
  /** Search box; defaults to on when there are more than 8 options. */
  searchable?: boolean;
  emptyText?: string;
}

const GRID_COLS = 3;

export function Dropdown({ id: idProp, value, onChange, options, placeholder, title, icon, disabled, loading, invalid, labelledBy, layout = 'list', searchable, emptyText = 'Nothing to choose from.' }: DropdownProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Placement>(DEFAULT_PLACE);
  const panelRef = useRef<HTMLDivElement>(null);

  const showSearch = searchable ?? options.length > 8;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.sub ?? ''} ${o.group ?? ''}`.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const groups = useMemo(() => {
    const out: Array<{ name?: string; items: Array<{ o: DropdownOption; i: number }> }> = [];
    filtered.forEach((o, i) => {
      const last = out[out.length - 1];
      if (last && last.name === o.group) last.items.push({ o, i });
      else out.push({ name: o.group, items: [{ o, i }] });
    });
    return out;
  }, [filtered]);

  const selected = options.find((o) => o.value === value);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);
  useDismiss(open, close, [wrapRef, panelRef]);

  const openMenu = () => {
    if (disabled) return;
    const sel = filtered.findIndex((o) => o.value === value);
    setActive(sel >= 0 ? sel : filtered.findIndex((o) => !o.disabled));
    setPlace(placeBelow(wrapRef.current, layout === 'grid' ? 300 : 280, layout === 'grid' ? 264 : 220));
    setOpen(true);
  };

  // Focus the list (or search) when opened, and keep the active option visible.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      // Touch screens: don't pop the keyboard up just by opening the list.
      const touch = window.matchMedia('(pointer: coarse)').matches;
      if (showSearch && !touch) panelRef.current?.querySelector<HTMLInputElement>('input[data-search]')?.focus({ preventScroll: true });
      else listRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(t);
  }, [open, showSearch]);
  useEffect(() => {
    // Scroll only the list (scrollIntoView can scroll the whole page on phones).
    const list = listRef.current;
    const el = open && active >= 0 ? list?.querySelector<HTMLElement>(`[data-idx="${active}"]`) : null;
    if (!list || !el) return;
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < lr.top) list.scrollTop -= lr.top - er.top + 4;
    else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom + 4;
  }, [open, active]);

  const pick = (o: DropdownOption) => {
    if (o.disabled) return;
    onChange(o.value);
    close();
    (triggerRef.current?.querySelector('button') as HTMLButtonElement | null)?.focus();
  };

  const move = (from: number, step: number) => {
    if (!filtered.length) return -1;
    let i = from;
    for (let n = 0; n < filtered.length; n++) {
      i = Math.min(filtered.length - 1, Math.max(0, i + step));
      if (!filtered[i]?.disabled) return i;
      if (i === 0 || i === filtered.length - 1) break;
    }
    return from;
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const grid = layout === 'grid';
    const keys: Record<string, number> = grid
      ? { ArrowRight: 1, ArrowLeft: -1, ArrowDown: GRID_COLS, ArrowUp: -GRID_COLS }
      : { ArrowDown: 1, ArrowUp: -1 };
    if (e.key in keys) {
      e.preventDefault();
      setActive((a) => move(a < 0 ? -1 : a, keys[e.key]));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(move(-1, 1));
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(move(filtered.length, -1));
    } else if (e.key === 'Enter' || (e.key === ' ' && !showSearch)) {
      e.preventDefault();
      const o = filtered[active];
      if (o) pick(o);
    } else if (e.key === 'Tab') {
      close();
    }
  };

  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div ref={wrapRef} className="relative">
      <div ref={triggerRef}>
        <Trigger
          id={id}
          open={open}
          disabled={disabled}
          loading={loading}
          icon={icon}
          label={selected?.label}
          placeholder={placeholder}
          labelledBy={labelledBy}
          invalid={invalid}
          onOpen={() => (open ? close() : openMenu())}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              openMenu();
            }
          }}
        />
      </div>

      {open && (
        <Popover place={place} panelRef={panelRef}>
          {showSearch && (
            <div className="border-b border-slate-100 p-2">
              <span className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  data-search
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                  onKeyDown={onListKey}
                  placeholder="Search…"
                  aria-controls={`${id}-list`}
                  aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                  className="h-8 w-full rounded-md border border-slate-200 pl-8 pr-2 text-[13px] outline-none focus:border-emerald-500"
                />
              </span>
            </div>
          )}
          <div
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-label={title}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            onKeyDown={onListKey}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 outline-none"
          >
            {filtered.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-slate-500">{query ? 'No matches.' : emptyText}</p>}
            {groups.map((g, gi) => (
              <div key={`${g.name ?? ''}-${gi}`} role={g.name ? 'group' : undefined} aria-label={g.name}>
                {g.name && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.name}</p>}
                <div className={layout === 'grid' ? 'grid grid-cols-3 gap-1.5 px-1 pb-1.5' : ''}>
                  {g.items.map(({ o, i }) => {
                    const isSel = o.value === value;
                    const isActive = i === active;
                    if (layout === 'grid') {
                      return (
                        <button
                          key={o.value}
                          id={optionId(i)}
                          data-idx={i}
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          aria-disabled={o.disabled}
                          tabIndex={-1}
                          onPointerMove={(e) => { if (e.pointerType === 'mouse' && !o.disabled && active !== i) setActive(i); }}
                          onClick={() => pick(o)}
                          className={`h-9 rounded-md border text-[13px] font-medium transition ${
                            isSel ? 'border-emerald-600 bg-emerald-600 text-white' : o.disabled ? 'cursor-not-allowed border-slate-100 text-slate-300 line-through' : isActive ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700'
                          }`}
                        >
                          {o.label}
                        </button>
                      );
                    }
                    return (
                      <button
                        key={o.value}
                        id={optionId(i)}
                        data-idx={i}
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        aria-disabled={o.disabled}
                        tabIndex={-1}
                        onPointerMove={(e) => { if (e.pointerType === 'mouse' && !o.disabled && active !== i) setActive(i); }}
                        onClick={() => pick(o)}
                        className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition ${
                          o.disabled ? 'cursor-not-allowed opacity-40' : isActive ? 'bg-emerald-50' : ''
                        }`}
                      >
                        {o.avatar && (o.avatar.src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={o.avatar.src} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-semibold text-emerald-700">{o.avatar.text}</span>
                        ))}
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[13px] ${isSel ? 'font-semibold text-emerald-800' : 'font-medium text-slate-900'}`}>{o.label}</span>
                          {o.sub && <span className="block truncate text-[11px] text-slate-500">{o.sub}</span>}
                        </span>
                        {o.right && <span className="shrink-0 text-[12px] font-semibold text-emerald-700">{o.right}</span>}
                        <Check className={`size-3.5 shrink-0 text-emerald-600 ${isSel ? '' : 'invisible'}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

// ── DatePicker ─────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const shift = (d: string, n: number) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)) + n)).toISOString().slice(0, 10);
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

interface DatePickerProps {
  id?: string;
  value: string | null;
  onChange: (date: string) => void;
  /** Bookable dates (YYYY-MM-DD) → number of free slots. */
  available: Map<string, number>;
  /** First and last selectable dates (inclusive). */
  min: string;
  max: string;
  placeholder: string;
  title?: string;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  labelledBy?: string;
  /** Shown under a disabled day, e.g. "Clinic closed". */
  reasonFor?: (date: string) => string | null;
}

export function DatePicker({ id: idProp, value, onChange, available, min, max, placeholder, title = 'Choose a date', disabled, loading, invalid, labelledBy, reasonFor }: DatePickerProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ({ y: Number(min.slice(0, 4)), m: Number(min.slice(5, 7)) - 1 }));
  const [focus, setFocus] = useState<string | null>(null);
  const [place, setPlace] = useState<Placement>({ ...DEFAULT_PLACE, max: 380 });
  const panelRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => [...available.keys()].sort(), [available]);
  const earliest = sorted[0] ?? null;
  const today = min;

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [wrapRef, panelRef]);

  const openPicker = () => {
    if (disabled) return;
    const start = value ?? earliest ?? min;
    setView({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
    setFocus(value ?? earliest);
    setPlace(placeBelow(wrapRef.current, 360, 288));
    setOpen(true);
  };

  useEffect(() => {
    if (!open || !focus) return;
    const t = setTimeout(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, [open, focus, view]);

  const minView = Number(min.slice(0, 4)) * 12 + Number(min.slice(5, 7)) - 1;
  const maxView = Number(max.slice(0, 4)) * 12 + Number(max.slice(5, 7)) - 1;
  const cur = view.y * 12 + view.m;
  const goMonth = (delta: number) => {
    const n = Math.min(maxView, Math.max(minView, cur + delta));
    setView({ y: Math.floor(n / 12), m: n % 12 });
  };

  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
    (wrapRef.current?.querySelector(`#${CSS.escape(id)}`) as HTMLButtonElement | null)?.focus();
  };

  /** Next bookable date from `d` going `step` days at a time (falls back to ±1). */
  const nextAvailable = (d: string, step: number) => {
    let x = shift(d, step);
    for (let n = 0; n < 70 && x >= min && x <= max; n++) {
      if (available.has(x)) return x;
      x = shift(x, step > 0 ? 1 : -1);
    }
    return d;
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    if (!focus) return;
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    if (e.key in steps) {
      e.preventDefault();
      const n = nextAvailable(focus, steps[e.key]);
      setFocus(n);
      setView({ y: Number(n.slice(0, 4)), m: Number(n.slice(5, 7)) - 1 });
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [...Array<null>(first).fill(null), ...Array.from({ length: count }, (_, i) => isoOf(view.y, view.m, i + 1))];
  const monthFree = cells.reduce((n, d) => n + (d && available.has(d) ? 1 : 0), 0);

  return (
    <div ref={wrapRef} className="relative">
      <Trigger
        id={id}
        open={open}
        disabled={disabled}
        loading={loading}
        icon={CalendarDays}
        label={value ? shortDate(value) : undefined}
        placeholder={placeholder}
        labelledBy={labelledBy}
        invalid={invalid}
        onOpen={() => (open ? setOpen(false) : openPicker())}
        onKeyDown={(e) => {
          if (!open && e.key === 'ArrowDown') {
            e.preventDefault();
            openPicker();
          }
        }}
      />

      {open && (
        <Popover place={place} panelRef={panelRef}>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" aria-label="Previous month" disabled={cur <= minView} onClick={() => goMonth(-1)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="size-4" /></button>
              <p className="text-[13px] font-semibold text-slate-900" aria-live="polite">
                {new Date(Date.UTC(view.y, view.m, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
              </p>
              <button type="button" aria-label="Next month" disabled={cur >= maxView} onClick={() => goMonth(1)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="size-4" /></button>
            </div>
            <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-slate-400">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d} className="py-1">{d}</span>)}
            </div>
            <div ref={gridRef} role="grid" aria-label={title} onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5">
              {cells.map((d, i) => {
                if (!d) return <span key={`e${i}`} />;
                const free = available.get(d) ?? 0;
                const inRange = d >= min && d <= max;
                const enabled = inRange && free > 0;
                const on = d === value;
                const reason = !enabled && inRange ? reasonFor?.(d) : null;
                return (
                  <button
                    key={d}
                    data-date={d}
                    type="button"
                    role="gridcell"
                    disabled={!enabled}
                    tabIndex={d === focus ? 0 : -1}
                    aria-selected={on}
                    aria-label={`${longDate(d)}${enabled ? `, ${free} slot${free === 1 ? '' : 's'} free` : reason ? `, ${reason}` : ', unavailable'}`}
                    title={reason ?? undefined}
                    onClick={() => pick(d)}
                    onFocus={() => setFocus(d)}
                    className={`relative flex h-10 flex-col items-center justify-center rounded-lg text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500 sm:h-9 ${
                      on ? 'bg-emerald-600 font-bold text-white' : enabled ? 'font-medium text-slate-800 hover:bg-emerald-50' : 'cursor-not-allowed text-slate-300'
                    } ${d === today && !on ? 'ring-1 ring-inset ring-emerald-400' : ''}`}
                  >
                    {Number(d.slice(8))}
                    {enabled && <span className={`absolute bottom-1 size-1 rounded-full ${on ? 'bg-white' : 'bg-emerald-500'}`} />}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-400"><span className="size-1.5 rounded-full bg-emerald-500" /> {monthFree ? `${monthFree} day${monthFree === 1 ? '' : 's'} available` : 'Fully booked this month'}</span>
              {earliest && earliest !== value && (
                <button type="button" onClick={() => pick(earliest)} className="font-semibold text-emerald-700 hover:underline">Earliest: {new Date(`${earliest}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</button>
              )}
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}

