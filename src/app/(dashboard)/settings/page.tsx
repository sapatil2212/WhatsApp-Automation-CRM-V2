'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BellRing, Palette, Tag, User, Users } from 'lucide-react';

import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { TeamManager } from '@/components/settings/team-manager';
import { FollowUpPanel } from '@/components/settings/follow-up-panel';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'tags', label: 'Tags', icon: Tag },
  { id: 'followups', label: 'Follow-ups', icon: BellRing },
  { id: 'appearance', label: 'Appearance', icon: Palette },
] as const;
type TabValue = (typeof TABS)[number]['id'];

const isTabValue = (v: string | null): v is TabValue => TABS.some((t) => t.id === v);

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the single source of truth for the active tab.
  const queryTab = searchParams.get('tab');
  const tab: TabValue = isTabValue(queryTab) ? queryTab : 'profile';

  // WhatsApp configuration moved to Integrations; keep old links working.
  useEffect(() => {
    if (queryTab === 'whatsapp') router.replace('/connections?tab=whatsapp');
  }, [queryTab, router]);

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Your profile, team, tags and workspace preferences. WhatsApp and Google Sheets are under Integrations.</p>
      </div>

      <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border/70 bg-card p-1" role="tablist" aria-label="Settings">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onChange(t.id)}
            className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors', tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <ProfileForm />
          <div className="space-y-4">
            <PasswordForm />
            <SessionsCard />
          </div>
        </div>
      )}
      {tab === 'team' && <TeamManager />}
      {tab === 'tags' && <TagManager />}
      {tab === 'followups' && <FollowUpPanel />}
      {tab === 'appearance' && <AppearancePanel />}
    </div>
  );
}
