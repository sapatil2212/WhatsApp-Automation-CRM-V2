'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Building2, Calendar, CheckCircle2, CircleAlert, Clock, Copy, CreditCard, Loader2, Save, Trash2, Upload, XCircle } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { planById } from '@/lib/billing/plans';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

interface AccountData {
  id: string;
  email: string;
  role: string;
  isVerified: boolean;
  isEmailVerified: boolean;
  selectedPlan: string | null;
  paymentProofAttached: boolean;
  subscriptionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProfileData {
  id: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string | null;
  businessName: string | null;
  businessType: string | null;
  phoneNumber: string | null;
  tenantId: string | null;
}

interface TenantData {
  id: string;
  name: string | null;
  plan: string | null;
  isActive: boolean;
  createdAt: string;
}

export function ProfileForm() {
  const { user, refreshProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [tenant, setTenant] = useState<TenantData | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchAccount = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/account');
      if (!res.ok) return;
      const data = await res.json();
      setAccount(data.account);
      setProfileData(data.profile);
      setTenant(data.tenant);

      if (data.profile) {
        setFullName(data.profile.fullName ?? '');
        setEmail(data.profile.email ?? data.account.email ?? '');
        setBusinessName(data.profile.businessName ?? '');
        setBusinessType(data.profile.businessType ?? '');
        setPhoneNumber(data.profile.phoneNumber ?? '');
      }
    } catch (err) {
      console.error('Failed to fetch account:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchAccount();
  }, [user, fetchAccount]);

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const currentAvatar =
    previewUrl ?? (!removeAvatar ? profileData?.avatarUrl ?? null : null);

  const initial = (fullName || profileData?.fullName || account?.email || 'U')
    .charAt(0)
    .toUpperCase();

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error('Unsupported image type', { description: 'Use PNG, JPG, WebP, or GIF.' });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Image is too large', { description: 'Maximum 2 MB.' });
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveAvatar(false);
  };

  const onRemoveAvatar = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(null);
    setPreviewUrl(null);
    setRemoveAvatar(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !account) return;

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      toast.error('Display name is required');
      return;
    }

    setSaving(true);
    try {
      let nextAvatarUrl: string | null = profileData?.avatarUrl ?? null;

      // Upload avatar if staged
      if (pendingAvatar) {
        const formData = new FormData();
        formData.append('file', pendingAvatar);
        const uploadRes = await fetch('/api/avatar/upload', {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          throw new Error(err.error || 'Upload failed');
        }
        const uploadData = await uploadRes.json();
        nextAvatarUrl = uploadData.url;
      } else if (removeAvatar) {
        nextAvatarUrl = null;
      }

      // Update profile via PATCH /api/auth/account
      const profileRes = await fetch('/api/auth/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: trimmedName,
          businessName: businessName.trim(),
          businessType: businessType.trim(),
          phoneNumber: phoneNumber.trim(),
          avatarUrl: nextAvatarUrl,
        }),
      });

      if (!profileRes.ok) {
        const err = await profileRes.json();
        throw new Error(err.error || 'Save failed');
      }

      // Update email if changed
      const trimmedEmail = email.trim().toLowerCase();
      if (trimmedEmail && trimmedEmail !== account.email.toLowerCase()) {
        const emailRes = await fetch('/api/auth/update-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmedEmail }),
        });
        if (!emailRes.ok) {
          const err = await emailRes.json();
          toast.warning(`Profile saved but email change failed: ${err.error}`);
        }
      }

      setPendingAvatar(null);
      setPreviewUrl(null);
      setRemoveAvatar(false);
      await refreshProfile();
      await fetchAccount();

      toast.success('Profile saved successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !!profileData &&
    (fullName.trim() !== (profileData.fullName ?? '') ||
      email.trim().toLowerCase() !== (profileData.email ?? '').toLowerCase() ||
      businessName.trim() !== (profileData.businessName ?? '') ||
      businessType.trim() !== (profileData.businessType ?? '') ||
      phoneNumber.trim() !== (profileData.phoneNumber ?? '') ||
      pendingAvatar !== null ||
      removeAvatar);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-72 animate-pulse rounded-xl bg-muted/60" />
        <div className="h-40 animate-pulse rounded-xl bg-muted/60" />
      </div>
    );
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  const joined = account?.createdAt ? fmt(account.createdAt) : '—';
  const subscriptionExpiry = account?.subscriptionExpiresAt ? fmt(account.subscriptionExpiresAt) : null;
  const isSubscriptionActive = account?.subscriptionExpiresAt ? new Date(account.subscriptionExpiresAt) > new Date() : false;

  const plan = planById(account?.selectedPlan);

  const roleLabel = (r?: string | null) => (r === 'tenant_admin' ? 'Admin' : r === 'super_admin' ? 'Super admin' : r ? r.replace(/_/g, ' ') : 'User');

  const fieldCls = 'h-8 text-[13px] md:text-[13px]';
  const labelCls = 'text-[11px] font-medium text-muted-foreground';

  return (
    <div className="space-y-4">
      {/* Profile */}
      <section className="rounded-xl border border-border/70 bg-card p-4">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Profile</h3>
            <p className="text-xs text-muted-foreground">Your name, photo and business details.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Avatar className="size-14">
              {currentAvatar ? <AvatarImage src={currentAvatar} alt={fullName || 'Avatar'} /> : null}
              <AvatarFallback className="bg-primary/10 text-base text-primary">{initial}</AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1.5">
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onPickFile} />
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={saving}>
                  <Upload className="size-3.5" /> {currentAvatar ? 'Change photo' : 'Upload photo'}
                </Button>
                {currentAvatar && (
                  <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive" onClick={onRemoveAvatar} disabled={saving}>
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">PNG, JPG, WebP or GIF, up to 2 MB.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1" htmlFor="profile-full-name">
              <span className={labelCls}>Display name <span className="text-destructive">*</span></span>
              <Input id="profile-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Doe" maxLength={120} disabled={saving} required className={fieldCls} />
            </label>
            <label className="block space-y-1" htmlFor="profile-email">
              <span className={labelCls}>Email <span className="text-destructive">*</span></span>
              <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} required className={fieldCls} />
            </label>
            <label className="block space-y-1" htmlFor="profile-business-name">
              <span className={labelCls}>Business name</span>
              <Input id="profile-business-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="My Business" disabled={saving} className={fieldCls} />
            </label>
            <label className="block space-y-1" htmlFor="profile-business-type">
              <span className={labelCls}>Business type</span>
              <Input id="profile-business-type" value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="e.g. Healthcare, Retail" disabled={saving} className={fieldCls} />
            </label>
            <label className="block space-y-1" htmlFor="profile-phone">
              <span className={labelCls}>Phone number</span>
              <Input id="profile-phone" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+91 98765 43210" disabled={saving} className={fieldCls} />
            </label>
          </div>

          {!profileData && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><CircleAlert className="size-3.5" /> Your profile could not be loaded. Refresh the page to try again.</p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
            {dirty && <span className="mr-auto text-[11px] font-medium text-amber-600 dark:text-amber-400">Unsaved changes</span>}
            <Button type="submit" size="sm" className="gap-1.5" disabled={saving || !dirty || !profileData}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save changes
            </Button>
          </div>
        </form>
      </section>

      {/* Account */}
      <section className="rounded-xl border border-border/70 bg-card p-4">
        <h3 className="text-sm font-semibold">Account</h3>
        <p className="mb-3 text-xs text-muted-foreground">Status, plan and workspace. See <Link href="/subscription" className="font-medium text-primary hover:underline">Subscription</Link> to renew or change your plan.</p>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <InfoTile label="Role" value={<span className="capitalize">{roleLabel(account?.role)}</span>} />
          <InfoTile label="Account" value={account?.isVerified ? <Status ok>Active</Status> : <Status warn>Pending approval</Status>} />
          <InfoTile label="Email" value={account?.isEmailVerified ? <Status ok>Verified</Status> : <Status bad>Not verified</Status>} />
          <InfoTile label="Plan" icon={CreditCard} value={plan ? plan.name : account?.selectedPlan || 'No plan'} />
          <InfoTile
            label="Subscription"
            icon={Clock}
            value={subscriptionExpiry ? (isSubscriptionActive ? <Status ok>Until {subscriptionExpiry}</Status> : <Status bad>Expired {subscriptionExpiry}</Status>) : <span className="text-muted-foreground">Not subscribed</span>}
          />
          <InfoTile label="Payment proof" value={account?.paymentProofAttached ? <Status ok>Submitted</Status> : <span className="text-muted-foreground">Not submitted</span>} />
          <InfoTile label="Joined" icon={Calendar} value={joined} />
          {tenant && <InfoTile label="Workspace" icon={Building2} value={tenant.name || 'Default workspace'} sub={`${tenant.isActive ? 'Active' : 'Inactive'} · ${tenant.plan || 'No plan'}`} />}
        </div>
        <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">User ID</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{account?.id ?? '—'}</code>
          {account?.id && (
            <button
              type="button"
              aria-label="Copy user ID"
              title="Copy user ID"
              className="text-muted-foreground hover:text-foreground"
              onClick={async () => { try { await navigator.clipboard.writeText(account.id); toast.success('User ID copied'); } catch { toast.error('Could not copy'); } }}
            >
              <Copy className="size-3.5" />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function InfoTile({ label, value, sub, icon: Icon }: { label: string; value: React.ReactNode; sub?: string; icon?: React.ElementType }) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{Icon && <Icon className="size-3" />} {label}</p>
      <div className="mt-0.5 truncate text-[13px] font-semibold">{value}</div>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Theme-safe status text (readable in light and dark mode). */
function Status({ ok, warn, bad, children }: { ok?: boolean; warn?: boolean; bad?: boolean; children: React.ReactNode }) {
  const cls = ok ? 'text-emerald-600 dark:text-emerald-400' : warn ? 'text-amber-600 dark:text-amber-400' : bad ? 'text-rose-600 dark:text-rose-400' : '';
  const Icon = ok ? CheckCircle2 : XCircle;
  return <span className={`inline-flex items-center gap-1 ${cls}`}><Icon className="size-3.5 shrink-0" /> {children}</span>;
}