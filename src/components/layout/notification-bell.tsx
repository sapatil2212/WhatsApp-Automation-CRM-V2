'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Bell, CalendarCheck, CheckCheck, FileText, Megaphone, MessageSquare, UserPlus } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTenantEvents, type TenantNotificationEvent } from '@/hooks/use-tenant-events';

interface Item { id: string; type: string; title: string; body?: string; href?: string; at: string }

const ICONS: Record<string, React.ElementType> = { booking: CalendarCheck, message: MessageSquare, lead: UserPlus, campaign: Megaphone, template: FileText };
const SEEN_KEY = 'cng-notifications-seen';

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [seenAt, setSeenAt] = useState<string>('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (body?.success) setItems(body.data.items);
    } catch { /* non-blocking */ }
  }, []);

  useEffect(() => {
    // Async fetch; state is set after the network resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().then(() => {
      try { setSeenAt(localStorage.getItem(SEEN_KEY) ?? ''); } catch { /* storage unavailable */ }
    });
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 120_000);
    return () => window.clearInterval(t);
  }, [load]);

  useTenantEvents((e: TenantNotificationEvent) => {
    const item: Item = { id: `live-${e.at}-${Math.random().toString(36).slice(2, 7)}`, type: e.type, title: e.title, body: e.body, href: e.href, at: e.at };
    setItems((prev) => [item, ...prev].slice(0, 50));
    if (e.type !== 'message') toast(e.title, { description: e.body, action: e.href ? { label: 'View', onClick: () => { window.location.href = e.href!; } } : undefined });
  });

  const unread = items.filter((i) => !seenAt || i.at > seenAt).length;

  function markSeen() {
    const now = new Date().toISOString();
    setSeenAt(now);
    try { localStorage.setItem(SEEN_KEY, now); } catch { /* ignore */ }
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o && unread) markSeen(); }}>
      <PopoverTrigger
        className="relative flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={`Notifications${unread ? ` (${unread} new)` : ''}`}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button onClick={markSeen} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"><CheckCheck className="size-3.5" /> Mark all read</button>
          )}
        </div>
        <ul className="max-h-[420px] divide-y divide-border/60 overflow-y-auto">
          {items.length === 0 && <li className="px-4 py-10 text-center text-xs text-muted-foreground">You&apos;re all caught up.</li>}
          {items.map((it) => {
            const Icon = ICONS[it.type] ?? Bell;
            const isNew = !seenAt || it.at > seenAt;
            const inner = (
              <div className={`flex gap-3 px-4 py-3 transition-colors hover:bg-accent/60 ${isNew ? 'bg-primary/5' : ''}`}>
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">{it.title}</span>
                  {it.body && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{it.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{ago(it.at)}</span>
                </span>
                {isNew && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
              </div>
            );
            return <li key={it.id}>{it.href ? <Link href={it.href} onClick={() => setOpen(false)}>{inner}</Link> : inner}</li>;
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
