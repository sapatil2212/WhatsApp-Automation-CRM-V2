"use client";

import { RazorpayIntegration } from "@/components/super-admin/integrations/razorpay-card";

export default function IntegrationsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Payment gateway for signups and renewals. Keys saved here override the server .env.</p>
      </div>
      <RazorpayIntegration />
    </div>
  );
}
