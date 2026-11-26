'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CalendarClock, Check, CheckCircle2, Clock, Copy, CreditCard, Crown, Loader2, Lock, Mail, RefreshCw, ShieldCheck, Sparkles, Tag, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { postJson, useRazorpayCheckout, type CheckoutOrder } from '@/components/billing/use-razorpay-checkout';
import { BILLING_EMAIL, BILLING_WHATSAPP, formatPaise, PLANS, planById, SELF_SERVE_PLANS, type BillingPlan } from '@/lib/billing/plans';
import { cn } from '@/lib/utils';

const BUYABLE = SELF_SERVE_PLANS.filter((p) => p.selfServe && p.pricePaise);
interface PromoPreview { code: string; label: string; discountPaise: number; finalPaise: number }

interface Account {
  id: string;
  email: string;
  isVerified: boolean;
  selectedPlan: string | null;
  paymentProofAttached: boolean;
  subscriptionExpiresAt: string | null;
  createdAt: string;
}
interface Profile { fullName: string | null; businessName: string | null; phoneNumber: string | null }
interface Tenant { name: string | null; plan: string | null; isActive: boolean }

type State = 'active' | 'expiring' | 'expired' | 'pending' | 'none';
const DAY = 86_400_000;

const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function StatCard({ label, value, sub, icon: Icon, tone }: { label: string; value: React.ReactNode; sub?: string; icon: React.ElementType; tone?: 'green' | 'amber' | 'red' }) {
  const toneCls = tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'red' ? 'text-rose-600 dark:text-rose-400' : '';
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="size-3.5" /></span>
      </div>
      <p className={cn('mt-1 truncate text-xl font-bold leading-tight', toneCls)}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Renew with Razorpay. Active subscriptions are extended from their end date. */
function RenewCard({ email, current, expires, onRenewed }: { email: string; current: BillingPlan | null; expires: Date | null; onRenewed: () => void }) {
  const ownPlan = current?.selfServe && current.pricePaise ? current : null;
  const [planId, setPlanId] = useState<string>(ownPlan?.id ?? (BUYABLE.find((p) => p.popular) ?? BUYABLE[0]).id);
  const plan = planById(planId)!;
  const [code, setCode] = useState('');
  const [promo, setPromo] = useState<PromoPreview | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [orderKey, setOrderKey] = useState<string | null>(null);

  const handleActivated = useCallback(
    (kind: 'paid' | 'free') => {
      toast.success(kind === 'free' ? 'Renewed with your promo code.' : 'Payment received. Your subscription is extended.');
      setPromo(null);
      setCode('');
      setOrderKey(null);
      onRenewed();
    },
    [onRenewed],
  );
  const { order, busy, error, start, pay, reset } = useRazorpayCheckout({ onActivated: handleActivated });

  const applyPromo = async (forPlan = planId, raw = code) => {
    const c = raw.trim();
    if (!c) return setPromoError('Enter a promo code.');
    setApplying(true);
    setPromoError(null);
    try {
      setPromo(await postJson<PromoPreview>('/api/billing/promo/validate', { code: c, plan: forPlan, email }));
    } catch (e) {
      setPromo(null);
      setPromoError((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const choosePlan = (id: string) => {
    if (id === planId) return;
    setPlanId(id);
    reset();
    setOrderKey(null);
    if (promo) void applyPromo(id, promo.code);
  };

  const key = `${planId}|${promo?.code ?? ''}`;
  const checkout = () => {
    // Reuse the open order if nothing changed since the window was closed.
    if (order?.mode === 'razorpay' && orderKey === key) return pay();
    setOrderKey(key);
    void start(() => postJson<CheckoutOrder>('/api/billing/renewal', { plan: planId, promoCode: promo?.code ?? '' }), true);
  };

  const original = plan.pricePaise ?? 0;
  const total = promo ? promo.finalPaise : original;
  const nextEnd = (() => {
    const base = expires && expires.getTime() > Date.now() ? new Date(expires) : new Date();
    base.setMonth(base.getMonth() + 1);
    return base;
  })();

  return (
    <section id="renew" className="scroll-mt-20 rounded-xl border border-border/70 bg-card p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><CreditCard className="size-3.5 text-primary" /> Renew subscription</h3>
      <p className="mb-3 text-xs text-muted-foreground">Pay online with UPI, card, netbanking or wallet. One month is added straight away.</p>

      {!ownPlan && (
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          {BUYABLE.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => choosePlan(p.id)}
              className={cn('rounded-lg border px-2.5 py-1.5 text-left transition-colors', planId === p.id ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30' : 'border-border/70 hover:border-primary/40')}
            >
              <span className="block text-[12px] font-semibold">{p.name}</span>
              <span className="block text-[11px] text-muted-foreground">{p.price}{p.period}</span>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border/70 p-3 text-[12px]">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{plan.name} · 1 month</span>
          <span>{formatPaise(original)}</span>
        </div>
        {promo && promo.discountPaise > 0 && (
          <div className="mt-1 flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span>Promo {promo.code}</span>
            <span>−{formatPaise(promo.discountPaise)}</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-border/70 pt-2">
          <span className="text-[13px] font-semibold">Total</span>
          <span className="text-lg font-bold">{formatPaise(total)}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Active until {fmtDate(nextEnd)} after payment.</p>
      </div>

      <div className="mt-3">
        {promo ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5">
            <p className="flex min-w-0 items-center gap-1.5 truncate text-[12px] font-semibold text-emerald-700 dark:text-emerald-400"><Check className="size-3.5 shrink-0" /> {promo.code} · {promo.label}</p>
            <button type="button" aria-label="Remove promo code" className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => { setPromo(null); setCode(''); setOrderKey(null); }}><X className="size-3.5" /></button>
          </div>
        ) : (
          <>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Tag className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={code}
                  onChange={(e) => { setCode(e.target.value.toUpperCase()); if (promoError) setPromoError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyPromo(); } }}
                  placeholder="Promo code"
                  maxLength={40}
                  aria-label="Promo code"
                  aria-invalid={Boolean(promoError)}
                  className={cn('h-8 pl-8 font-mono text-[13px] uppercase', promoError && 'border-destructive')}
                />
              </div>
              <Button size="sm" variant="outline" className="h-8" disabled={applying || !code.trim()} onClick={() => void applyPromo()}>
                {applying && <Loader2 className="size-3.5 animate-spin" />} Apply
              </Button>
            </div>
            {promoError && <p role="alert" className="mt-1 text-[11px] font-medium text-destructive">{promoError}</p>}
          </>
        )}
      </div>

      {error && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}

      <Button size="sm" className="mt-3 w-full gap-1.5" disabled={busy !== null} onClick={checkout}>
        {busy === 'starting' ? <><Loader2 className="size-3.5 animate-spin" /> Preparing payment…</> : busy === 'paying' ? <><Loader2 className="size-3.5 animate-spin" /> Opening secure payment…</> : busy === 'confirming' ? <><Loader2 className="size-3.5 animate-spin" /> Confirming payment…</> : <><Lock className="size-3.5" /> {total === 0 ? 'Renew for free' : `Pay ${formatPaise(total)} securely`}</>}
      </Button>
      <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" /> Secured by Razorpay</p>
      {order?.mode === 'razorpay' && order.test && <p className="mt-1 text-center text-[10px] font-medium text-amber-600 dark:text-amber-400">Test mode: no real money is charged.</p>}
    </section>
  );
}

export default function SubscriptionPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/account', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load your subscription.');
      setAccount(data.account);
      setProfile(data.profile);
      setTenant(data.tenant);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const plan = planById(account?.selectedPlan ?? tenant?.plan);
  const info = useMemo(() => {
    const expires = account?.subscriptionExpiresAt ? new Date(account.subscriptionExpiresAt) : null;
    // Approval starts a 1-month period, so the period start is one month before expiry.
    const start = expires ? new Date(expires) : null;
    if (start) start.setMonth(start.getMonth() - 1);
    const now = Date.now();
    const daysLeft = expires ? Math.ceil((expires.getTime() - now) / DAY) : null;
    const total = expires && start ? Math.max(1, Math.round((expires.getTime() - start.getTime()) / DAY)) : 30;
    const used = daysLeft == null ? 0 : Math.min(100, Math.max(0, ((total - daysLeft) / total) * 100));
    let state: State = 'none';
    // An inactive account whose period ran out is expired (renewable); otherwise it waits for its first payment.
    if (account && !account.isVerified) state = expires && daysLeft != null && daysLeft <= 0 ? 'expired' : 'pending';
    else if (expires && daysLeft != null) state = daysLeft <= 0 ? 'expired' : daysLeft <= 7 ? 'expiring' : 'active';
    return { expires, start, daysLeft, used, state };
  }, [account]);

  const name = profile?.fullName || account?.email || '';
  const business = profile?.businessName || tenant?.name || '';
  const waMessage = (target: BillingPlan) =>
    encodeURIComponent(
      `Hello! I'd like to ${target.selfServe ? 'change my ChatNexGen plan' : 'discuss a custom ChatNexGen plan'}${plan ? ` (currently *${plan.name}*)` : ''}${target.selfServe ? ` to *${target.name}* (${target.price}${target.period})` : ''}.\n\n*Name:* ${name}\n*Email:* ${account?.email ?? ''}${business ? `\n*Business:* ${business}` : ''}`,
    );
  const openWhatsApp = (text: string) => window.open(`https://wa.me/${BILLING_WHATSAPP}?text=${text}`, '_blank', 'noopener');

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy');
    }
  };

  const banner = {
    active: null,
    expiring: { tone: 'amber', icon: Clock, title: `Your subscription ends in ${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'}`, body: 'Renew now to avoid any interruption to WhatsApp messaging and automations.' },
    expired: { tone: 'red', icon: AlertTriangle, title: 'Your subscription has expired', body: 'Renew to restore full access for your team.' },
    pending: { tone: 'amber', icon: Clock, title: 'Waiting for activation', body: 'Your account is activated as soon as the first payment is confirmed. Contact us below if you need help.' },
    none: { tone: 'amber', icon: AlertTriangle, title: 'No active subscription', body: 'Choose a plan and complete the payment to start.' },
  }[info.state];

  const statusLabel = { active: 'Active', expiring: 'Expiring soon', expired: 'Expired', pending: 'Pending', none: 'Not active' }[info.state];
  const statusTone = info.state === 'active' ? 'green' : info.state === 'expired' ? 'red' : 'amber';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscription</h1>
          <p className="text-sm text-muted-foreground">Your plan, renewal date and payments.</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</p>}

      {loading && !account ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[68px] animate-pulse rounded-xl bg-muted/60" />)}</div>
      ) : account ? (
        <>
          {banner && (
            <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3', banner.tone === 'red' ? 'border-rose-500/30 bg-rose-500/10' : 'border-amber-500/30 bg-amber-500/10')}>
              <banner.icon className={cn('size-4 shrink-0', banner.tone === 'red' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{banner.title}</p>
                <p className="text-xs text-muted-foreground">{banner.body}</p>
              </div>
              {info.state !== 'pending' && <Button size="sm" className="gap-1.5" onClick={() => document.getElementById('renew')?.scrollIntoView({ behavior: 'smooth' })}><CreditCard className="size-3.5" /> Renew now</Button>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Plan" value={plan?.name ?? 'No plan'} sub={plan ? plan.tagline : undefined} icon={Crown} />
            <StatCard label="Status" value={statusLabel} sub={tenant ? `Workspace ${tenant.isActive ? 'active' : 'inactive'}` : undefined} icon={ShieldCheck} tone={statusTone} />
            <StatCard label={info.state === 'expired' ? 'Expired on' : 'Renews on'} value={info.expires ? fmtDate(info.expires) : '—'} sub={info.start ? `Period started ${fmtDate(info.start)}` : undefined} icon={CalendarClock} />
            <StatCard
              label="Days left"
              value={info.daysLeft == null ? '—' : Math.max(0, info.daysLeft)}
              sub={plan?.selfServe ? `Then ${plan.renewal}` : undefined}
              icon={Clock}
              tone={info.daysLeft == null ? undefined : info.daysLeft <= 0 ? 'red' : info.daysLeft <= 7 ? 'amber' : 'green'}
            />
          </div>

          {info.expires && (
            <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium">Current period</span>
                <span className="text-muted-foreground">{info.start ? fmtDate(info.start) : ''} → {fmtDate(info.expires)}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn('h-full rounded-full transition-[width] duration-500', info.state === 'expired' ? 'bg-rose-500' : info.state === 'expiring' ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${info.used}%` }} />
              </div>
            </div>
          )}

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Plans */}
            <section className="rounded-xl border border-border/70 bg-card p-4">
              <h3 className="text-sm font-semibold">Plans</h3>
              <p className="mb-3 text-xs text-muted-foreground">Prices are per WhatsApp number per month, exclusive of GST. Message us to switch plans.</p>
              <div className="grid gap-3 md:grid-cols-3">
                {PLANS.map((p) => {
                  const current = plan?.id === p.id;
                  return (
                    <div key={p.id} className={cn('flex flex-col rounded-lg border p-3', current ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30' : 'border-border/70')}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-semibold">{p.name}</p>
                        {current ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary"><Check className="size-3" /> Current</span>
                        ) : p.popular ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400"><Sparkles className="size-3" /> Popular</span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{p.tagline}</p>
                      <p className="mt-2"><span className="text-xl font-bold">{p.price}</span><span className="text-[11px] text-muted-foreground">{p.period}</span></p>
                      <p className="text-[11px] text-muted-foreground">{p.selfServe ? 'per WhatsApp number' : 'pricing for your needs'}</p>
                      <ul className="mt-2.5 flex-1 space-y-1">
                        {p.features.map((f) => (
                          <li key={f} className="flex items-start gap-1.5 text-[12px]"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" /> {f}</li>
                        ))}
                      </ul>
                      {!current && (
                        <Button size="sm" variant="outline" className="mt-3 w-full gap-1.5" onClick={() => openWhatsApp(waMessage(p))}>
                          <WhatsAppIcon className="size-3.5" /> {p.selfServe ? `Switch to ${p.name}` : 'Talk to us'}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="space-y-4 lg:sticky lg:top-4">
              {info.state !== 'pending' && <RenewCard email={account.email} current={plan} expires={info.expires} onRenewed={() => void load()} />}
              <section className="rounded-xl border border-border/70 bg-card p-4">
              <div className="space-y-1.5 text-[12px]">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Billing help</p>
                <div className="flex items-center gap-2">
                  <WhatsAppIcon className="size-3.5 text-[#25D366]" />
                  <span className="flex-1">+{BILLING_WHATSAPP.slice(0, 2)} {BILLING_WHATSAPP.slice(2)}</span>
                  <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Copy number" onClick={() => copy(`+${BILLING_WHATSAPP}`, 'Number')}><Copy className="size-3.5" /></button>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="size-3.5 text-muted-foreground" />
                  <a href={`mailto:${BILLING_EMAIL}?subject=${encodeURIComponent('ChatNexGen subscription')}`} className="flex-1 truncate hover:text-primary">{BILLING_EMAIL}</a>
                  <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Copy email" onClick={() => copy(BILLING_EMAIL, 'Email')}><Copy className="size-3.5" /></button>
                </div>
              </div>
              </section>
            </div>
          </div>

          <section className="rounded-xl border border-border/70 bg-card p-4">
            <h3 className="text-sm font-semibold">Billing details</h3>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-[11px] text-muted-foreground">Account</dt><dd className="truncate font-medium">{name || '—'}</dd></div>
              <div><dt className="text-[11px] text-muted-foreground">Email</dt><dd className="truncate font-medium">{account.email}</dd></div>
              <div><dt className="text-[11px] text-muted-foreground">Business</dt><dd className="truncate font-medium">{business || '—'}</dd></div>
              <div><dt className="text-[11px] text-muted-foreground">Customer since</dt><dd className="font-medium">{fmtDate(new Date(account.createdAt))}</dd></div>
            </dl>
          </section>
        </>
      ) : null}
    </div>
  );
}
