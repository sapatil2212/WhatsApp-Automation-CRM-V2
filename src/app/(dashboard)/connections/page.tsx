'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, FileSpreadsheet, MessageCircle, Plug, ShieldCheck } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { GoogleSheetsIntegration } from '@/components/integrations/google-sheets-integration';

/**
 * Integrations (sidebar "Integrations"). Served at /connections because the
 * marketing site already owns /integrations.
 */

const TABS = ['whatsapp', 'google-sheets'] as const;
type Tab = (typeof TABS)[number];

function IntegrationsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(q ?? '') ? (q as Tab) : 'whatsapp';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Plug className="size-6 text-primary" /> Integrations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Connect WhatsApp Business and the tools your team already uses.</p>
      </div>
      <Tabs value={tab} onValueChange={(v) => router.replace(`/connections?tab=${v}`)}>
        <TabsList className="h-10 w-fit gap-1 border border-border bg-muted/50 p-1">
          <TabsTrigger value="whatsapp" className="gap-1.5 px-3"><MessageCircle className="size-4" /> WhatsApp Business</TabsTrigger>
          <TabsTrigger value="google-sheets" className="gap-1.5 px-3"><FileSpreadsheet className="size-4" /> Google Sheets</TabsTrigger>
        </TabsList>
        <TabsContent value="whatsapp" className="mt-5 space-y-4">
          <Link href="/connections/whatsapp-templates" className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10">
            <ShieldCheck className="size-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Message templates for appointments</span>
              <span className="block text-xs text-muted-foreground">Get confirmations and reminders approved by Meta so they reach customers outside the 24-hour window.</span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
          <WhatsAppConfig />
        </TabsContent>
        <TabsContent value="google-sheets" className="mt-5"><GoogleSheetsIntegration /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-9 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-96 animate-pulse rounded-2xl bg-muted/50" />
        </div>
      }
    >
      <IntegrationsContent />
    </Suspense>
  );
}
