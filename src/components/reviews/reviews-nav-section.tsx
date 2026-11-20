'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { BarChart3, Bot, Building2, ChevronDown, LayoutDashboard, Megaphone, QrCode, Settings, Star } from 'lucide-react';

import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/reviews', label: 'Overview', icon: LayoutDashboard },
  { href: '/reviews/businesses', label: 'Businesses', icon: Building2 },
  { href: '/reviews/campaigns', label: 'Review Campaigns', icon: Megaphone },
  { href: '/reviews/qr-codes', label: 'QR Codes', icon: QrCode },
  { href: '/reviews/jobs', label: 'Automation Jobs', icon: Bot },
  { href: '/reviews/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/reviews/settings', label: 'Settings', icon: Settings },
];

/** Sidebar group for the Google Review module. Self-contained so the sidebar only renders it. */
export function ReviewsNavSection() {
  const pathname = usePathname();
  const inReviews = pathname === '/reviews' || pathname.startsWith('/reviews/');
  const [open, setOpen] = useState(inReviews);
  const expanded = open || inReviews;

  return (
    <>
      <div className="my-3 border-t border-sidebar-border/60" />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors lg:py-1.5',
          inReviews ? 'text-primary' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )}
      >
        <Star className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-left">Reviews</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-200', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border/60 pl-2 ml-4">
          {ITEMS.map((item) => {
            const active = item.href === '/reviews' ? pathname === '/reviews' : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors',
                    active ? 'bg-primary/10 text-primary' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  )}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}