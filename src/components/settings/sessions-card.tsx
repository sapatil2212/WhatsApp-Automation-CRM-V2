'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

export function SessionsCard() {
  const [open, setOpen] = useState(false);

  const signOutEverywhere = async () => {
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ global: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(`Sign-out failed: ${err.error || 'Unknown error'}`);
        return;
      }
      window.location.href = '/login';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <section className="rounded-xl border border-border/70 bg-card p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><LogOut className="size-3.5 text-primary" /> Active sessions</h3>
      <p className="mb-3 text-xs text-muted-foreground">Sign out on every device, including this one. Useful if you lost a device or shared your password.</p>
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <LogOut className="size-3.5" /> Sign out of all devices
      </Button>

      <ConfirmationDialog
        isOpen={open}
        onOpenChange={setOpen}
        title="Sign out everywhere?"
        description="Every device logged into this account is signed out and must log in again."
        notes={['You will be taken to the login page.']}
        confirmText="Sign out everywhere"
        variant="destructive"
        icon="warning"
        onConfirm={signOutEverywhere}
      />
    </section>
  );
}
