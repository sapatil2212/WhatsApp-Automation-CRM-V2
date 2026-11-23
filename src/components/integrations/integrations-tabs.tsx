'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { FileSpreadsheet, FileText, MessageCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

export type IntegrationTab = 'whatsapp' | 'google-sheets' | 'templates';

const TABS: Array<{ id: IntegrationTab; label: string; href: string; icon: typeof MessageCircle }> = [
  { id: 'whatsapp', label: 'WhatsApp Business', href: '/connections?tab=whatsapp', icon: MessageCircle },
  { id: 'google-sheets', label: 'Google Sheets', href: '/connections?tab=google-sheets', icon: FileSpreadsheet },
  { id: 'templates', label: 'Message templates', href: '/connections/whatsapp-templates', icon: FileText },
];

/** Which integrations tab the current URL belongs to. */
export function useIntegrationTab(): IntegrationTab {
  const pathname = usePathname();
  const q = useSearchParams().get('tab');
  if (pathname.startsWith('/connections/whatsapp-templates')) return 'templates';
  return q === 'google-sheets' ? 'google-sheets' : 'whatsapp';
}

/** Page title + tab bar shared by /connections and /connections/whatsapp-templates. */
export function IntegrationsHeader({ actions }: { actions?: React.ReactNode }) {
  const active = useIntegrationTab();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">Connect WhatsApp Business and the tools your team already uses.</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border/70 bg-card p-1" aria-label="Integrations">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            replace={t.id !== 'templates' && active !== 'templates'}
            aria-current={active === t.id ? 'page' : undefined}
            className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors', active === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            <t.icon className="size-3.5" /> {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
