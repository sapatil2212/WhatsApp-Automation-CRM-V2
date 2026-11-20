"use client";

import { useState } from "react";
import { Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { Kbd } from "./parts";
import { api, type QuickReply } from "./types";

export function QuickRepliesDialog({
  open,
  onOpenChange,
  replies,
  onChanged,
  onUse,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  replies: QuickReply[];
  onChanged: (next: QuickReply[]) => void;
  onUse?: (text: string) => void;
}) {
  const [shortcut, setShortcut] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shortcut.trim() || !text.trim()) return;
    setSaving(true);
    try {
      const { data } = await api<QuickReply>("/api/inbox/quick-replies", { method: "POST", json: { shortcut, text } });
      onChanged([...replies, data].sort((a, b) => a.shortcut.localeCompare(b.shortcut)));
      setShortcut("");
      setText("");
      toast.success(`/${data.shortcut} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/inbox/quick-replies?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      onChanged(replies.filter((r) => r.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" /> Quick replies
          </DialogTitle>
          <DialogDescription>
            Canned responses shared with your whole team. Type <code>/shortcut</code> in the message box to insert one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-2">
          <div className="flex gap-2">
            <div className="flex w-40 items-center rounded-md border border-input pl-2 text-sm text-muted-foreground">
              /
              <Input
                value={shortcut}
                onChange={(e) => setShortcut(e.target.value.replace(/\s/g, "-").toLowerCase())}
                placeholder="hours"
                className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
                maxLength={32}
              />
            </div>
            <Button type="submit" disabled={saving || !shortcut.trim() || !text.trim()} className="ml-auto">
              {saving ? "Saving…" : "Add"}
            </Button>
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="We're open Monday–Saturday, 9am to 7pm." />
        </form>
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {replies.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No quick replies yet.</p>}
          {replies.map((r) => (
            <div key={r.id} className="group flex items-start gap-3 rounded-md border border-border px-3 py-2">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  if (onUse) {
                    onUse(r.text);
                    onOpenChange(false);
                  }
                }}
              >
                <span className="font-mono text-sm text-primary">/{r.shortcut}</span>
                <p className="line-clamp-2 text-sm text-muted-foreground">{r.text}</p>
              </button>
              <button
                type="button"
                aria-label={`Delete /${r.shortcut}`}
                onClick={() => void remove(r.id)}
                className="text-muted-foreground opacity-60 hover:text-destructive hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Ctrl", "K"], label: "Search chats" },
  { keys: ["Alt", "↑ / ↓"], label: "Previous / next chat" },
  { keys: ["Alt", "N"], label: "Next unread chat" },
  { keys: ["Alt", "R"], label: "Resolve / reopen chat" },
  { keys: ["Alt", "A"], label: "Assign to me" },
  { keys: ["Alt", "H"], label: "Toggle AI / human handling" },
  { keys: ["Alt", "S"], label: "Star chat" },
  { keys: ["Alt", "P"], label: "Pin chat" },
  { keys: ["Alt", "I"], label: "Contact info" },
  { keys: ["Alt", "T"], label: "Send template" },
  { keys: ["Alt", "Q"], label: "Quick replies" },
  { keys: ["Alt", "1–7"], label: "Switch filter" },
  { keys: ["Enter"], label: "Send message" },
  { keys: ["Shift", "Enter"], label: "New line" },
  { keys: ["/"], label: "Quick reply (in message box)" },
  { keys: ["Esc"], label: "Cancel reply / close panel" },
  { keys: ["?"], label: "This help" },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work through the inbox without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <ul className="wa-inbox grid gap-2 text-sm text-foreground">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4">
              <span>{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
