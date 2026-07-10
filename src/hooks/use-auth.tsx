"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  tenant_id: string | null;
  business_name: string | null;
  business_type: string | null;
  phone_number: string | null;
  beta_features: string[];
}

interface AuthUser {
  id: string;
  email: string;
  role: string;
  created_at?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  const checkRedirect = useCallback((u: any) => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const isAuthPage =
        path.startsWith('/login') ||
        path.startsWith('/signup') ||
        path.startsWith('/forgot-password') ||
        path.startsWith('/verify') ||
        path.startsWith('/reset-password') ||
        path === '/';
      if (!u && !isAuthPage) {
        window.location.href = `/login?from=${encodeURIComponent(path)}`;
      }
    }
  }, []);

  const fetchSession = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await fetch("/api/auth/session")
      if (res.ok) {
        const data = await res.json()
        if (data.user) {
          setUser(data.user)
          const rawProfile = data.profile
          if (rawProfile) {
            setProfile({
              id: rawProfile.id,
              full_name: rawProfile.fullName ?? rawProfile.full_name ?? null,
              email: rawProfile.email,
              avatar_url: rawProfile.avatarUrl ?? rawProfile.avatar_url ?? null,
              role: rawProfile.role,
              tenant_id: rawProfile.tenantId ?? rawProfile.tenant_id ?? null,
              business_name: rawProfile.businessName ?? rawProfile.business_name ?? null,
              business_type: rawProfile.businessType ?? rawProfile.business_type ?? null,
              phone_number: rawProfile.phoneNumber ?? rawProfile.phone_number ?? null,
              beta_features: rawProfile.betaFeatures ?? rawProfile.beta_features ?? []
            })
          } else {
            setProfile(null)
          }
        } else {
          setUser(null)
          setProfile(null)
          checkRedirect(null)
        }
      } else {
        setUser(null)
        setProfile(null)
        checkRedirect(null)
      }
    } catch (err) {
      console.error("[AuthProvider] fetchSession threw:", err)
      setUser(null)
      setProfile(null)
      checkRedirect(null)
    } finally {
      setLoading(false)
      setProfileLoading(false)
    }
  }, [checkRedirect]);

  useEffect(() => {
    let mounted = true;
    
    if (mounted) {
      fetchSession();
    }

    return () => {
      mounted = false;
    };
  }, [fetchSession]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch (err) {
      console.error("[AuthProvider] signOut error:", err)
    }
    setUser(null);
    setProfile(null);
    window.location.href = "/login";
  }, []);

  const refreshProfile = useCallback(async () => {
    await fetchSession();
  }, [fetchSession]);

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, profileLoading, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
    };
  }
  return ctx;
}
