"use client";

import { useEffect, useState } from "react";
import { Users, UserPlus, Trash2, Mail, Shield, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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

export function TeamManager() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite modal state
  const [openInvite, setOpenInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"tenant_admin" | "agent" | "manager">("agent");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Deleting state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/team/members");
      if (res.ok) {
        const body = await res.json();
        setMembers(body.data || []);
      }
    } catch (err: any) {
      setError("Failed to load team members.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);

    try {
      const res = await fetch("/api/team/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          fullName: inviteName.trim() || undefined,
          role: inviteRole,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || body.message || "Failed to invite member");
      }

      setOpenInvite(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("agent");
      fetchMembers();
    } catch (err: any) {
      setInviteError(err.message || "An error occurred.");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!confirm("Are you sure you want to remove this team member from the workspace?")) {
      return;
    }

    setDeletingId(memberId);
    try {
      const res = await fetch(`/api/team/members?memberId=${memberId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.id !== memberId));
      } else {
        const body = await res.json();
        alert(body.error?.message || "Failed to remove member");
      }
    } catch (err) {
      alert("Network error while removing member");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Team & Workspace Members</h2>
            <p className="text-sm text-muted-foreground">
              Manage your support agents, managers, and workspace administrators.
            </p>
          </div>
        </div>

        <Dialog open={openInvite} onOpenChange={setOpenInvite}>
          <Button onClick={() => setOpenInvite(true)} className="shrink-0 gap-1.5">
            <UserPlus className="h-4 w-4" /> Invite Member
          </Button>
          <DialogContent className="bg-card border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <UserPlus className="h-5 w-5 text-primary" /> Invite Team Member
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleInvite} className="space-y-4 pt-2">
              {inviteError && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-500 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{inviteError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Full Name (Optional)
                </label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Role & Permissions
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="agent">Agent (Inbox, Conversations & Contacts)</option>
                  <option value="manager">Manager (Inbox, Broadcasts & CRM Pipelines)</option>
                  <option value="tenant_admin">Admin (Full Access & Workspace Settings)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpenInvite(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={inviting}>
                  {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send Invitation
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500">
          {error}
        </div>
      )}

      {/* Members List */}
      <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
        {members.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No team members found.
          </div>
        ) : (
          members.map((member) => (
            <div key={member.id} className="p-4 sm:p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="h-10 w-10 rounded-full bg-slate-700 text-white flex items-center justify-center font-semibold text-sm shrink-0">
                  {member.fullName?.charAt(0).toUpperCase() || member.email.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground truncate">
                      {member.fullName || member.email.split("@")[0]}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        member.role === "tenant_admin"
                          ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                          : member.role === "manager"
                          ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                          : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      }`}
                    >
                      {member.role === "tenant_admin" ? "Admin" : member.role === "manager" ? "Manager" : "Agent"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 truncate">
                    <Mail className="h-3 w-3" />
                    <span>{member.email}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  Joined {new Date(member.createdAt).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deletingId === member.id}
                  onClick={() => handleRemove(member.id)}
                  className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 h-8 w-8 p-0"
                  title="Remove from workspace"
                >
                  {deletingId === member.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
