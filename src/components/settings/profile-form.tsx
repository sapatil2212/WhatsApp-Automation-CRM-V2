'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Upload,
  Trash2,
  CircleAlert,
  Shield,
  CreditCard,
  Calendar,
  Building2,
  Phone,
  Mail,
  User as UserIcon,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

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
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const joined = account?.createdAt
    ? new Date(account.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  const subscriptionExpiry = account?.subscriptionExpiresAt
    ? new Date(account.subscriptionExpiresAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  const isSubscriptionActive = account?.subscriptionExpiresAt
    ? new Date(account.subscriptionExpiresAt) > new Date()
    : false;

  const planLabels: Record<string, string> = {
    starter: '₹799 Starter',
    professional: '₹1,499 Professional',
    enterprise: '₹2,999 Enterprise',
  };

  return (
    <div className="space-y-6">
      {/* Profile Edit Card */}
      <Card className="bg-slate-900/40 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Profile</CardTitle>
          <CardDescription className="text-slate-400">
            Your personal and business details. Update your information below.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Avatar row */}
            <div className="flex flex-wrap items-center gap-5">
              <Avatar size="lg" className="size-16">
                {currentAvatar ? (
                  <AvatarImage src={currentAvatar} alt={fullName || 'Avatar'} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-base text-primary">
                  {initial}
                </AvatarFallback>
              </Avatar>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                >
                  <Upload className="size-4" />
                  {currentAvatar ? 'Change photo' : 'Upload photo'}
                </Button>
                {currentAvatar && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onRemoveAvatar}
                    disabled={saving}
                    className="text-slate-400 hover:text-white"
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                )}
                <p className="w-full text-xs text-slate-500">
                  PNG, JPG, WebP, or GIF. Up to 2 MB.
                </p>
              </div>
            </div>

            {/* Form fields - 2 columns */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-full-name" className="text-slate-200">
                  <UserIcon className="inline size-3.5 mr-1" />
                  Display Name
                </Label>
                <Input
                  id="profile-full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  maxLength={120}
                  disabled={saving}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-email" className="text-slate-200">
                  <Mail className="inline size-3.5 mr-1" />
                  Email
                </Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={saving}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-business-name" className="text-slate-200">
                  <Building2 className="inline size-3.5 mr-1" />
                  Business Name
                </Label>
                <Input
                  id="profile-business-name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="My Business"
                  disabled={saving}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-business-type" className="text-slate-200">
                  <Building2 className="inline size-3.5 mr-1" />
                  Business Type
                </Label>
                <Input
                  id="profile-business-type"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  placeholder="e.g. Healthcare, Retail"
                  disabled={saving}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="profile-phone" className="text-slate-200">
                  <Phone className="inline size-3.5 mr-1" />
                  Phone Number
                </Label>
                <Input
                  id="profile-phone"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+91 9876543210"
                  disabled={saving}
                />
              </div>
            </div>

            {!profileData && (
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <CircleAlert className="size-4" />
                Loading your profile…
              </p>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !dirty || !profileData}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Account Details Card — Read-only info */}
      <Card className="bg-slate-900/40 border-slate-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Shield className="size-4 text-primary" />
            Account Details
          </CardTitle>
          <CardDescription className="text-slate-400">
            Your account status, subscription, and system information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Role */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Role</p>
              <p className="text-sm font-semibold text-slate-200 capitalize">
                {account?.role ?? 'user'}
              </p>
            </div>

            {/* Verification Status */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Account Status</p>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                {account?.isVerified ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Active</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5 text-amber-400" />
                    <span className="text-amber-400">Pending Approval</span>
                  </>
                )}
              </p>
            </div>

            {/* Email Verified */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Email Verified</p>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                {account?.isEmailVerified ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Verified</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5 text-red-400" />
                    <span className="text-red-400">Not Verified</span>
                  </>
                )}
              </p>
            </div>

            {/* Selected Plan */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                <CreditCard className="inline size-3 mr-1" />
                Plan
              </p>
              <p className="text-sm font-semibold text-slate-200">
                {account?.selectedPlan ? planLabels[account.selectedPlan] || account.selectedPlan : 'No Plan'}
              </p>
            </div>

            {/* Subscription Expiry */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                <Clock className="inline size-3 mr-1" />
                Subscription
              </p>
              <p className={`flex items-center gap-1.5 text-sm font-semibold ${isSubscriptionActive ? 'text-emerald-400' : 'text-red-400'}`}>
                {subscriptionExpiry ? (
                  <>
                    {isSubscriptionActive ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <XCircle className="size-3.5" />
                    )}
                    {isSubscriptionActive ? `Active until ${subscriptionExpiry}` : `Expired on ${subscriptionExpiry}`}
                  </>
                ) : (
                  <span className="text-slate-400">Not subscribed</span>
                )}
              </p>
            </div>

            {/* Payment Proof */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Payment Proof</p>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                {account?.paymentProofAttached ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Submitted</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5 text-slate-500" />
                    <span className="text-slate-400">Not Submitted</span>
                  </>
                )}
              </p>
            </div>

            {/* Joined Date */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                <Calendar className="inline size-3 mr-1" />
                Joined
              </p>
              <p className="text-sm font-semibold text-slate-200">{joined}</p>
            </div>

            {/* Tenant Info */}
            {tenant && (
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                  <Building2 className="inline size-3 mr-1" />
                  Workspace
                </p>
                <p className="text-sm font-semibold text-slate-200">
                  {tenant.name || 'Default Workspace'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {tenant.isActive ? 'Active' : 'Inactive'} · Plan: {tenant.plan || 'None'}
                </p>
              </div>
            )}

            {/* User ID */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 sm:col-span-2 lg:col-span-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">User ID</p>
              <p className="break-all font-mono text-xs text-slate-400">
                {account?.id ?? '—'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
