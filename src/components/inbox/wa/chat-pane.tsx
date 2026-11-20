"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  EllipsisVertical,
  Loader2,
  Pin,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  UserCheck,
  UserRound,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Bubble } from "./bubble";
import { IconButton } from "./chat-list";
import { Composer, type ComposerHandle } from "./composer";
import { WaAvatar } from "./parts";
import {
  dateSeparator,
  displayName,
  previewFor,
  windowRemaining,
  type Agent,
  type InboxConversation,
  type InboxMessage,
  type QuickReply,
} from "./types";

interface ChatPaneProps {
  conversation: InboxConversation;
  messages: InboxMessage[];
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  agents: Agent[];
  meId: string | null;
  infoOpen: boolean;
  onToggleInfo: () => void;
  onBack: () => void;
  onAssign: (agentId: string | null) => void;
  onStatus: (status: InboxConversation["status"]) => void;
  onPrefs: (prefs: { pinned?: boolean; starred?: boolean }) => void;
  onSendText: (text: string, replyToId: string | null) => void;
  onSendFile: (file: File, caption: string, replyToId: string | null) => Promise<void>;
  onSendNote: (text: string) => Promise<void>;
  onRetry: (m: InboxMessage) => void;
  onReact: (m: InboxMessage, emoji: string) => void;
  onOpenTemplates: () => void;
  quickReplies: QuickReply[];
  onManageQuickReplies: () => void;
  onSimulate?: (text: string) => Promise<void>;
}

export interface ChatPaneHandle {
  focusComposer: () => void;
}

/** Re-renders every 30s so the 24h countdown stays live. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const ChatPane = forwardRef<ChatPaneHandle, ChatPaneProps>(function ChatPane(props, ref) {
  const {
    conversation: c,
    messages,
    loading,
    hasOlder,
    loadingOlder,
    onLoadOlder,
    agents,
    meId,
    infoOpen,
    onToggleInfo,
    onBack,
    onAssign,
    onStatus,
    onPrefs,
    onSendText,
    onSendFile,
    onSendNote,
    onRetry,
    onReact,
    onOpenTemplates,
    quickReplies,
    onManageQuickReplies,
    onSimulate,
  } = props;

  const name = displayName(c.contact);
  const now = useNow();
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<InboxMessage | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [simOpen, setSimOpen] = useState(false);
  const [simText, setSimText] = useState("");
  const [simBusy, setSimBusy] = useState(false);

  // The live window is derived from the newest customer message we hold,
  // falling back to the server's value for threads still loading.
  const lastInbound = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].senderType === "customer") return messages[i].createdAt;
    return c.serviceWindow.lastCustomerMessageAt;
  }, [messages, c.serviceWindow.lastCustomerMessageAt]);
  const win = windowRemaining(lastInbound, now);

  useImperativeHandle(ref, () => ({ focusComposer: () => composerRef.current?.focus() }));

  // Reset per conversation.
  const convId = c.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReplyTo(null);
    setFindOpen(false);
    setFind("");
    setSimOpen(false);
    setUnseen(0);
    setAtBottom(true);
  }, [convId]);

  // Keep pinned to the bottom when new messages arrive and the agent is
  // already there; otherwise count them on the jump-to-bottom button. When an
  // older page is prepended, restore the visual position instead.
  const prevLen = useRef(0);
  const prevFirstId = useRef<string | null>(null);
  const restoreFrom = useRef<{ height: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = messages[0]?.id ?? null;
    if (restoreFrom.current && firstId !== prevFirstId.current) {
      el.scrollTop = el.scrollHeight - restoreFrom.current.height + restoreFrom.current.top;
      restoreFrom.current = null;
    } else if (prevLen.current === 0 || atBottom) {
      el.scrollTop = el.scrollHeight;
    } else if (messages.length > prevLen.current) {
      const added = messages.length - prevLen.current;
       
      setUnseen((n) => n + added);
    }
    prevLen.current = messages.length;
    prevFirstId.current = firstId;
  }, [messages, atBottom]);
  useEffect(() => {
    prevLen.current = 0;
    restoreFrom.current = null;
  }, [convId]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("wa-flash");
    void el.offsetWidth;
    el.classList.add("wa-flash");
  };

  const agentName = (id: string | null) => {
    if (!id) return "Agent";
    const a = agents.find((x) => x.id === id);
    return a ? (a.isMe ? "You" : a.name) : "Agent";
  };
  const assignee = agents.find((a) => a.id === c.assignedAgentId) ?? null;

  const visible = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => (m.contentText ?? "").toLowerCase().includes(q));
  }, [messages, find]);

  const subtitle = assignee
    ? `Assigned to ${assignee.isMe ? "you" : assignee.name}`
    : c.status === "pending"
      ? "AI assistant is replying"
      : "Unassigned · click for contact info";

  const aiActive = c.status !== "open";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="z-10 flex h-[59px] shrink-0 items-center gap-1 border-l border-[var(--wa-border)] bg-[var(--wa-panel-header)] pl-1 pr-2 sm:gap-2 sm:pl-4">
        <IconButton label="Back to chats" onClick={onBack} className="lg:hidden">
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        <button type="button" onClick={onToggleInfo} aria-expanded={infoOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <WaAvatar name={name} seed={c.contact.id} url={c.contact.avatarUrl} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[16px] leading-tight">{name}</p>
            <p className="truncate text-[13px] text-[var(--wa-text-2)]">{subtitle}</p>
          </div>
        </button>

        {/* 24h window countdown */}
        <span
          title={
            win.expired
              ? "Outside the 24-hour customer service window — only templates can be sent."
              : "Time left in the 24-hour customer service window"
          }
          className={cn(
            "hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] md:flex",
            win.expired
              ? "bg-red-500/15 text-red-500"
              : win.ms < 2 * 3_600_000
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-[var(--wa-chip-active)] text-[var(--wa-chip-active-text)]",
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          {win.label}
        </span>

        {/* AI ↔ human handover */}
        <button
          type="button"
          onClick={() => onStatus(aiActive ? "open" : "pending")}
          title={aiActive ? "AI is handling — click to take over (human)" : "You are handling — click to hand back to AI"}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
            aiActive
              ? "border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#a78bfa]"
              : "border-[var(--wa-border)] bg-[var(--wa-panel)] text-[var(--wa-text)]",
          )}
        >
          {aiActive ? <Bot className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
          <span className="hidden sm:inline">{aiActive ? "AI" : "Human"}</span>
        </button>

        {/* Resolve / reopen */}
        {c.status === "closed" ? (
          <button
            type="button"
            onClick={() => onStatus("open")}
            className="hidden h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--wa-border)] px-3 text-[12px] text-[var(--wa-text-2)] hover:text-[var(--wa-text)] sm:flex"
          >
            <RotateCcw className="h-4 w-4" /> Reopen
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onStatus("closed")}
            className="hidden h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--wa-accent)] px-3 text-[12px] font-medium text-white hover:opacity-90 sm:flex"
          >
            <CheckCircle2 className="h-4 w-4" /> Resolve
          </button>
        )}

        <IconButton label="Search messages" onClick={() => setFindOpen((v) => !v)} active={findOpen} className="hidden sm:flex">
          <Search className="h-5 w-5" />
        </IconButton>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Chat menu"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] hover:bg-[var(--wa-panel-active)]"
          >
            <EllipsisVertical className="h-5 w-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={onToggleInfo}>Contact info</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFindOpen(true)}>Search messages</DropdownMenuItem>
            <DropdownMenuSeparator />
            {meId && c.assignedAgentId !== meId && (
              <DropdownMenuItem onClick={() => onAssign(meId)}>
                <UserCheck className="mr-2 h-4 w-4" /> Assign to me
              </DropdownMenuItem>
            )}
            {agents
              .filter((a) => a.id !== meId)
              .map((a) => (
                <DropdownMenuItem key={a.id} onClick={() => onAssign(a.id)}>
                  Assign to {a.name}
                </DropdownMenuItem>
              ))}
            {c.assignedAgentId && <DropdownMenuItem onClick={() => onAssign(null)}>Unassign</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onStatus(c.status === "closed" ? "open" : "closed")}>
              {c.status === "closed" ? "Reopen chat" : "Mark as resolved"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPrefs({ starred: !c.starred })}>
              <Star className="mr-2 h-4 w-4" /> {c.starred ? "Unstar chat" : "Star chat"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPrefs({ pinned: !c.pinned })}>
              <Pin className="mr-2 h-4 w-4" /> {c.pinned ? "Unpin chat" : "Pin chat"}
            </DropdownMenuItem>
            {onSimulate && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSimOpen(true)}>
                  <Sparkles className="mr-2 h-4 w-4" /> Simulate customer message
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {findOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--wa-border)] bg-[var(--wa-panel)] px-4 py-2">
          <Search className="h-4 w-4 text-[var(--wa-text-2)]" />
          <input
            autoFocus
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setFindOpen(false), setFind(""))}
            placeholder="Search in this chat"
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--wa-text-2)]"
          />
          {find && <span className="text-[12px] text-[var(--wa-text-2)]">{visible.length} found</span>}
          <button type="button" aria-label="Close search" onClick={() => (setFindOpen(false), setFind(""))} className="text-[var(--wa-text-2)]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {simOpen && onSimulate && (
        <form
          className="flex shrink-0 items-center gap-2 border-b border-[#a78bfa]/30 bg-[#a78bfa]/10 px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!simText.trim() || simBusy) return;
            setSimBusy(true);
            onSimulate(simText.trim())
              .then(() => setSimText(""))
              .finally(() => setSimBusy(false));
          }}
        >
          <Sparkles className="h-4 w-4 shrink-0 text-[#a78bfa]" />
          <input
            autoFocus
            value={simText}
            onChange={(e) => setSimText(e.target.value)}
            placeholder="Simulate an incoming customer message (runs the AI assistant)"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--wa-text-2)]"
          />
          <button type="submit" disabled={simBusy || !simText.trim()} className="shrink-0 rounded-full bg-[#7c3aed] px-3 py-1 text-[12px] text-white disabled:opacity-50">
            {simBusy ? "Sending…" : "Send as customer"}
          </button>
          <button type="button" aria-label="Close simulator" onClick={() => setSimOpen(false)} className="text-[var(--wa-text-2)]">
            <X className="h-4 w-4" />
          </button>
        </form>
      )}

      {/* Messages */}
      <div className="wa-wallpaper relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="wa-scroll absolute inset-0 overflow-y-auto pb-3"
          onScroll={(e) => {
            const el = e.currentTarget;
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (bottom !== atBottom) setAtBottom(bottom);
            if (bottom && unseen) setUnseen(0);
            if (el.scrollTop < 120 && hasOlder && !loadingOlder && !find) {
              restoreFrom.current = { height: el.scrollHeight, top: el.scrollTop };
              onLoadOlder();
            }
          }}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--wa-text-2)]" />
            </div>
          ) : (
            <div className="relative pt-2">
              {loadingOlder && (
                <div className="flex justify-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--wa-text-2)]" />
                </div>
              )}
              {!hasOlder && (
                <div className="mx-auto mb-2 mt-2 w-fit max-w-[90%] rounded-lg bg-[var(--wa-system)] px-3 py-1.5 text-center text-[12.5px] text-[var(--wa-text-2)] shadow-[var(--wa-shadow)]">
                  🔒 Messages are delivered through the WhatsApp Business Platform. Internal notes stay inside your team.
                </div>
              )}
              {visible.length === 0 && (
                <div className="mx-auto mt-6 w-fit rounded-lg bg-[var(--wa-system)] px-4 py-2 text-[13px] text-[var(--wa-text-2)] shadow-[var(--wa-shadow)]">
                  {find ? "No messages match your search" : "No messages yet — send a template to start the conversation"}
                </div>
              )}
              {visible.map((m, i) => {
                const prev = visible[i - 1];
                const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                const side = (x: InboxMessage) => (x.senderType === "customer" ? "in" : "out");
                const first = newDay || !prev || side(prev) !== side(m) || prev.senderType !== m.senderType;
                return (
                  <div key={m.id}>
                    {newDay && (
                      <div className="sticky top-1 z-[3] my-2 flex justify-center">
                        <span className="rounded-lg bg-[var(--wa-date)] px-3 py-1.5 text-[12.5px] uppercase text-[var(--wa-text-2)] shadow-[var(--wa-shadow)]">
                          {dateSeparator(m.createdAt)}
                        </span>
                      </div>
                    )}
                    <Bubble
                      message={m}
                      first={first}
                      contactName={name}
                      agentName={agentName}
                      currentUserId={meId}
                      onReply={(msg) => {
                        setReplyTo(msg);
                        composerRef.current?.focus();
                      }}
                      onReact={onReact}
                      onJumpTo={jumpTo}
                      onRetry={onRetry}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {!atBottom && (
          <button
            type="button"
            aria-label="Scroll to latest"
            onClick={scrollToBottom}
            className="absolute bottom-4 right-5 z-[4] flex h-10 w-10 items-center justify-center rounded-full bg-[var(--wa-panel-header)] text-[var(--wa-text-2)] shadow-lg"
          >
            <ArrowDown className="h-5 w-5" />
            {unseen > 0 && (
              <span className="absolute -top-1.5 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--wa-badge)] px-1 text-[11px] font-semibold text-[var(--wa-badge-text)]">
                {unseen}
              </span>
            )}
          </button>
        )}
      </div>

      <Composer
        ref={composerRef}
        conversationId={c.id}
        windowExpired={win.expired}
        replyTo={replyTo ? { authorLabel: replyTo.senderType === "customer" ? name : "You", preview: previewFor(replyTo) } : null}
        onClearReply={() => setReplyTo(null)}
        onSendText={(text) => {
          onSendText(text, replyTo?.id ?? null);
          setReplyTo(null);
          setAtBottom(true);
        }}
        onSendFile={async (file, caption) => {
          await onSendFile(file, caption, replyTo?.id ?? null);
          setReplyTo(null);
          setAtBottom(true);
        }}
        onSendNote={onSendNote}
        onOpenTemplates={onOpenTemplates}
        quickReplies={quickReplies}
        onManageQuickReplies={onManageQuickReplies}
        recentMessages={messages.slice(-8).map((m) => ({
          senderType: m.senderType === "customer" ? ("customer" as const) : ("agent" as const),
          text: m.contentText ?? "",
        }))}
      />
    </div>
  );
});
