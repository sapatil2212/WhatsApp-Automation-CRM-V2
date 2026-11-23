"use client";

import { forwardRef, memo } from "react";
import { Ban, Bot, Keyboard, MessageSquareText, Pin, Search, Star, X, Zap, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";

import { Ticks, WaAvatar } from "./parts";
import {
  INBOX_FILTERS,
  displayName,
  listTimestamp,
  type Agent,
  type InboxConversation,
  type InboxFilter,
} from "./types";

interface ChatListProps {
  conversations: InboxConversation[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  activeId: string | null;
  onSelect: (c: InboxConversation) => void;
  filter: InboxFilter;
  onFilter: (f: InboxFilter) => void;
  counts: Partial<Record<InboxFilter, number>>;
  search: string;
  onSearch: (q: string) => void;
  agents: Agent[];
  connected: boolean;
  me: { name: string; avatarUrl: string | null; id: string } | null;
  onOpenShortcuts: () => void;
  onOpenQuickReplies: () => void;
}

export const ChatList = forwardRef<HTMLInputElement, ChatListProps>(function ChatList(props, searchRef) {
  const {
    conversations,
    loading,
    hasMore,
    onLoadMore,
    activeId,
    onSelect,
    filter,
    onFilter,
    counts,
    search,
    onSearch,
    agents,
    connected,
    me,
    onOpenShortcuts,
    onOpenQuickReplies,
  } = props;

  const agentName = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? null : null);

  return (
    <div className="flex h-full w-full flex-col border-r border-[var(--wa-border)] bg-[var(--wa-panel)]">
      {/* Header */}
      <header className="flex h-[52px] shrink-0 items-center justify-between bg-[var(--wa-panel-header)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          {me && <WaAvatar name={me.name} seed={me.id} url={me.avatarUrl} size={32} />}
          <div className="min-w-0">
            <h1 className="truncate text-[13.5px] font-medium leading-tight">Chats</h1>
            <p className="flex items-center gap-1 text-[11px] text-[var(--wa-text-2)]">
              {connected ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--wa-accent-strong)]" /> Live
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" /> Reconnecting…
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[var(--wa-text-2)]">
          <IconButton label="Quick replies" onClick={onOpenQuickReplies}>
            <Zap className="h-4 w-4" />
          </IconButton>
          <IconButton label="Keyboard shortcuts (?)" onClick={onOpenShortcuts}>
            <Keyboard className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      {/* Search */}
      <div className="shrink-0 px-3 pb-2 pt-2">
        <div className="flex h-8 items-center gap-2 rounded-full border border-[var(--wa-border)] bg-[var(--wa-panel-header)] px-3 focus-within:border-[var(--wa-accent)]">
          <Search className="h-4 w-4 shrink-0 text-[var(--wa-text-2)]" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)]"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onSearch("");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => onSearch("")} className="text-[var(--wa-text-2)]">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="wa-scroll -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter chats">
          {INBOX_FILTERS.map((f) => {
            const active = f.value === filter;
            const count = counts[f.value];
            return (
              <button
                key={f.value}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => onFilter(f.value)}
                className={cn(
                  "flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] transition-colors",
                  active
                    ? "bg-[var(--wa-chip-active)] text-[var(--wa-chip-active-text)]"
                    : "bg-[var(--wa-chip)] text-[var(--wa-text-2)] hover:text-[var(--wa-text)]",
                )}
              >
                {f.value === "starred" && <Star className="h-3.5 w-3.5" />}
                {f.label}
                {count !== undefined && count > 0 && f.value !== "all" && (
                  <span className="text-[11px] opacity-80">{count > 999 ? "999+" : count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div
        className="wa-scroll flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (hasMore && !loading && el.scrollHeight - el.scrollTop - el.clientHeight < 300) onLoadMore();
        }}
      >
        {conversations.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-2 px-8 py-16 text-center text-[var(--wa-text-2)]">
            <MessageSquareText className="h-10 w-10 opacity-60" />
            <p className="text-sm">{search ? `No chats match “${search}”` : "No chats in this view"}</p>
          </div>
        )}
        <ul role="listbox" aria-label="Chats">
          {conversations.map((c) => (
            <ChatRow
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              onSelect={onSelect}
              assigneeName={agentName(c.assignedAgentId)}
              assignedToMe={!!me && c.assignedAgentId === me.id}
            />
          ))}
        </ul>
        {loading && (
          <div className="space-y-0">
            {Array.from({ length: conversations.length ? 2 : 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="h-[38px] w-[38px] animate-pulse rounded-full bg-[var(--wa-panel-header)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/5 animate-pulse rounded bg-[var(--wa-panel-header)]" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--wa-panel-header)]" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

const ChatRow = memo(function ChatRow({
  conversation: c,
  active,
  onSelect,
  assigneeName,
  assignedToMe,
}: {
  conversation: InboxConversation;
  active: boolean;
  onSelect: (c: InboxConversation) => void;
  assigneeName: string | null;
  assignedToMe: boolean;
}) {
  const name = displayName(c.contact);
  const unread = c.unreadCount > 0;
  const outgoing = c.lastMessage && c.lastMessage.senderType !== "customer";
  const isBot = c.lastMessage?.senderType === "bot";

  return (
    <li role="option" aria-selected={active}>
      <button
        type="button"
        data-conv-id={c.id}
        onClick={() => onSelect(c)}
        className={cn(
          "group flex w-full items-center gap-3 pl-3 text-left transition-colors",
          active ? "bg-[var(--wa-panel-active)] shadow-[inset_2px_0_0_var(--wa-accent)]" : "hover:bg-[var(--wa-panel-hover)]",
        )}
      >
        <div className="relative py-[7px]">
          <WaAvatar name={name} seed={c.contact.id} url={c.contact.avatarUrl} />
          {c.status === "closed" && (
            <span
              title="Resolved"
              className="absolute bottom-[9px] right-0 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--wa-panel)] bg-[var(--wa-text-2)]"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center border-b border-[var(--wa-border)] py-[8px] pr-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13.5px] leading-[18px] text-[var(--wa-text)]">{name}</span>
            <span
              className={cn(
                "shrink-0 text-[11px]",
                unread ? "font-medium text-[var(--wa-badge)]" : "text-[var(--wa-text-2)]",
              )}
            >
              {listTimestamp(c.lastMessageAt ?? c.createdAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1 text-[12.5px] leading-5 text-[var(--wa-text-2)]">
              {outgoing && c.lastMessage && <Ticks status={c.lastMessage.status} />}
              {isBot && <Bot className="h-3.5 w-3.5 shrink-0" aria-label="Bot" />}
              {c.lastMessage?.status === "failed" && outgoing ? (
                <span className="truncate text-red-500">Failed to send</span>
              ) : c.lastMessageText ? (
                <span className={cn("truncate", unread && "text-[var(--wa-text)]")}>{c.lastMessageText}</span>
              ) : (
                <span className="flex items-center gap-1 truncate italic">
                  <Ban className="h-3.5 w-3.5" /> No messages yet
                </span>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-1.5 text-[var(--wa-text-2)]">
              {c.starred && <Star className="h-3.5 w-3.5 fill-current" aria-label="Starred" />}
              {c.pinned && <Pin className="h-3.5 w-3.5 rotate-45 fill-current" aria-label="Pinned" />}
              {unread && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--wa-badge)] px-1.5 text-[11px] font-semibold text-[var(--wa-badge-text)]">
                  {c.unreadCount > 99 ? "99+" : c.unreadCount}
                </span>
              )}
            </div>
          </div>
          {(c.contact.tags.length > 0 || assigneeName || c.status === "pending") && (
            <div className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden">
              {c.status === "pending" && (
                <span className="flex shrink-0 items-center gap-0.5 rounded bg-[var(--wa-panel-header)] px-1.5 py-px text-[10px] text-[var(--wa-text-2)]">
                  <Bot className="h-3 w-3" /> AI
                </span>
              )}
              {assigneeName && (
                <span
                  className={cn(
                    "shrink-0 truncate rounded px-1.5 py-px text-[10px]",
                    assignedToMe
                      ? "bg-[var(--wa-chip-active)] text-[var(--wa-chip-active-text)]"
                      : "bg-[var(--wa-panel-header)] text-[var(--wa-text-2)]",
                  )}
                >
                  @{assignedToMe ? "me" : assigneeName.split(" ")[0]}
                </span>
              )}
              {c.contact.tags.slice(0, 3).map((t) => (
                <span
                  key={t.id}
                  className="max-w-24 shrink-0 truncate rounded px-1.5 py-px text-[10px]"
                  style={{ backgroundColor: `${t.color}26`, color: t.color }}
                >
                  {t.name}
                </span>
              ))}
              {c.contact.tags.length > 3 && (
                <span className="text-[10px] text-[var(--wa-text-2)]">+{c.contact.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </button>
    </li>
  );
});

export function IconButton({
  label,
  onClick,
  children,
  active,
  className,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] transition-colors hover:bg-[var(--wa-panel-active)] disabled:opacity-40",
        active && "bg-[var(--wa-panel-active)] text-[var(--wa-text)]",
        className,
      )}
    >
      {children}
    </button>
  );
}
