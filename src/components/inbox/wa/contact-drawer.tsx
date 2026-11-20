"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bot,
  CalendarDays,
  Check,
  Copy,
  Mail,
  Phone,
  Plus,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { IconButton } from "./chat-list";
import { WaAvatar } from "./parts";
import { displayName, windowRemaining, type Agent, type ConversationContext, type InboxConversation } from "./types";

const LABEL_COLORS = ["#25d366", "#53bdeb", "#ff8f6b", "#a78bfa", "#f59e0b", "#ec4899", "#14b8a6", "#ef4444"];

interface DrawerProps {
  conversation: InboxConversation;
  context: ConversationContext | null;
  agents: Agent[];
  meId: string | null;
  onClose: () => void;
  onAssign: (agentId: string | null) => void;
  onStatus: (status: InboxConversation["status"]) => void;
  onAddTag: (input: { tagId?: string; name?: string; color?: string }) => Promise<void>;
  onRemoveTag: (tagId: string) => Promise<void>;
  onAddNote: (text: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
}

function Section({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-[var(--wa-panel)] px-6 py-4 lg:px-[30px]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[14px] text-[var(--wa-text-2)]">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ContactDrawer({
  conversation,
  context,
  agents,
  meId,
  onClose,
  onAssign,
  onStatus,
  onAddTag,
  onRemoveTag,
  onAddNote,
  onDeleteNote,
}: DrawerProps) {
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const name = displayName(conversation.contact);
  const tags = context?.contact.tags ?? conversation.contact.tags;
  const assignee = agents.find((a) => a.id === conversation.assignedAgentId) ?? null;
  const window = windowRemaining(conversation.serviceWindow.lastCustomerMessageAt);
  const unusedTags = (context?.availableTags ?? []).filter((t) => !tags.some((x) => x.id === t.id));

  return (
    <aside className="flex h-full w-full flex-col bg-[var(--wa-chat-bg)]" aria-label="Contact info">
      <header className="flex h-[59px] shrink-0 items-center gap-6 bg-[var(--wa-panel-header)] px-4">
        <IconButton label="Close contact info" onClick={onClose}>
          <X className="h-5 w-5" />
        </IconButton>
        <h2 className="text-[16px]">Contact info</h2>
      </header>

      <div className="wa-scroll flex-1 space-y-2.5 overflow-y-auto pb-6">
        {/* Profile */}
        <section className="flex flex-col items-center bg-[var(--wa-panel)] px-6 pb-5 pt-7 text-center">
          <WaAvatar name={name} seed={conversation.contact.id} url={conversation.contact.avatarUrl} size={150} />
          <h3 className="mt-4 text-[22px] leading-tight">{name}</h3>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(conversation.contact.phone);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="mt-1 flex items-center gap-1.5 text-[16px] text-[var(--wa-text-2)] hover:text-[var(--wa-text)]"
          >
            {conversation.contact.phone}
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-[12px]">
            <span
              className={cn(
                "rounded-full px-2.5 py-1",
                window.expired ? "bg-red-500/15 text-red-500" : "bg-[var(--wa-chip-active)] text-[var(--wa-chip-active-text)]",
              )}
            >
              {window.expired ? "Window closed" : `Window: ${window.label}`}
            </span>
            {context && (
              <span className="rounded-full bg-[var(--wa-chip)] px-2.5 py-1 text-[var(--wa-text-2)]">
                {context.conversation.messageCount} messages
              </span>
            )}
          </div>
        </section>

        {/* Conversation controls */}
        <Section title="Conversation" icon={<UserRound className="h-4 w-4" />}>
          <div className="space-y-3 text-[14px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--wa-text-2)]">Assigned to</span>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex max-w-[60%] items-center gap-2 truncate rounded-md px-2 py-1 hover:bg-[var(--wa-panel-active)]">
                  {assignee ? (
                    <>
                      <WaAvatar name={assignee.name} seed={assignee.id} url={assignee.avatarUrl} size={22} />
                      <span className="truncate">{assignee.isMe ? "You" : assignee.name}</span>
                    </>
                  ) : (
                    <span className="text-[var(--wa-accent-strong)]">Unassigned</span>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {meId && conversation.assignedAgentId !== meId && (
                    <DropdownMenuItem onClick={() => onAssign(meId)}>Assign to me</DropdownMenuItem>
                  )}
                  {agents.map((a) => (
                    <DropdownMenuItem key={a.id} onClick={() => onAssign(a.id)}>
                      <WaAvatar name={a.name} seed={a.id} url={a.avatarUrl} size={22} className="mr-2" />
                      <span className="flex-1 truncate">
                        {a.name}
                        {a.isMe ? " (you)" : ""}
                      </span>
                      {a.id === conversation.assignedAgentId && <Check className="h-4 w-4" />}
                    </DropdownMenuItem>
                  ))}
                  {conversation.assignedAgentId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onAssign(null)}>Unassign</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--wa-text-2)]">Status</span>
              <div className="flex overflow-hidden rounded-md border border-[var(--wa-border)] text-[13px]">
                {(
                  [
                    ["open", "Open"],
                    ["pending", "AI"],
                    ["closed", "Resolved"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onStatus(value)}
                    className={cn(
                      "px-2.5 py-1",
                      conversation.status === value
                        ? "bg-[var(--wa-chip-active)] text-[var(--wa-chip-active-text)]"
                        : "text-[var(--wa-text-2)] hover:bg-[var(--wa-panel-active)]",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-md bg-[var(--wa-panel-header)] px-3 py-2 text-[12px] text-[var(--wa-text-2)]">
              <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {conversation.status === "open"
                ? "A human is handling this chat — the AI assistant only sends a holding message."
                : conversation.status === "pending"
                  ? "The AI assistant replies automatically."
                  : "Resolved. The AI assistant answers if the customer writes again."}
            </p>
          </div>
        </Section>

        {/* Labels */}
        <Section
          title="Labels"
          icon={<TagIcon className="h-4 w-4" />}
          action={
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="Add label" className="rounded-full p-1 text-[var(--wa-accent-strong)] hover:bg-[var(--wa-panel-active)]">
                <Plus className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <div className="p-1.5" onKeyDown={(e) => e.stopPropagation()}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newLabel.trim()) return;
                      void onAddTag({
                        name: newLabel.trim(),
                        color: LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)],
                      }).then(() => setNewLabel(""));
                    }}
                  >
                    <input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="New label…"
                      className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none"
                    />
                  </form>
                </div>
                {unusedTags.length > 0 && <DropdownMenuSeparator />}
                {unusedTags.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => void onAddTag({ tagId: t.id })}>
                    <span className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          {tags.length === 0 ? (
            <p className="text-[13px] text-[var(--wa-text-2)]">No labels yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="group flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px]"
                  style={{ backgroundColor: `${t.color}26`, color: t.color }}
                >
                  {t.name}
                  <button type="button" aria-label={`Remove ${t.name}`} onClick={() => void onRemoveTag(t.id)} className="opacity-60 hover:opacity-100">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* Details */}
        <Section title="Details" icon={<Phone className="h-4 w-4" />}>
          <dl className="space-y-2 text-[14px]">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--wa-text-2)]">Phone</dt>
              <dd className="truncate">{conversation.contact.phone}</dd>
            </div>
            {context?.contact.email && (
              <div className="flex justify-between gap-3">
                <dt className="flex items-center gap-1 text-[var(--wa-text-2)]">
                  <Mail className="h-3.5 w-3.5" /> Email
                </dt>
                <dd className="truncate">{context.contact.email}</dd>
              </div>
            )}
            {context?.contact.company && (
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--wa-text-2)]">Company</dt>
                <dd className="truncate">{context.contact.company}</dd>
              </div>
            )}
            {context && (
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--wa-text-2)]">Customer since</dt>
                <dd>{new Date(context.contact.createdAt).toLocaleDateString()}</dd>
              </div>
            )}
          </dl>
        </Section>

        {/* Appointments (clinics) */}
        {context && context.appointments.length > 0 && (
          <Section title="Appointments" icon={<CalendarDays className="h-4 w-4" />}>
            <ul className="space-y-2">
              {context.appointments.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 rounded-md bg-[var(--wa-panel-header)] px-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <p>
                      {new Date(`${a.date}T00:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })} · {a.time}
                    </p>
                    <p className="truncate text-[12px] text-[var(--wa-text-2)]">
                      {[a.doctorName, a.reason].filter(Boolean).join(" · ") || "Appointment"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] capitalize",
                      a.status === "cancelled"
                        ? "bg-red-500/15 text-red-500"
                        : a.status === "completed"
                          ? "bg-[var(--wa-chip)] text-[var(--wa-text-2)]"
                          : "bg-[var(--wa-chip-active)] text-[var(--wa-chip-active-text)]",
                    )}
                  >
                    {a.status}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Deals */}
        <Section
          title="Pipeline"
          icon={<TrendingUp className="h-4 w-4" />}
          action={
            <Link href="/pipelines" className="text-[12px] text-[var(--wa-accent-strong)] hover:underline">
              Open pipelines
            </Link>
          }
        >
          {!context || context.deals.length === 0 ? (
            <p className="text-[13px] text-[var(--wa-text-2)]">No deals for this contact.</p>
          ) : (
            <ul className="space-y-2">
              {context.deals.map((d) => (
                <li key={d.id} className="rounded-md bg-[var(--wa-panel-header)] px-3 py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{d.title}</span>
                    <span className="shrink-0">
                      {new Intl.NumberFormat(undefined, { style: "currency", currency: d.currency || "USD", maximumFractionDigits: 0 }).format(d.value)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--wa-text-2)]">
                    {d.stage && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.stage.color }} />
                        {d.stage.name}
                      </span>
                    )}
                    {d.pipeline && <span className="truncate">· {d.pipeline.name}</span>}
                    <span className="ml-auto capitalize">{d.status}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Notes */}
        <Section title="Internal notes" icon={<StickyNote className="h-4 w-4" />}>
          <form
            className="mb-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim() || savingNote) return;
              setSavingNote(true);
              onAddNote(note.trim())
                .then(() => setNote(""))
                .catch(() => toast.error("Could not save the note"))
                .finally(() => setSavingNote(false));
            }}
          >
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Add a note for your team…"
              className="w-full resize-none rounded-md border border-[var(--wa-note-border)] bg-[var(--wa-note)] px-3 py-2 text-[13px] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }}
            />
            <div className="mt-1 flex justify-end">
              <button
                type="submit"
                disabled={!note.trim() || savingNote}
                className="rounded-full bg-[var(--wa-accent)] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
              >
                {savingNote ? "Saving…" : "Add note"}
              </button>
            </div>
          </form>
          {!context ? (
            <div className="h-10 animate-pulse rounded bg-[var(--wa-panel-header)]" />
          ) : context.notes.length === 0 ? (
            <p className="text-[13px] text-[var(--wa-text-2)]">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {context.notes.map((n) => (
                <li key={n.id} className="group rounded-md border-l-2 border-[var(--wa-note-border)] bg-[var(--wa-note)] px-3 py-2 text-[13px]">
                  <p className="whitespace-pre-wrap break-words">{n.text}</p>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--wa-text-2)]">
                    <span>
                      {n.authorName ?? "Team"} · {new Date(n.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    {n.authorId === meId && (
                      <button
                        type="button"
                        aria-label="Delete note"
                        onClick={() => void onDeleteNote(n.id)}
                        className="opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </aside>
  );
}
