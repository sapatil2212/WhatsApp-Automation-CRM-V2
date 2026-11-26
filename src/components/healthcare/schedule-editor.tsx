'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, Coffee, Copy, CopyCheck, Plus, Trash2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  applyPreset,
  applyToActiveDays,
  copyBreakToDays,
  copyDay,
  describeDay,
  newId,
  SESSION_BOUNDS,
  SESSION_KEYS,
  sessionSlots,
  SLOT_DURATIONS,
  summarize,
  to12h,
  toHHMM,
  toMin,
  validateSchedule,
  WEEKDAYS,
  type Preset,
  type ScheduleIssue,
  type ScheduleSession,
  type SessionKey,
  type Weekday,
  type WeeklySchedule,
} from '@/lib/healthcare/schedule';

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'mon_fri', label: 'Mon–Fri' },
  { id: 'mon_sat', label: 'Mon–Sat' },
  { id: 'all', label: 'All 7 Days' },
  { id: 'weekends', label: 'Weekends Only' },
  { id: 'clear', label: 'Clear All' },
];

const SESSION_HINT: Record<SessionKey, string> = {
  morning: '12:00 AM – 12:00 PM',
  afternoon: '12:00 PM – 4:00 PM',
  evening: '4:00 PM – 12:00 AM',
};

/** 15-minute time options within [from, to] (minutes), labelled in 12h. */
function timeOptions(from: number, to: number) {
  const out: Array<{ value: string; label: string }> = [];
  for (let m = from; m <= to; m += 15) out.push({ value: toHHMM(m), label: m >= 1440 ? '12:00 AM (midnight)' : to12h(toHHMM(m)) });
  return out;
}

const selectCls = 'h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50';

function TimeSelect({ value, onChange, from, to, disabled, label }: { value: string; onChange: (v: string) => void; from: number; to: number; disabled?: boolean; label: string }) {
  const opts = useMemo(() => timeOptions(from, to), [from, to]);
  const known = opts.some((o) => o.value === value);
  return (
    <select aria-label={label} className={selectCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value={value}>{to12h(value)}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Inline "pick days" panel used by Copy Hours and Copy Break. */
function DayPicker({ exclude, onApply, onCancel, title }: { exclude: Weekday; onApply: (days: Weekday[]) => void; onCancel: () => void; title: string }) {
  const [sel, setSel] = useState<Weekday[]>([]);
  const toggle = (d: Weekday) => setSel((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]));
  const others = WEEKDAYS.filter((d) => d !== exclude);
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {others.map((d) => (
          <button key={d} type="button" onClick={() => toggle(d)} className={`rounded-md border px-2 py-1 text-xs transition-colors ${sel.includes(d) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}>
            {d.slice(0, 3)}
          </button>
        ))}
        <button type="button" onClick={() => setSel(sel.length === others.length ? [] : others)} className="rounded-md px-2 py-1 text-xs text-primary hover:underline">
          {sel.length === others.length ? 'None' : 'All'}
        </button>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={!sel.length} onClick={() => onApply(sel)}>Copy to {sel.length || ''} day{sel.length === 1 ? '' : 's'}</Button>
      </div>
    </div>
  );
}

function SessionCard({
  day,
  k,
  session,
  issues,
  onChange,
  onCopyBreak,
}: {
  day: Weekday;
  k: SessionKey;
  session: ScheduleSession;
  issues: ScheduleIssue[];
  onChange: (next: ScheduleSession) => void;
  onCopyBreak: (breakId: string, to: Weekday[]) => void;
}) {
  const bounds = SESSION_BOUNDS[k];
  const [copying, setCopying] = useState<string | null>(null);
  const slots = sessionSlots(session, k).length;
  const set = (patch: Partial<ScheduleSession>) => onChange({ ...session, ...patch });
  const start = toMin(session.start);
  const end = toMin(session.end);

  const addBreak = () => {
    // Default: a 30-minute break in the middle of the session window.
    const mid = Math.floor((start + end) / 2 / 15) * 15;
    const bs = Number.isFinite(mid) ? Math.max(start, Math.min(mid, end - 30)) : bounds.start;
    set({ breaks: [...session.breaks, { id: newId(), name: k === 'evening' ? 'Dinner' : k === 'afternoon' ? 'Lunch' : 'Tea break', start: toHHMM(bs), end: toHHMM(Math.min(bs + 30, end)) }] });
  };

  return (
    <div className={`rounded-lg border p-2.5 space-y-2.5 transition-colors ${session.enabled ? 'border-border bg-card' : 'border-dashed border-border bg-muted/30'}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-foreground">{bounds.label}</p>
          <p className="text-[11px] text-muted-foreground">{SESSION_HINT[k]}</p>
        </div>
        <Switch checked={session.enabled} onCheckedChange={(v: boolean) => set({ enabled: v })} aria-label={`${day} ${bounds.label} session`} />
      </div>

      {session.enabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Start</span>
              <TimeSelect label={`${bounds.label} start`} value={session.start} from={bounds.start} to={bounds.end - 15} onChange={(v) => set({ start: v })} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">End</span>
              <TimeSelect label={`${bounds.label} end`} value={session.end} from={bounds.start + 15} to={bounds.end} onChange={(v) => set({ end: v })} />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Slot
              <select aria-label={`${bounds.label} slot duration`} className={selectCls} value={session.slotMinutes} onChange={(e) => set({ slotMinutes: Number(e.target.value) })}>
                {SLOT_DURATIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{slots} slot{slots === 1 ? '' : 's'}</span>
          </div>

          <div className="space-y-2">
            {session.breaks.map((b) => (
              <div key={b.id} className="space-y-2 rounded-lg bg-muted/50 p-2">
                <div className="flex items-center gap-1.5">
                  <Coffee className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <Input aria-label="Break name" value={b.name} maxLength={40} className="h-7 text-[12px] md:text-[12px]" onChange={(e) => set({ breaks: session.breaks.map((x) => (x.id === b.id ? { ...x, name: e.target.value } : x)) })} />
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Copy break to other days" title="Copy break to days" onClick={() => setCopying(copying === b.id ? null : b.id)}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive" aria-label="Remove break" onClick={() => set({ breaks: session.breaks.filter((x) => x.id !== b.id) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <TimeSelect label="Break start" value={b.start} from={bounds.start} to={bounds.end - 15} onChange={(v) => set({ breaks: session.breaks.map((x) => (x.id === b.id ? { ...x, start: v } : x)) })} />
                  <TimeSelect label="Break end" value={b.end} from={bounds.start + 15} to={bounds.end} onChange={(v) => set({ breaks: session.breaks.map((x) => (x.id === b.id ? { ...x, end: v } : x)) })} />
                </div>
                {copying === b.id && (
                  <DayPicker exclude={day} title={`Copy "${b.name}" (${to12h(b.start)}–${to12h(b.end)}) to the ${bounds.label.toLowerCase()} of:`} onCancel={() => setCopying(null)} onApply={(to) => { onCopyBreak(b.id, to); setCopying(null); }} />
                )}
              </div>
            ))}
            <button type="button" onClick={addBreak} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add break
            </button>
          </div>
        </>
      )}

      {issues.length > 0 && (
        <ul className="space-y-1">
          {issues.map((i, n) => <li key={n} className="flex gap-1 text-[11px] text-destructive"><AlertCircle className="mt-px h-3 w-3 shrink-0" />{i.message}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Weekly availability editor: days × (morning | afternoon | evening) sessions. */
export function ScheduleEditor({ value, onChange }: { value: WeeklySchedule; onChange: (s: WeeklySchedule) => void }) {
  const [open, setOpen] = useState<Weekday | null>(() => WEEKDAYS.find((d) => value.days[d].enabled) ?? 'Monday');
  const [copyFrom, setCopyFrom] = useState<Weekday | null>(null);
  const summary = useMemo(() => summarize(value), [value]);
  const issues = useMemo(() => validateSchedule(value), [value]);

  const setDay = (d: Weekday, patch: Partial<WeeklySchedule['days'][Weekday]>) => onChange({ ...value, days: { ...value.days, [d]: { ...value.days[d], ...patch } } });
  const setSession = (d: Weekday, k: SessionKey, s: ScheduleSession) => setDay(d, { sessions: { ...value.days[d].sessions, [k]: s } });

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <CalendarDays className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-semibold text-foreground">
            {summary.workingDays} Working Day{summary.workingDays === 1 ? '' : 's'} · {summary.slotsPerWeek} Available Slot{summary.slotsPerWeek === 1 ? '' : 's'} per Week
          </span>
          <span className="text-xs text-muted-foreground">Breaks: {summary.breakMinutesPerWeek >= 60 ? `${Math.floor(summary.breakMinutesPerWeek / 60)}h ${summary.breakMinutesPerWeek % 60}m` : `${summary.breakMinutesPerWeek} min`} / week</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {WEEKDAYS.map((d) => {
            const on = summary.activeDays.includes(d);
            return (
              <span key={d} title={`${d}: ${summary.perDay[d]} slots`} className={`rounded-md px-2 py-0.5 text-[11px] ${on ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground line-through'}`}>
                {d.slice(0, 3)}{on ? ` · ${summary.perDay[d]}` : ''}
              </span>
            );
          })}
        </div>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-muted-foreground">Quick presets:</span>
        {PRESETS.map((p) => (
          <Button key={p.id} type="button" size="sm" variant="outline" className={p.id === 'clear' ? 'h-7 text-xs text-destructive hover:text-destructive' : 'h-7 text-xs'} onClick={() => onChange(applyPreset(value, p.id))}>
            {p.label}
          </Button>
        ))}
      </div>

      {/* Days */}
      <div className="space-y-2">
        {WEEKDAYS.map((d) => {
          const day = value.days[d];
          const dayIssues = issues.filter((i) => i.day === d);
          const expanded = open === d;
          return (
            <div key={d} className={`rounded-lg border ${dayIssues.length ? 'border-destructive/50' : 'border-border'} bg-muted/20`}>
              <div className="flex flex-wrap items-center gap-2.5 px-3 py-2">
                <Switch checked={day.enabled} onCheckedChange={(v: boolean) => { setDay(d, { enabled: v }); if (v) setOpen(d); }} aria-label={`${d} working day`} />
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(expanded ? null : d)}>
                  {expanded ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className={`w-24 shrink-0 text-[13px] font-medium ${day.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>{d}</span>
                  <span className="truncate text-xs text-muted-foreground">{day.enabled ? describeDay(day) : 'Not working'}</span>
                </button>
                {day.enabled && <span className="text-xs text-muted-foreground">{summary.perDay[d]} slots</span>}
                {day.enabled && (
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setCopyFrom(copyFrom === d ? null : d)} title="Copy hours to other days">
                      <Copy className="h-3.5 w-3.5" /> Copy hours
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => onChange(applyToActiveDays(value, d))} title="Apply these sessions to every active day">
                      <CopyCheck className="h-3.5 w-3.5" /> Apply to active days
                    </Button>
                  </div>
                )}
              </div>
              {copyFrom === d && (
                <div className="px-3 pb-3">
                  <DayPicker exclude={d} title={`Copy ${d}'s sessions and breaks to:`} onCancel={() => setCopyFrom(null)} onApply={(to) => { onChange(copyDay(value, d, to)); setCopyFrom(null); }} />
                </div>
              )}
              {expanded && day.enabled && (
                <div className="grid gap-2.5 border-t border-border p-2.5 md:grid-cols-3">
                  {SESSION_KEYS.map((k) => (
                    <SessionCard
                      key={k}
                      day={d}
                      k={k}
                      session={day.sessions[k]}
                      issues={dayIssues.filter((i) => i.session === k)}
                      onChange={(s) => setSession(d, k, s)}
                      onCopyBreak={(breakId, to) => onChange(copyBreakToDays(value, d, k, breakId, to))}
                    />
                  ))}
                </div>
              )}
              {dayIssues.some((i) => !i.session) && (
                <p className="px-3 pb-3 text-xs text-destructive">{dayIssues.find((i) => !i.session)!.message}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
