'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CornerDownLeft, Loader2, Search } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface Item { id: string; title: string; subtitle?: string; href: string }
interface Group { label: string; items: Item[] }

const PAGES: Item[] = [
  { id: 'p-dash', title: 'Dashboard', href: '/dashboard' },
  { id: 'p-inbox', title: 'Inbox', href: '/inbox' },
  { id: 'p-contacts', title: 'Contacts', href: '/contacts' },
  { id: 'p-campaigns', title: 'Campaigns', href: '/campaigns' },
  { id: 'p-new-campaign', title: 'New campaign', subtitle: 'AI-planned broadcast', href: '/campaigns/new' },
  { id: 'p-templates', title: 'Templates', href: '/templates' },
  { id: 'p-pipelines', title: 'Pipelines', href: '/pipelines' },
  { id: 'p-automations', title: 'Automations', href: '/automations' },
  { id: 'p-flows', title: 'Flows', href: '/flows' },
  { id: 'p-integrations', title: 'Integrations', subtitle: 'WhatsApp · Google Sheets', href: '/connections' },
  { id: 'p-settings', title: 'Settings', href: '/settings' },
];

export function GlobalSearch({ bookingsHref, setupHref }: { bookingsHref: string; setupHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) { setQ(''); setGroups([]); setActive(0); }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setGroups([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!cancelled) setGroups(body?.success ? body.data.groups : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [q]);

  const pages = useMemo(() => {
    const all = [...PAGES, { id: 'p-bookings', title: 'Appointments / Bookings', href: bookingsHref }, { id: 'p-setup', title: 'Business Setup', href: setupHref }];
    const term = q.trim().toLowerCase();
    return term ? all.filter((p) => `${p.title} ${p.subtitle ?? ''}`.toLowerCase().includes(term)).slice(0, 5) : all.slice(0, 6);
  }, [q, bookingsHref, setupHref]);

  const all: Group[] = useMemo(() => [...groups, ...(pages.length ? [{ label: 'Go to', items: pages }] : [])], [groups, pages]);
  const flat = all.flatMap((g) => g.items);

  function go(item?: Item) {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-xl items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent sm:w-96 lg:w-[32rem]"
        aria-label="Search"
      >
        <Search className="size-3.5" />
        <span className="hidden flex-1 text-left sm:inline">Search contacts, bookings, campaigns…</span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              ref={inputRef}
              autoFocus
              value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
              }}
              placeholder="Search contacts, appointments, deals, campaigns, templates, flows…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="max-h-[55vh] overflow-y-auto p-2">
            {q.trim().length >= 2 && !loading && groups.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No records match “{q.trim()}”.</p>
            )}
            {all.map((g) => (
              <div key={g.label} className="mb-1">
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>
                {g.items.map((it) => {
                  const i = flat.indexOf(it);
                  return (
                    <button
                      key={`${g.label}-${it.id}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(it)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${i === active ? 'bg-accent' : ''}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{it.title}</span>
                        {it.subtitle && <span className="block truncate text-xs capitalize text-muted-foreground">{it.subtitle}</span>}
                      </span>
                      {i === active ? <CornerDownLeft className="size-3.5 text-muted-foreground" /> : <ArrowRight className="size-3.5 text-muted-foreground/50" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
