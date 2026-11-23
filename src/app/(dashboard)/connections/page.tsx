'use client';

import { Suspense } from 'react';

import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { GoogleSheetsIntegration } from '@/components/integrations/google-sheets-integration';
import { IntegrationsHeader, useIntegrationTab } from '@/components/integrations/integrations-tabs';

/**
 * Integrations (sidebar "Integrations"). Served at /connections because the
 * marketing site already owns /integrations. The "Message templates" tab is
 * its own route: /connections/whatsapp-templates.
 */
function IntegrationsContent() {
  const tab = useIntegrationTab();
  return (
    <div className="space-y-4">
      <IntegrationsHeader />
      {tab === 'google-sheets' ? <GoogleSheetsIntegration /> : <WhatsAppConfig />}
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-12 w-72 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-96 animate-pulse rounded-xl bg-muted/60" />
          <div className="h-96 animate-pulse rounded-xl bg-muted/50" />
        </div>
      }
    >
      <IntegrationsContent />
    </Suspense>
  );
}
