'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Eye, EyeOff, Loader2, RotateCcw, Save, Webhook, XCircle, Zap } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { cn } from '@/lib/utils';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;
interface PhoneInfo { verified_name?: string; display_phone_number?: string; quality_rating?: string }

const fieldCls = 'h-8 text-[13px] md:text-[13px]';
const labelCls = 'text-[11px] font-medium text-muted-foreground';

const SETUP_STEPS: Array<{ title: string; body: React.ReactNode }> = [
  { title: 'Create a Meta app', body: <>On <span className="text-primary">developers.facebook.com</span> go to My Apps → Create App and choose <b>Business</b>.</> },
  { title: 'Add the WhatsApp product', body: <>In the app dashboard click Add Product → WhatsApp → Set up, and link your business.</> },
  { title: 'Copy your credentials', body: <>WhatsApp → API Setup: copy the <b>Phone Number ID</b> and <b>WhatsApp Business Account ID</b>. Create a <b>permanent token</b> under Business Settings → System Users.</> },
  { title: 'Connect the webhook', body: <>WhatsApp → Configuration → Webhook → Edit. Paste the <b>Callback URL</b> and <b>Verify token</b> from this page, then subscribe to <b>messages</b>.</> },
];

function SecretInput({ value, onChange, onFocus, placeholder }: { value: string; onChange: (v: string) => void; onFocus: () => void; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} className={cn(fieldCls, 'pr-9 font-mono')} autoComplete="off" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide' : 'Show'} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground">
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex gap-1.5">
      <Input readOnly value={value} className={cn(fieldCls, 'bg-muted/40 font-mono')} onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="size-8 shrink-0"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        disabled={!value}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
          } catch {
            toast.error('Could not copy. Select the text and copy it manually.');
          }
        }}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

export function WhatsAppConfig() {
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [phoneInfo, setPhoneInfo] = useState<PhoneInfo | null>(null);

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);
  const [metaAppSecret, setMetaAppSecret] = useState('');
  const [metaAppSecretEdited, setMetaAppSecretEdited] = useState(false);

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/webhook` : '';

  const applyHealth = useCallback((payload: { connected?: boolean; needs_reset?: boolean; reason?: string; message?: string; phone_info?: PhoneInfo }) => {
    if (payload.connected) {
      setConnectionStatus('connected');
      setResetReason(null);
      setStatusMessage('');
      setPhoneInfo(payload.phone_info ?? null);
    } else {
      setConnectionStatus('disconnected');
      setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
      setStatusMessage(payload.message || '');
      setPhoneInfo(null);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      // Form values via the JWT-authenticated API (PUT = read config row).
      const rowRes = await fetch('/api/whatsapp/config', { method: 'PUT' });
      const rowJson = await rowRes.json();
      if (!rowRes.ok) console.error('Failed to load config row:', rowJson);
      const data = rowJson.data ?? null;

      setConfig(data);
      setPhoneNumberId(data?.phone_number_id || '');
      setWabaId(data?.waba_id || '');
      setAccessToken(data ? MASKED_TOKEN : '');
      setVerifyToken(data?.verify_token || '');
      setMetaAppSecret(data?.meta_app_secret || '');
      setTokenEdited(false);
      setMetaAppSecretEdited(false);

      // Health check (decrypts token + pings Meta).
      if (data) {
        try {
          const res = await fetch('/api/whatsapp/config', { method: 'GET' });
          applyHealth(await res.json());
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        applyHealth({ connected: false });
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Failed to load WhatsApp configuration');
    } finally {
      setLoading(false);
    }
  }, [applyHealth]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchConfig();
  }, [authLoading, user, fetchConfig]);

  async function handleSave() {
    if (!phoneNumberId.trim()) return toast.error('Phone Number ID is required');
    if (!config && (!accessToken.trim() || !tokenEdited)) return toast.error('Access token is required for the first setup');

    setSaving(true);
    try {
      // The API verifies with Meta and encrypts the token server-side.
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
      };
      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) payload.access_token = accessToken.trim();
      else if (config) payload.access_token = MASKED_TOKEN;
      if (metaAppSecretEdited && metaAppSecret !== MASKED_TOKEN && metaAppSecret.trim()) payload.meta_app_secret = metaAppSecret.trim();
      else if (config) payload.meta_app_secret = MASKED_TOKEN;

      const res = await fetch('/api/whatsapp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        return;
      }
      toast.success(data.phone_info?.verified_name ? `Connected to ${data.phone_info.verified_name}` : 'Configuration saved');
      await fetchConfig();
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();
      applyHealth(payload);
      if (payload.connected) toast.success(payload.phone_info?.verified_name ? `Connected to ${payload.phone_info.verified_name}` : 'API connection successful');
      else toast.error(payload.message || 'API connection failed');
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Connection test failed. Check your network and try again.');
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to reset configuration');
        return;
      }
      toast.success('Configuration cleared. You can now re-enter your credentials.');
      setConfig(null);
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setMetaAppSecret('');
      setTokenEdited(false);
      setMetaAppSecretEdited(false);
      applyHealth({ connected: false });
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  async function handleSubscribeWaba() {
    setSubscribing(true);
    try {
      const res = await fetch('/api/whatsapp/subscribe-waba', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to subscribe WABA to webhooks');
        return;
      }
      toast.success('Webhooks subscribed. Meta will now deliver messages to this app.');
    } catch (err) {
      console.error('Subscribe WABA error:', err);
      toast.error('Failed to subscribe WABA to webhooks');
    } finally {
      setSubscribing(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-16 animate-pulse rounded-xl bg-muted/60" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
          <div className="h-72 animate-pulse rounded-xl bg-muted/60" />
        </div>
      </div>
    );
  }

  const connected = connectionStatus === 'connected';

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3', connected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/70 bg-card')}>
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', connected ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
          {connected ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {connected ? (phoneInfo?.verified_name ? `Connected · ${phoneInfo.verified_name}` : 'Connected') : 'Not connected'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {connected
              ? [phoneInfo?.display_phone_number, 'Ready to send and receive messages'].filter(Boolean).join(' · ')
              : statusMessage || 'Enter your Meta WhatsApp Business API credentials below.'}
          </p>
        </div>
        {connected && phoneInfo?.quality_rating && (
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', phoneInfo.quality_rating === 'GREEN' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : phoneInfo.quality_rating === 'YELLOW' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-rose-500/10 text-rose-700 dark:text-rose-400')}>
            Quality {phoneInfo.quality_rating.toLowerCase()}
          </span>
        )}
        {config && (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleTestConnection} disabled={testing}>
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />} Test connection
            </Button>
            {config.waba_id && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handleSubscribeWaba} disabled={subscribing} title="Ask Meta to deliver this account's message webhooks to this app">
                {subscribing ? <Loader2 className="size-3.5 animate-spin" /> : <Webhook className="size-3.5" />} Subscribe webhooks
              </Button>
            )}
          </div>
        )}
      </div>

      {resetReason === 'token_corrupted' && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">The saved access token can&apos;t be read</p>
            <p className="text-xs text-amber-800/80 dark:text-amber-200/80">{statusMessage}</p>
          </div>
          <Button size="sm" className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700" onClick={() => setConfirmReset(true)} disabled={resetting}>
            {resetting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Reset configuration
          </Button>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {/* Credentials */}
          <section className="rounded-xl border border-border/70 bg-card p-4">
            <h3 className="text-sm font-semibold">API credentials</h3>
            <p className="mb-3 text-xs text-muted-foreground">From Meta → WhatsApp → API Setup. The token and secret are encrypted before they are stored.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className={labelCls}>Phone Number ID <span className="text-destructive">*</span></span>
                <Input placeholder="e.g. 100234567890123" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} className={cn(fieldCls, 'font-mono')} inputMode="numeric" />
              </label>
              <label className="block space-y-1">
                <span className={labelCls}>WhatsApp Business Account ID</span>
                <Input placeholder="e.g. 100234567890456" value={wabaId} onChange={(e) => setWabaId(e.target.value)} className={cn(fieldCls, 'font-mono')} inputMode="numeric" />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <span className={labelCls}>Permanent access token {!config && <span className="text-destructive">*</span>}</span>
                <SecretInput
                  placeholder="Paste your permanent access token"
                  value={accessToken}
                  onChange={(v) => { setAccessToken(v); setTokenEdited(true); }}
                  onFocus={() => { if (accessToken === MASKED_TOKEN) { setAccessToken(''); setTokenEdited(true); } }}
                />
                {config && !tokenEdited && <span className="block text-[11px] text-muted-foreground">Saved and hidden. Click the field to replace it.</span>}
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <span className={labelCls}>Meta app secret <span className="font-normal">(recommended, verifies webhook signatures)</span></span>
                <SecretInput
                  placeholder="Paste your Meta app secret"
                  value={metaAppSecret}
                  onChange={(v) => { setMetaAppSecret(v); setMetaAppSecretEdited(true); }}
                  onFocus={() => { if (metaAppSecret === MASKED_TOKEN) { setMetaAppSecret(''); setMetaAppSecretEdited(true); } }}
                />
                {config && !metaAppSecretEdited && <span className="block text-[11px] text-muted-foreground">Hidden for security. Re-enter it to update.</span>}
              </label>
            </div>
          </section>

          {/* Webhook */}
          <section className="rounded-xl border border-border/70 bg-card p-4">
            <h3 className="text-sm font-semibold">Webhook</h3>
            <p className="mb-3 text-xs text-muted-foreground">Paste both values in Meta → WhatsApp → Configuration → Webhook, then subscribe to <b>messages</b>. The verify token must match exactly.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block min-w-0 space-y-1">
                <span className={labelCls}>Callback URL</span>
                <CopyField value={webhookUrl} label="Callback URL" />
              </label>
              <label className="block min-w-0 space-y-1">
                <span className={labelCls}>Verify token</span>
                <div className="flex gap-1.5">
                  <Input placeholder="Any secret word you choose, e.g. clinic-2026" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} className={cn(fieldCls, 'font-mono')} />
                  <Button type="button" variant="outline" size="icon-sm" className="size-8 shrink-0" aria-label="Copy verify token" title="Copy verify token" disabled={!verifyToken}
                    onClick={async () => { try { await navigator.clipboard.writeText(verifyToken); toast.success('Verify token copied'); } catch { toast.error('Could not copy.'); } }}>
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                
              </label>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {config ? 'Save changes' : 'Save and connect'}
            </Button>
            {config && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmReset(true)} disabled={resetting}>
                {resetting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Reset configuration
              </Button>
            )}
          </div>
        </div>

        {/* Setup guide */}
        <aside className="rounded-xl border border-border/70 bg-card p-4 lg:sticky lg:top-4">
          <h3 className="text-sm font-semibold">Setup guide</h3>
          <p className="mb-3 text-xs text-muted-foreground">About 10 minutes in the Meta developer dashboard.</p>
          <ol className="space-y-3">
            {SETUP_STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{s.title}</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 border-t border-border/70 pt-3 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="size-3.5" /> Meta WhatsApp Cloud API docs
          </a>
        </aside>
      </div>

      <ConfirmationDialog
        isOpen={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset WhatsApp configuration?"
        description="The saved credentials are deleted so you can enter them again."
        notes={['WhatsApp messages stop sending and arriving until you save new credentials.']}
        confirmText="Reset configuration"
        variant="destructive"
        icon="warning"
        onConfirm={async () => { setConfirmReset(false); await handleReset(); }}
      />
    </div>
  );
}
