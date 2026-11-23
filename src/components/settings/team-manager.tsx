"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Info, Loader2, Search, Trash2, UserPlus, Users } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface TeamMember {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  createdAt: string;
}

type Role = "tenant_admin" | "manager" | "agent";

const ROLES: Array<{ id: Role; label: string; desc: string; cls: string }> = [
  { id: "agent", label: "Agent", desc: "Inbox, conversations and contacts", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  { id: "manager", label: "Manager", desc: "Agent access plus campaigns and pipelines", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  { id: "tenant_admin", label: "Admin", desc: "Full access, including settings and billing", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-400" },
];
const roleMeta = (r: string) => ROLES.find((x) => x.id === r) ?? ROLES[0];

const fieldCls = "h-8 text-[13px] md:text-[13px]";
const labelCls = "text-[11px] font-medium text-muted-foreground";

export function TeamManager() {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [openInvite, setOpenInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("agent");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [toRemove, setToRemove] = useState<TeamMember | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/team/members", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message || body.message || "Failed to load team members.");
      setMembers(body.data || []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setMembers((m) => m ?? []);
    }
  }, []);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (members ?? []).filter((m) => !q || `${m.fullName ?? ""} ${m.email}`.toLowerCase().includes(q));
  }, [members, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of members ?? []) c[m.role] = (c[m.role] ?? 0) + 1;
    return c;
  }, [members]);

  const resetInvite = () => {
    setInviteEmail("");
    setInviteName("");
    setInviteRole("agent");
    setInviteError(null);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/team/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), fullName: inviteName.trim() || undefined, role: inviteRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message || body.message || "Failed to add member");
      toast.success(`${inviteName.trim() || inviteEmail.trim()} added to the workspace`);
      setOpenInvite(false);
      resetInvite();
      await fetchMembers();
    } catch (err) {
      setInviteError((err as Error).message || "An error occurred.");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (m: TeamMember) => {
    try {
      const res = await fetch(`/api/team/members?memberId=${encodeURIComponent(m.id)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message || body.message || "Failed to remove member");
      setMembers((prev) => (prev ?? []).filter((x) => x.id !== m.id));
      toast.success(`${m.fullName || m.email} removed`);
    } catch (err) {
      toast.error((err as Error).message || "Network error while removing member");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Members</p>
            <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary"><Users className="size-3.5" /></span>
          </div>
          <p className="mt-1 text-xl font-bold leading-tight">{members?.length ?? "—"}</p>
        </div>
        {ROLES.slice().reverse().map((r) => (
          <div key={r.id} className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{r.label}s</p>
            <p className="mt-1 text-xl font-bold leading-tight">{members ? counts[r.id] ?? 0 : "—"}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Team members</h3>
            <p className="text-xs text-muted-foreground">People who can sign in to this workspace.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" className={cn(fieldCls, "w-48 pl-8")} aria-label="Search members" />
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => { resetInvite(); setOpenInvite(true); }}><UserPlus className="size-3.5" /> Add member</Button>
          </div>
        </div>

        {error && <p className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

        {members === null ? (
          <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-md bg-muted/60" />)}</div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">{search ? "No members match your search." : "No team members yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="border-b border-border bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-2 pl-4 pr-3">Member</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Joined</th><th className="w-16 py-2 pl-3 pr-4 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((m) => {
                  const r = roleMeta(m.role);
                  const isMe = !!user && m.userId === user.id;
                  return (
                    <tr key={m.id} className="hover:bg-muted/30">
                      <td className="py-2 pl-4 pr-3">
                        <div className="flex items-center gap-2.5">
                          {m.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.avatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                          ) : (
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary">{(m.fullName || m.email).charAt(0).toUpperCase()}</span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">{m.fullName || m.email.split("@")[0]}{isMe && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(you)</span>}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", r.cls)}>{r.label}</span></td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(m.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td className="py-2 pl-3 pr-4">
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={isMe}
                            onClick={() => setToRemove(m)}
                            title={isMe ? "You can't remove yourself" : "Remove from workspace"}
                            aria-label={`Remove ${m.fullName || m.email}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={openInvite} onOpenChange={(o) => { if (!inviting) setOpenInvite(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add team member</DialogTitle>
            <DialogDescription>They get access to this workspace with the role you choose.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className={labelCls}>Email <span className="text-destructive">*</span></span>
                <Input type="email" required autoFocus value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@company.com" className={fieldCls} />
              </label>
              <label className="block space-y-1">
                <span className={labelCls}>Full name</span>
                <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="e.g. Alex Morgan" className={fieldCls} />
              </label>
            </div>
            <div className="space-y-1">
              <span className={labelCls}>Role</span>
              <div className="grid gap-1.5">
                {ROLES.map((r) => (
                  <label key={r.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors", inviteRole === r.id ? "border-primary/50 bg-primary/5" : "border-border/70 hover:bg-muted/40")}>
                    <input type="radio" name="invite-role" className="accent-[var(--primary)]" checked={inviteRole === r.id} onChange={() => setInviteRole(r.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{r.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{r.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <p className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" /> New members sign in by choosing &quot;Forgot password&quot; on the login page with this email to set their password.
            </p>
            {inviteError && <p role="alert" className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{inviteError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpenInvite(false)} disabled={inviting}>Cancel</Button>
              <Button type="submit" size="sm" className="gap-1.5" disabled={inviting || !inviteEmail.trim()}>{inviting && <Loader2 className="size-3.5 animate-spin" />} Add member</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={!!toRemove}
        onOpenChange={(o) => { if (!o) setToRemove(null); }}
        title="Remove this member?"
        description="They lose access to this workspace straight away."
        details={toRemove ? <span><span className="font-medium">{toRemove.fullName || toRemove.email}</span> · {roleMeta(toRemove.role).label}</span> : undefined}
        confirmText="Remove member"
        variant="destructive"
        onConfirm={async () => { const m = toRemove; setToRemove(null); if (m) await handleRemove(m); }}
      />
    </div>
  );
}
