'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MIN_PASSWORD = 8;
const fieldCls = 'h-8 text-[13px] md:text-[13px]';
const labelCls = 'text-[11px] font-medium text-muted-foreground';

function PasswordInput({ id, value, onChange, autoComplete, disabled }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; disabled: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} disabled={disabled} required className={`${fieldCls} pr-9`} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground">
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

export function PasswordForm() {
  const { user } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return toast.error('You must be logged in to change your password');
    if (next.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (next !== confirm) return setError('The new passwords do not match.');
    if (next === current) return setError('Choose a password different from your current one.');
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/auth/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, password: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Password update failed');
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/70 bg-card p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="size-3.5 text-primary" /> Change password</h3>
      <p className="mb-3 text-xs text-muted-foreground">At least {MIN_PASSWORD} characters. You stay signed in on this device.</p>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block space-y-1" htmlFor="current-password">
          <span className={labelCls}>Current password</span>
          <PasswordInput id="current-password" value={current} onChange={setCurrent} autoComplete="current-password" disabled={saving} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <label className="block space-y-1" htmlFor="new-password">
            <span className={labelCls}>New password</span>
            <PasswordInput id="new-password" value={next} onChange={setNext} autoComplete="new-password" disabled={saving} />
            {tooShort && <span className="block text-[11px] text-amber-600 dark:text-amber-400">{MIN_PASSWORD - next.length} more character{MIN_PASSWORD - next.length === 1 ? '' : 's'} needed</span>}
          </label>
          <label className="block space-y-1" htmlFor="confirm-password">
            <span className={labelCls}>Confirm new password</span>
            <PasswordInput id="confirm-password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={saving} />
            {mismatch && <span className="block text-[11px] text-rose-600 dark:text-rose-400">Doesn&apos;t match yet</span>}
          </label>
        </div>

        {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

        <div className="flex justify-end">
          <Button type="submit" size="sm" className="gap-1.5" disabled={saving || !current || !next || !confirm || mismatch || tooShort}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Update password
          </Button>
        </div>
      </form>
    </section>
  );
}
