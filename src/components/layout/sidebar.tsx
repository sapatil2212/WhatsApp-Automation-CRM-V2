"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useTheme } from "@/hooks/use-theme";
import { getBusinessSegment, getTerminology } from "@/lib/business/terminology";
import { ReviewsNavSection } from "@/components/reviews/reviews-nav-section";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  GitBranch,
  Zap,
  Workflow,
  ListOrdered,
  Settings,
  X,
  History,
  Calendar,
  Shield,
  Briefcase,
  LayoutTemplate,
  Megaphone,
  Building,
  HelpCircle,
  Plug,
  LifeBuoy,
  Mail,
  Stethoscope,
  ClipboardList,
  FileSignature,
  CreditCard,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

/** One dashboard for every business type (analytics live there). */
const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/flows", label: "Flows", icon: Workflow },
  { href: "/sequences", label: "Sequences", icon: ListOrdered },
];

const bottomNavItems = [
  { href: "/connections", label: "Integrations", icon: Plug },
  { href: "/subscription", label: "Subscription", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

const SUPPORT_EMAIL = "chatnexgen@gmail.com";

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const { mode } = useTheme();
  const isLight = mode === "light";

  const segment = getBusinessSegment(profile?.business_type);
  const term = getTerminology(segment);
  const isHealthcare = segment === "healthcare";

  // Services, staff/doctors and AI behaviour are all managed inside
  // Business Setup now, so the business section stays short.
  const dynamicNavItems: NavItem[] = [
    { href: `/${segment}/appointments`, label: isHealthcare ? "Appointments" : (term.bookingPluralLabel.length > 20 ? "Bookings" : term.bookingPluralLabel), icon: Calendar },
    ...(isHealthcare
      ? [
          { href: "/healthcare/consultations", label: "Consultation", icon: Stethoscope },
          { href: "/healthcare/patients", label: "Patients", icon: ClipboardList },
          { href: "/healthcare/prescription-settings", label: "Prescription Setup", icon: FileSignature },
        ]
      : []),
    { href: `/${segment}/setup`, label: term.businessSetupLabel, icon: Building },
    // Healthcare trains the AI inside Business Setup (AI Training step).
    ...(isHealthcare ? [] : [{ href: `/${segment}/faqs`, label: "AI Knowledge Base", icon: HelpCircle }]),
    { href: `/${segment}/logs`, label: "AI Chat Logs", icon: History },
  ];

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-xs transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar transition-colors",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <img
              src={isLight ? "/images/logo/chatnexgen-logo-light.png" : "/images/logo/chatnexgen-logo.png"}
              alt="ChatNexGen Logo"
              className="h-8 w-auto object-contain"
            />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 scrollbar-hover">
          <ul className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !isActive;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      // Compact, clean font sizing & hit target
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors lg:py-1.5",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.beta && (
                      <span
                        aria-label="Beta feature"
                        className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1 py-0.2 text-[8.5px] font-semibold uppercase tracking-wider text-amber-300"
                      >
                        Beta
                      </span>
                    )}
                    {showUnreadDot && (
                      <span
                        aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
                        className="relative flex h-2 w-2 shrink-0"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-3 border-t border-sidebar-border/60" />

          <div className="px-2.5 mb-1.5 text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
            {isHealthcare ? "Clinic" : "Business"}
          </div>

          <ul className="flex flex-col gap-0.5 mb-2">
            {dynamicNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors lg:py-1.5",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <ReviewsNavSection />

          {profile?.role === "admin" && (
            <>
              <div className="my-3 border-t border-sidebar-border/60" />
              <div className="px-2.5 mb-1.5 text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Admin Panel
              </div>
              <ul className="flex flex-col gap-0.5">
                <li>
                  <Link
                    href="/admin"
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors lg:py-1.5",
                      pathname === "/admin"
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Shield className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">Clients Overview</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/portfolio"
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors lg:py-1.5",
                      pathname.startsWith("/admin/portfolio")
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Briefcase className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">Portfolio Showcase</span>
                  </Link>
                </li>
              </ul>
            </>
          )}

          <div className="my-3 border-t border-sidebar-border/60" />

          <ul className="flex flex-col gap-0.5">
            {bottomNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors lg:py-1.5",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Help & support */}
        <div className="shrink-0 border-t border-sidebar-border p-2.5">
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("ChatNexGen support request")}`}
            className="group flex items-start gap-2.5 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-2.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LifeBuoy className="size-4" />
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-sidebar" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-sidebar-foreground">Help &amp; Support 24×7</span>
              <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-sidebar-foreground/65 group-hover:text-primary">
                <Mail className="size-3 shrink-0" /> {SUPPORT_EMAIL}
              </span>
            </span>
          </a>
        </div>
      </aside>
    </>
  );
}
