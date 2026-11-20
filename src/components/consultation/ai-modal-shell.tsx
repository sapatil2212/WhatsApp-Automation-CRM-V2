'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Centered modal used by the AI prescription assistants. Esc and backdrop close it unless `busy`. */
export function AiModalShell({ title, subtitle, icon, busy, onClose, children }: { title: string; subtitle?: string; icon: ReactNode; busy?: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-md rounded-xl bg-popover p-5 shadow-2xl ring-1 ring-foreground/10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose} disabled={busy} className="size-7 shrink-0"><X className="size-4" /></Button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}