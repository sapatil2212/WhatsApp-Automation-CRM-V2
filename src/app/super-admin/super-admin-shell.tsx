"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { BarChart2, FileText, Gift, Loader2, LogOut, Menu, Moon, Plug, Settings, ShieldCheck, Sun, UserPlus, Users, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const NAV = [
  { href: "/super-admin", label: "Overview", icon: BarChart2, title: "Overview" },
  { href: "/super-admin/new-users", label: "New users", icon: UserPlus, title: "New users" },
  { href: "/super-admin/users", label: "Users & tenants", icon: Users, title: "Users & tenants" },
  { href: "/super-admin/offers", label: "Offers", icon: Gift, title: "Offers" },
  { href: "/super-admin/integrations", label: "Integrations", icon: Plug, title: "Integrations" },
  { href: "/super-admin/cms", label: "CMS & content", icon: FileText, title: "CMS & content" },
  { href: "/super-admin/settings", label: "Settings", icon: Settings, title: "Settings" },
];
const isActive = (href: string, pathname: string) => (href === "/super-admin" ? pathname === href : pathname.startsWith(href));

/** Approval queue size for the sidebar badge (email verified, not yet approved). */
function usePendingCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/super-admin/users", { cache: "no-store" });
        if (!res.ok || !live) return;
        const data = (await res.json()) as { users?: Array<{ isEmailVerified?: boolean; isVerified?: boolean }> };
        setCount((data.users ?? []).filter((u) => u.isEmailVerified && !u.isVerified).length);
      } catch {
        /* badge is best-effort */
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return count;
}

function Sidebar({ open, onClose, pending, onSignOut }: { open: boolean; onClose: () => void; pending: number; onSignOut: () => void }) {
  const pathname = usePathname();
  return (
    <>
      <button
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={cn("fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-xs transition-opacity lg:hidden", open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")}
      />
      <aside
        aria-label="Admin navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar",
          "transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:w-56 lg:translate-x-0 lg:transition-none",
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
          <Link href="/super-admin" className="flex min-w-0 items-center gap-2" onClick={onClose}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo/chatnexgen-logo-light.png" alt="ChatNexGen" className="h-7 w-auto object-contain dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo/chatnexgen-logo.png" alt="ChatNexGen" className="hidden h-7 w-auto object-contain dark:block" />
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">Admin</span>
          </Link>
          <button type="button" onClick={onClose} aria-label="Close menu" className="ml-auto flex size-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent lg:hidden">
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">Platform</p>
          <ul className="flex flex-col gap-0.5">
            {NAV.map((item) => {
              const active = isActive(item.href, pathname);
              const badge = item.href === "/super-admin/new-users" && pending > 0 ? pending : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors lg:py-1.5",
                      active ? "bg-primary/10 text-primary" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge > 0 && <span className="min-w-[18px] rounded-full bg-destructive px-1.5 text-center text-[10px] font-semibold leading-[18px] text-white" aria-label={`${badge} waiting for approval`}>{badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-sidebar-border p-2.5">
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-sidebar-foreground/75 transition-colors hover:bg-destructive/10 hover:text-destructive lg:py-1.5"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * Super admin chrome: auth gate, sidebar and header. Mounted once from the
 * layout so navigating between admin pages keeps the session check, the
 * sidebar badge and the scroll container instead of remounting them.
 */
export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const isLogin = pathname === "/super-admin/login";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [admin, setAdmin] = useState<string | null>(null);
  const [checking, setChecking] = useState(!isLogin);

  // Checked on entry and when coming back from the login page, not on every click.
  useEffect(() => {
    if (isLogin) return;
    let live = true;
    fetch("/api/super-admin/auth", { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) return router.replace("/super-admin/login");
        const data = (await res.json().catch(() => ({}))) as { email?: string };
        if (!live) return;
        setAdmin(data.email ?? null);
        setChecking(false);
      })
      .catch(() => live && router.replace("/super-admin/login"));
    return () => {
      live = false;
    };
  }, [isLogin, router]);

  const signOut = async () => {
    await fetch("/api/super-admin/auth", { method: "DELETE" }).catch(() => {});
    setAdmin(null);
    router.replace("/super-admin/login");
  };

  if (isLogin) return <>{children}</>;
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return <ShellFrame admin={admin} mode={mode} setMode={setMode} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} onSignOut={signOut} pathname={pathname}>{children}</ShellFrame>;
}

function ShellFrame({ children, admin, mode, setMode, sidebarOpen, setSidebarOpen, onSignOut, pathname }: {
  children: React.ReactNode;
  admin: string | null;
  mode: string;
  setMode: (m: "light" | "dark") => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  onSignOut: () => void;
  pathname: string;
}) {
  const pending = usePendingCount();
  const title = NAV.find((n) => isActive(n.href, pathname))?.title ?? "Admin";
  const initial = admin?.charAt(0).toUpperCase() ?? "A";

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} pending={pending} onSignOut={onSignOut} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Open menu" className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden">
              <Menu className="size-5" />
            </button>
            <h1 className="truncate text-sm font-semibold sm:text-base">{title}</h1>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMode(mode === "light" ? "dark" : "light")}
              aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {mode === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-accent focus:outline-none sm:pr-2.5" aria-label="Open account menu">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">{initial}</span>
                <span className="hidden min-w-0 text-left sm:block">
                  <span className="block max-w-[180px] truncate text-[12px] font-medium leading-tight">{admin ?? "Super admin"}</span>
                  <span className="block text-[10px] leading-tight text-muted-foreground">Super admin</span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2 text-[12px] font-normal">
                  <ShieldCheck className="size-3.5 text-primary" />
                  <span className="truncate">{admin ?? "Super admin"}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/super-admin/settings" />}><Settings className="size-4" /> Settings</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={onSignOut}><LogOut className="size-4" /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
