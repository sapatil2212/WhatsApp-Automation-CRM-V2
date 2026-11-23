"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, MessagesSquare, WifiOff } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { MessageTemplate } from "@/types";
import { TemplatePicker } from "@/components/inbox/template-picker";

import { ChatList } from "./chat-list";
import { ChatPane, type ChatPaneHandle } from "./chat-pane";
import { ContactDrawer } from "./contact-drawer";
import { QuickRepliesDialog, ShortcutsDialog } from "./dialogs";
import { useInboxSocket, type ConversationEvent, type MessageEvent } from "./use-inbox-socket";
import {
  ApiError,
  INBOX_FILTERS,
  api,
  displayName,
  previewFor,
  type Agent,
  type ConversationContext,
  type InboxConversation,
  type InboxFilter,
  type InboxMessage,
  type QuickReply,
} from "./types";

const PAGE_SIZE = 50;
const MESSAGE_PAGE = 60;

type Thread = { items: InboxMessage[]; hasOlder: boolean; loading: boolean; loadingOlder: boolean };

function sortConversations(list: InboxConversation[]): InboxConversation[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ta = new Date(a.lastMessageAt ?? a.createdAt).getTime();
    const tb = new Date(b.lastMessageAt ?? b.createdAt).getTime();
    return tb - ta;
  });
}

function matchesFilter(c: InboxConversation, filter: InboxFilter, meId: string | null, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (q) {
    const hay = `${c.contact.name ?? ""} ${c.contact.phone} ${c.lastMessageText ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  const active = c.status === "open" || c.status === "pending";
  switch (filter) {
    case "unread":
      return c.unreadCount > 0;
    case "mine":
      return !!meId && c.assignedAgentId === meId && active;
    case "unassigned":
      return !c.assignedAgentId && active;
    case "open":
      return active;
    case "resolved":
      return c.status === "closed";
    case "starred":
      return c.starred;
    default:
      return true;
  }
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => params[Number(raw) - 1] ?? `{{${raw}}}`);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function InboxApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("c");
  const { user, profile } = useAuth();
  const meId = user?.id ?? null;

  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [counts, setCounts] = useState<Partial<Record<InboxFilter, number>>>({});
  const [activeId, setActiveId] = useState<string | null>(deepLinkId);
  /** Active chat when it is outside the loaded list (deep link, other filter). */
  const [detached, setDetached] = useState<InboxConversation | null>(null);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [context, setContext] = useState<ConversationContext | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const paneRef = useRef<ChatPaneHandle>(null);
  const tempToReal = useRef(new Map<string, string>());
  const listReq = useRef(0);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? (detached?.id === activeId ? detached : null),
    [conversations, activeId, detached],
  );
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  });
  /** Synchronous mirror of the list, for socket handlers (updaters run later). */
  const listRef = useRef(conversations);
  useEffect(() => {
    listRef.current = conversations;
  });
  const filterRef = useRef({ filter, search: debouncedSearch, meId });
  useEffect(() => {
    filterRef.current = { filter, search: debouncedSearch, meId };
  });

  // ── data loading ────────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadCounts = useCallback(async () => {
    try {
      const { data } = await api<Record<InboxFilter, number>>("/api/inbox/counts");
      setCounts(data);
    } catch {
      /* chips just show no numbers */
    }
  }, []);
  const countsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCounts = useCallback(() => {
    if (countsTimer.current) clearTimeout(countsTimer.current);
    countsTimer.current = setTimeout(() => void loadCounts(), 600);
  }, [loadCounts]);

  const loadList = useCallback(
    async (pageToLoad: number) => {
      const req = ++listReq.current;
      setLoadingList(true);
      try {
        const qs = new URLSearchParams({ filter, page: String(pageToLoad), pageSize: String(PAGE_SIZE) });
        if (debouncedSearch.trim()) qs.set("search", debouncedSearch.trim());
        const { data, meta } = await api<InboxConversation[]>(`/api/inbox/conversations?${qs}`);
        if (req !== listReq.current) return;
        const pagination = meta?.pagination as { hasNext?: boolean } | undefined;
        setHasMore(!!pagination?.hasNext);
        setPage(pageToLoad);
        setConversations((prev) => {
          if (pageToLoad === 1) return sortConversations(data);
          const seen = new Set(prev.map((c) => c.id));
          return sortConversations([...prev, ...data.filter((c) => !seen.has(c.id))]);
        });
      } catch (err) {
        if (req === listReq.current) toast.error(err instanceof Error ? err.message : "Could not load chats");
      } finally {
        if (req === listReq.current) setLoadingList(false);
      }
    },
    [filter, debouncedSearch],
  );

  useEffect(() => {
     
    void loadList(1);
  }, [loadList]);

  useEffect(() => {
    void loadCounts();
    api<Agent[]>("/api/inbox/agents")
      .then(({ data }) => setAgents(data))
      .catch(() => {});
    api<QuickReply[]>("/api/inbox/quick-replies")
      .then(({ data }) => setQuickReplies(data))
      .catch(() => {});
    // Same check the previous inbox ran, via the compat client.
    (async () => {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const uid = session?.session?.user?.id;
      if (!uid) return;
      const { data } = await supabase.from("whatsapp_config").select("status").eq("user_id", uid).maybeSingle();
      setWaConnected((data as { status?: string } | null)?.status === "connected");
    })().catch(() => {});
  }, [loadCounts]);

  // Deep link (`/inbox?c=<id>`) — also reacts to in-app navigation.
  useEffect(() => {
    if (deepLinkId && deepLinkId !== activeId) {
       
      setActiveId(deepLinkId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId]);

  // Fetch the active chat's row when it is not part of the loaded list.
  useEffect(() => {
    if (!activeId || loadingList) return;
    if (conversations.some((c) => c.id === activeId) || detached?.id === activeId) return;
    api<InboxConversation>(`/api/inbox/conversations/${activeId}`)
      .then(({ data }) => setDetached(data))
      .catch(() => {
        toast.error("That conversation could not be found");
        setActiveId(null);
        router.replace("/inbox", { scroll: false });
      });
  }, [activeId, conversations, detached, loadingList, router]);

  const patchConversation = useCallback((id: string, patch: Partial<InboxConversation>) => {
    setConversations((prev) => sortConversations(prev.map((c) => (c.id === id ? { ...c, ...patch } : c))));
    setDetached((d) => (d && d.id === id ? { ...d, ...patch } : d));
  }, []);

  const setThread = useCallback((id: string, update: (t: Thread) => Thread) => {
    setThreads((prev) => {
      const current = prev[id] ?? { items: [], hasOlder: false, loading: false, loadingOlder: false };
      return { ...prev, [id]: update(current) };
    });
  }, []);

  const loadMessages = useCallback(
    async (id: string, opts?: { older?: boolean; silent?: boolean }) => {
      const older = !!opts?.older;
      let before: string | undefined;
      setThreads((prev) => {
        const t = prev[id];
        if (older && t?.items[0]) before = t.items.find((m) => !m.pending)?.createdAt;
        return {
          ...prev,
          [id]: {
            items: t?.items ?? [],
            hasOlder: t?.hasOlder ?? false,
            loading: !older && !opts?.silent && !t?.items.length,
            loadingOlder: older,
          },
        };
      });
      try {
        const qs = new URLSearchParams({ pageSize: String(MESSAGE_PAGE) });
        if (older && before) qs.set("before", before);
        const { data, meta } = await api<InboxMessage[]>(`/api/conversations/${id}/messages?${qs}`);
        const hasNext = !!(meta?.pagination as { hasNext?: boolean } | undefined)?.hasNext;
        const chronological = [...data].reverse();
        setThread(id, (t) => {
          if (older) {
            const seen = new Set(t.items.map((m) => m.id));
            return { ...t, items: [...chronological.filter((m) => !seen.has(m.id)), ...t.items], hasOlder: hasNext, loadingOlder: false };
          }
          // Keep optimistic bubbles still in flight.
          const pending = t.items.filter((m) => m.pending && !chronological.some((x) => x.id === tempToReal.current.get(m.id)));
          return { items: [...chronological, ...pending], hasOlder: hasNext, loading: false, loadingOlder: false };
        });
      } catch (err) {
        setThread(id, (t) => ({ ...t, loading: false, loadingOlder: false }));
        toast.error(err instanceof Error ? err.message : "Could not load messages");
      }
    },
    [setThread],
  );

  const loadContext = useCallback(async (id: string) => {
    try {
      const { data } = await api<ConversationContext>(`/api/inbox/conversations/${id}/context`);
      if (activeRef.current?.id === id) setContext(data);
    } catch {
      /* drawer shows what it has */
    }
  }, []);

  const markRead = useCallback(
    (id: string) => {
      patchConversation(id, { unreadCount: 0 });
      void fetch(`/api/conversations/${id}/read`, { method: "POST" }).catch(() => {});
    },
    [patchConversation],
  );

  // Opening a chat: load its thread + context, clear the badge.
  useEffect(() => {
    if (!activeId) {
       
      setContext(null);
      return;
    }
    setContext(null);
    void loadMessages(activeId, { silent: !!threads[activeId]?.items.length });
    void loadContext(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    if (active && active.unreadCount > 0 && document.visibilityState === "visible") markRead(active.id);
  }, [active, markRead]);

  // ── realtime ────────────────────────────────────────────────────

  const fetchRow = useCallback(async (id: string) => {
    try {
      const { data } = await api<InboxConversation>(`/api/inbox/conversations/${id}`);
      const f = filterRef.current;
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === id);
        if (exists) return sortConversations(prev.map((c) => (c.id === id ? data : c)));
        if (!matchesFilter(data, f.filter, f.meId, f.search)) return prev;
        return sortConversations([data, ...prev]);
      });
      setDetached((d) => (d && d.id === id ? data : d));
    } catch {
      /* deleted or not visible */
    }
  }, []);

  const onMessage = useCallback(
    (e: MessageEvent) => {
      const m = e.message;
      setThreads((prev) => {
        const t = prev[e.conversationId];
        if (!t) return prev;
        let items = t.items;
        const idx = items.findIndex((x) => x.id === m.id);
        if (idx >= 0) {
          items = items.map((x, i) => (i === idx ? { ...x, ...m, filename: x.filename, pending: false } : x));
        } else if (e.kind === "created") {
          // Our own send may land here before the HTTP response does.
          const tempIdx =
            m.senderType === "agent"
              ? items.findIndex(
                  (x) =>
                    x.pending &&
                    (tempToReal.current.get(x.id) === m.id ||
                      ((x.contentText ?? "") === (m.contentText ?? "") && x.contentType === m.contentType)),
                )
              : -1;
          if (tempIdx >= 0) {
            tempToReal.current.set(items[tempIdx].id, m.id);
            items = items.map((x, i) => (i === tempIdx ? { ...m, filename: x.filename } : x));
          } else {
            items = [...items, m];
          }
        } else {
          return prev;
        }
        return { ...prev, [e.conversationId]: { ...t, items } };
      });

      setConversations((prev) => {
        const row = prev.find((c) => c.id === e.conversationId);
        if (!row) return prev;
        const isNewest = !row.lastMessageAt || new Date(m.createdAt).getTime() >= new Date(row.lastMessageAt).getTime() - 1000;
        if (!isNewest) return prev;
        return prev.map((c) =>
          c.id === e.conversationId
            ? {
                ...c,
                lastMessage: { senderType: m.senderType, status: m.status, contentType: m.contentType },
                ...(m.senderType === "customer" && e.kind === "created"
                  ? { serviceWindow: { expired: false, hoursRemaining: 24, lastCustomerMessageAt: m.createdAt } }
                  : {}),
              }
            : c,
        );
      });
      if (e.kind === "created" && m.senderType === "customer") {
        setDetached((d) =>
          d && d.id === e.conversationId
            ? { ...d, serviceWindow: { expired: false, hoursRemaining: 24, lastCustomerMessageAt: m.createdAt } }
            : d,
        );
      }
    },
    [],
  );

  const onConversation = useCallback(
    (e: ConversationEvent) => {
      const { patch } = e;
      const isActive = activeRef.current?.id === e.conversationId;
      const visible = document.visibilityState === "visible";
      const f = filterRef.current;
      const known = listRef.current.some((c) => c.id === e.conversationId);
      setConversations((prev) => {
        const row = prev.find((c) => c.id === e.conversationId);
        if (!row) return prev;
        const next: InboxConversation = {
          ...row,
          status: patch.status,
          assignedAgentId: patch.assignedAgentId,
          lastMessageText: patch.lastMessageText,
          lastMessageAt: patch.lastMessageAt,
          unreadCount: isActive && visible ? 0 : patch.unreadCount,
        };
        // A chat that stops matching the view drops out — but never the one open.
        if (!isActive && !matchesFilter(next, f.filter, f.meId, f.search)) return prev.filter((c) => c.id !== row.id);
        return sortConversations(prev.map((c) => (c.id === row.id ? next : c)));
      });
      setDetached((d) =>
        d && d.id === e.conversationId
          ? {
              ...d,
              status: patch.status,
              assignedAgentId: patch.assignedAgentId,
              lastMessageText: patch.lastMessageText,
              lastMessageAt: patch.lastMessageAt,
              unreadCount: isActive && visible ? 0 : patch.unreadCount,
            }
          : d,
      );
      if (!known && activeRef.current?.id !== e.conversationId) void fetchRow(e.conversationId);
      if (isActive && visible && patch.unreadCount > 0) {
        void fetch(`/api/conversations/${e.conversationId}/read`, { method: "POST" }).catch(() => {});
      }
      scheduleCounts();
    },
    [fetchRow, scheduleCounts],
  );

  const { connected } = useInboxSocket({
    onMessage,
    onConversation,
    onReaction: (e) =>
      setThreads((prev) => {
        const t = prev[e.conversationId];
        if (!t) return prev;
        return { ...prev, [e.conversationId]: { ...t, items: t.items.map((m) => (m.id === e.messageId ? { ...m, reactions: e.reactions } : m)) } };
      }),
    onContact: (e) => {
      const a = activeRef.current;
      if (a && a.contact.id === e.contactId) void loadContext(a.id);
      listRef.current.filter((c) => c.contact.id === e.contactId).forEach((c) => void fetchRow(c.id));
    },
    onResync: () => {
      void loadList(1);
      void loadCounts();
      const a = activeRef.current;
      if (a) void loadMessages(a.id, { silent: true });
    },
  });

  // Catch up when the tab comes back to the foreground.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void loadCounts();
      const a = activeRef.current;
      if (a) {
        void loadMessages(a.id, { silent: true });
        if (a.unreadCount > 0) markRead(a.id);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadCounts, loadMessages, markRead]);

  // ── actions ─────────────────────────────────────────────────────

  const selectConversation = useCallback(
    (c: InboxConversation | null) => {
      setActiveId(c?.id ?? null);
      if (!c) setInfoOpen(false);
      router.replace(c ? `/inbox?c=${c.id}` : "/inbox", { scroll: false });
    },
    [router],
  );

  const addOptimistic = (convId: string, msg: Partial<InboxMessage>): string => {
    const id = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const temp: InboxMessage = {
      id,
      conversationId: convId,
      senderType: "agent",
      senderId: meId,
      contentType: "text",
      contentText: null,
      mediaUrl: null,
      templateName: null,
      whatsappMessageId: null,
      status: "sending",
      interactiveReplyId: null,
      replyToMessageId: null,
      replyTo: null,
      createdAt: new Date().toISOString(),
      reactions: [],
      pending: true,
      ...msg,
    };
    setThread(convId, (t) => ({ ...t, items: [...t.items, temp] }));
    patchConversation(convId, {
      lastMessageText: previewFor(temp),
      lastMessageAt: temp.createdAt,
      lastMessage: { senderType: "agent", status: "sending", contentType: temp.contentType },
    });
    return id;
  };

  /** Swaps an optimistic bubble for the stored message (or marks it failed). */
  const settle = (convId: string, tempId: string, stored: InboxMessage | null, extra?: Partial<InboxMessage>) => {
    if (stored) tempToReal.current.set(tempId, stored.id);
    setThread(convId, (t) => {
      if (!stored) return { ...t, items: t.items.map((m) => (m.id === tempId ? { ...m, status: "failed", pending: false } : m)) };
      // The realtime event may already have swapped it in.
      if (t.items.some((m) => m.id === stored.id)) return { ...t, items: t.items.filter((m) => m.id !== tempId) };
      return { ...t, items: t.items.map((m) => (m.id === tempId ? { ...stored, ...extra, pending: false } : m)) };
    });
    patchConversation(convId, {
      lastMessage: { senderType: "agent", status: stored ? stored.status : "failed", contentType: stored?.contentType ?? "text" },
    });
  };

  /** Shared error reporting for every outbound send. */
  const reportSendError = (err: unknown, what: string) => {
    const message = err instanceof Error ? err.message : "network error";
    if (err instanceof ApiError && err.status === 409 && /24-hour/i.test(message)) {
      toast.error("The 24-hour window has closed — send an approved template instead.", {
        action: { label: "Templates", onClick: () => setTemplatesOpen(true) },
      });
      return;
    }
    toast.error(`${what} not sent: ${message}`);
  };

  /** POST /api/conversations/:id/messages — the tenant-scoped send path. */
  const postMessage = (convId: string, body: Record<string, unknown>) =>
    api<InboxMessage>(`/api/conversations/${convId}/messages`, { method: "POST", json: body }).then((r) => r.data);

  const quoteFor = (convId: string, replyToId: string | null) => {
    if (!replyToId) return null;
    const parent = threads[convId]?.items.find((m) => m.id === replyToId);
    return parent ? { id: parent.id, senderType: parent.senderType, contentType: parent.contentType, preview: previewFor(parent) } : null;
  };

  const sendText = async (convId: string, text: string, replyToId: string | null, reuseTempId?: string) => {
    let tempId = reuseTempId;
    if (tempId) {
      const id = tempId;
      setThread(convId, (t) => ({ ...t, items: t.items.map((m) => (m.id === id ? { ...m, status: "sending", pending: true } : m)) }));
    } else {
      tempId = addOptimistic(convId, { contentText: text, replyToMessageId: replyToId, replyTo: quoteFor(convId, replyToId) });
    }
    try {
      const stored = await postMessage(convId, {
        contentType: "text",
        text,
        ...(replyToId && !replyToId.startsWith("temp-") ? { replyToMessageId: replyToId } : {}),
      });
      settle(convId, tempId, stored);
    } catch (err) {
      reportSendError(err, "Message");
      settle(convId, tempId, null);
    }
  };

  const sendFile = async (convId: string, file: File, caption: string, replyToId: string | null) => {
    const localUrl = file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : null;
    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "document";
    const tempId = addOptimistic(convId, {
      contentType: kind,
      contentText: caption || null,
      mediaUrl: localUrl,
      filename: file.name,
      replyToMessageId: replyToId,
      replyTo: quoteFor(convId, replyToId),
    });
    try {
      const form = new FormData();
      form.append("file", file);
      const { data: up } = await api<{ url: string; kind: "image" | "video" | "audio" | "document"; filename: string }>(
        "/api/inbox/media/upload",
        { method: "POST", body: form },
      );
      const sent = await postMessage(convId, {
        contentType: up.kind,
        mediaUrl: up.url,
        ...(caption && up.kind !== "audio" ? { caption } : {}),
        ...(up.kind === "document" ? { filename: up.filename } : {}),
        ...(replyToId && !replyToId.startsWith("temp-") ? { replyToMessageId: replyToId } : {}),
      });
      settle(convId, tempId, sent, { filename: file.name });
    } catch (err) {
      reportSendError(err, "Attachment");
      settle(convId, tempId, null);
    }
  };

  const sendTemplate = async (template: MessageTemplate, params: string[]) => {
    const a = activeRef.current;
    if (!a) return;
    const body = renderTemplateBody(template.body_text, params);
    const tempId = addOptimistic(a.id, { contentType: "template", contentText: body, templateName: template.name });
    try {
      const stored = await postMessage(a.id, {
        contentType: "template",
        templateName: template.name,
        ...(template.language ? { templateLanguage: template.language } : {}),
        templateParams: params,
        renderedText: body,
      });
      settle(a.id, tempId, stored);
    } catch (err) {
      reportSendError(err, "Template");
      settle(a.id, tempId, null);
    }
  };

  const react = async (m: InboxMessage, emoji: string) => {
    if (m.pending || m.id.startsWith("temp-")) return toast.error("Wait for the message to finish sending");
    const convId = m.conversationId;
    const before = m.reactions;
    const mine = before.filter((r) => !(r.actorType === "agent" && r.actorId === meId));
    const next = emoji
      ? [...mine, { id: `temp-${Date.now()}`, actorType: "agent" as const, actorId: meId, emoji, createdAt: new Date().toISOString() }]
      : mine;
    setThread(convId, (t) => ({ ...t, items: t.items.map((x) => (x.id === m.id ? { ...x, reactions: next } : x)) }));
    try {
      await api(`/api/conversations/${convId}/messages/${m.id}/reaction`, { method: "PUT", json: { emoji } });
    } catch (err) {
      toast.error(`Reaction failed: ${err instanceof Error ? err.message : "network error"}`);
      setThread(convId, (t) => ({ ...t, items: t.items.map((x) => (x.id === m.id ? { ...x, reactions: before } : x)) }));
    }
  };

  const updateConversation = async (c: InboxConversation, body: { status?: InboxConversation["status"]; assignedAgentId?: string | null }) => {
    const previous = { status: c.status, assignedAgentId: c.assignedAgentId };
    patchConversation(c.id, body);
    try {
      await api(`/api/conversations/${c.id}`, { method: "PATCH", json: body });
      if (body.status) {
        toast.success(
          body.status === "closed" ? "Chat resolved" : body.status === "pending" ? "Handed back to the AI assistant" : "You're handling this chat",
        );
      } else if ("assignedAgentId" in body) {
        const who = agents.find((a) => a.id === body.assignedAgentId);
        toast.success(body.assignedAgentId ? `Assigned to ${who?.isMe ? "you" : (who?.name ?? "agent")}` : "Unassigned");
      }
      scheduleCounts();
      void loadContext(c.id);
    } catch (err) {
      patchConversation(c.id, previous);
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const setPrefs = async (c: InboxConversation, prefs: { pinned?: boolean; starred?: boolean }) => {
    const previous = { pinned: c.pinned, starred: c.starred };
    patchConversation(c.id, prefs);
    try {
      const { data } = await api<{ pinned: boolean; starred: boolean }>(`/api/inbox/conversations/${c.id}/prefs`, { method: "PATCH", json: prefs });
      patchConversation(c.id, data);
      if (prefs.starred === false && filter === "starred" && activeRef.current?.id !== c.id) {
        setConversations((prev) => prev.filter((x) => x.id !== c.id));
      }
      scheduleCounts();
    } catch (err) {
      patchConversation(c.id, previous);
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const addNote = async (contactId: string, text: string) => {
    await api(`/api/inbox/contacts/${contactId}/notes`, { method: "POST", json: { text } });
    const a = activeRef.current;
    if (a) await loadContext(a.id);
  };

  // ── keyboard shortcuts ──────────────────────────────────────────

  const visibleList = conversations;
  const keyState = useRef({ visibleList, active, filter, infoOpen });
  useEffect(() => {
    keyState.current = { visibleList, active, filter, infoOpen };
  });
  const actionsRef = useRef({ updateConversation, setPrefs, selectConversation, meId });
  useEffect(() => {
    actionsRef.current = { updateConversation, setPrefs, selectConversation, meId };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { visibleList: list, active: a, infoOpen: open } = keyState.current;
      const act = actionsRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === "?" && !isTyping(e.target)) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (e.key === "Escape" && !isTyping(e.target)) {
        if (open) setInfoOpen(false);
        else if (a && window.innerWidth < 1024) act.selectConversation(null);
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const code = e.code;
      const move = (dir: 1 | -1) => {
        if (!list.length) return;
        const idx = a ? list.findIndex((c) => c.id === a.id) : -1;
        const next = list[Math.min(list.length - 1, Math.max(0, idx + dir))] ?? list[0];
        act.selectConversation(next);
        requestAnimationFrame(() => document.querySelector(`[data-conv-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" }));
      };
      const handled = (() => {
        if (code === "ArrowDown") return move(1), true;
        if (code === "ArrowUp") return move(-1), true;
        if (code === "KeyN") {
          const next = list.find((c) => c.unreadCount > 0 && c.id !== a?.id);
          if (next) act.selectConversation(next);
          return true;
        }
        if (/^Digit[1-7]$/.test(code)) {
          setFilter(INBOX_FILTERS[Number(code.slice(5)) - 1].value);
          return true;
        }
        if (code === "KeyQ") return setQrOpen(true), true;
        if (!a) return false;
        if (code === "KeyR") return void act.updateConversation(a, { status: a.status === "closed" ? "open" : "closed" }), true;
        if (code === "KeyA" && act.meId) return void act.updateConversation(a, { assignedAgentId: act.meId }), true;
        if (code === "KeyH") return void act.updateConversation(a, { status: a.status === "open" ? "pending" : "open" }), true;
        if (code === "KeyS") return void act.setPrefs(a, { starred: !a.starred }), true;
        if (code === "KeyP") return void act.setPrefs(a, { pinned: !a.pinned }), true;
        if (code === "KeyI") return setInfoOpen((v) => !v), true;
        if (code === "KeyT") return setTemplatesOpen(true), true;
        return false;
      })();
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── render ──────────────────────────────────────────────────────

  const thread = activeId ? threads[activeId] : undefined;
  const meAgent = agents.find((a) => a.isMe);
  const me = meId
    ? {
        id: meId,
        name: meAgent?.name ?? (profile as { full_name?: string | null } | null)?.full_name ?? user?.email ?? "Me",
        avatarUrl: meAgent?.avatarUrl ?? (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null,
      }
    : null;

  return (
    <div className="wa-inbox -m-4 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden bg-[var(--wa-panel-header)] sm:-m-6">
      {waConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-[12px] text-amber-600 dark:text-amber-400">
          <WifiOff className="h-4 w-4" /> WhatsApp is not connected — messages can&apos;t be delivered. Connect it in Settings.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* Chat list */}
        <div className={cn("h-full w-full shrink-0 lg:w-[30%] lg:min-w-[340px] lg:max-w-[440px]", active ? "hidden lg:block" : "block")}>
          <ChatList
            ref={searchRef}
            conversations={conversations}
            loading={loadingList}
            hasMore={hasMore}
            onLoadMore={() => void loadList(page + 1)}
            activeId={activeId}
            onSelect={(c) => selectConversation(c)}
            filter={filter}
            onFilter={setFilter}
            counts={counts}
            search={search}
            onSearch={setSearch}
            agents={agents}
            connected={connected}
            me={me}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenQuickReplies={() => setQrOpen(true)}
          />
        </div>

        {/* Conversation */}
        <main className={cn("min-w-0 flex-1", active ? "flex" : "hidden lg:flex")}>
          {active ? (
            <>
              <div className={cn("min-w-0 flex-1", infoOpen ? "hidden xl:flex" : "flex")}>
                <ChatPane
                  ref={paneRef}
                  conversation={active}
                  messages={thread?.items ?? []}
                  loading={thread?.loading ?? true}
                  hasOlder={thread?.hasOlder ?? false}
                  loadingOlder={thread?.loadingOlder ?? false}
                  onLoadOlder={() => void loadMessages(active.id, { older: true })}
                  agents={agents}
                  meId={meId}
                  infoOpen={infoOpen}
                  onToggleInfo={() => setInfoOpen((v) => !v)}
                  onBack={() => selectConversation(null)}
                  onAssign={(id) => void updateConversation(active, { assignedAgentId: id })}
                  onStatus={(status) => void updateConversation(active, { status })}
                  onPrefs={(p) => void setPrefs(active, p)}
                  onSendText={(text, replyToId) => void sendText(active.id, text, replyToId)}
                  onSendFile={(file, caption, replyToId) => sendFile(active.id, file, caption, replyToId)}
                  onSendNote={async (text) => {
                    try {
                      await addNote(active.contact.id, text);
                      toast.success("Internal note saved", { action: { label: "View", onClick: () => setInfoOpen(true) } });
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not save the note");
                      throw err;
                    }
                  }}
                  onRetry={(m) => {
                    if (m.contentType === "text" && m.contentText) void sendText(m.conversationId, m.contentText, m.replyToMessageId, m.id);
                    else toast.error("Re-attach the file to send it again");
                  }}
                  onReact={(m, emoji) => void react(m, emoji)}
                  onOpenTemplates={() => setTemplatesOpen(true)}
                  quickReplies={quickReplies}
                  onManageQuickReplies={() => setQrOpen(true)}
                  onSimulate={async (text) => {
                    try {
                      await api("/api/whatsapp/simulate-incoming", { method: "POST", json: { conversationId: active.id, messageText: text } });
                    } catch (err) {
                      toast.error(`Simulation failed: ${err instanceof Error ? err.message : "error"}`);
                      throw err;
                    }
                  }}
                />
              </div>
              {infoOpen && (
                <div className="h-full w-full shrink-0 border-l border-[var(--wa-border)] xl:w-[30%] xl:min-w-[340px] xl:max-w-[420px]">
                  <ContactDrawer
                    conversation={active}
                    context={context}
                    agents={agents}
                    meId={meId}
                    onClose={() => setInfoOpen(false)}
                    onAssign={(id) => void updateConversation(active, { assignedAgentId: id })}
                    onStatus={(status) => void updateConversation(active, { status })}
                    onAddTag={async (input) => {
                      try {
                        await api(`/api/inbox/contacts/${active.contact.id}/tags`, { method: "POST", json: input });
                        await loadContext(active.id);
                        void fetchRow(active.id);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not add label");
                      }
                    }}
                    onRemoveTag={async (tagId) => {
                      try {
                        await api(`/api/inbox/contacts/${active.contact.id}/tags?tagId=${tagId}`, { method: "DELETE" });
                        await loadContext(active.id);
                        void fetchRow(active.id);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not remove label");
                      }
                    }}
                    onAddNote={(text) => addNote(active.contact.id, text)}
                    onDeleteNote={async (noteId) => {
                      try {
                        await api(`/api/inbox/contacts/${active.contact.id}/notes?noteId=${noteId}`, { method: "DELETE" });
                        await loadContext(active.id);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not delete note");
                      }
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="relative flex flex-1 flex-col items-center justify-center border-l border-[var(--wa-border)] bg-[var(--wa-panel-header)] px-8 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--wa-chip-active)]">
                <MessagesSquare className="h-10 w-10 text-[var(--wa-accent-strong)]" />
              </div>
              <h2 className="mt-6 text-lg font-semibold text-[var(--wa-text)]">ChatNexGen Inbox</h2>
              <p className="mt-3 max-w-md text-[12.5px] leading-5 text-[var(--wa-text-2)]">
                Reply to customers, hand chats between the AI assistant and your team, and resolve conversations — all in real time.
              </p>
              <p className="mt-2 text-[12px] text-[var(--wa-text-2)]">
                Press <kbd className="font-mono">?</kbd> for keyboard shortcuts.
              </p>
              <p className="absolute bottom-8 flex items-center gap-1.5 text-[12px] text-[var(--wa-text-2)]">
                <Lock className="h-3.5 w-3.5" /> Delivered through the official WhatsApp Business Platform
              </p>
              {active === null && activeId && (
                <p className="mt-4 text-[12px] text-[var(--wa-text-2)]">Opening chat…</p>
              )}
            </div>
          )}
        </main>
      </div>

      <TemplatePicker open={templatesOpen} onOpenChange={setTemplatesOpen} onSelect={(t, p) => void sendTemplate(t, p)} />
      <QuickRepliesDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        replies={quickReplies}
        onChanged={setQuickReplies}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <span className="sr-only" aria-live="polite">
        {active ? `Chat with ${displayName(active.contact)}` : ""}
      </span>
    </div>
  );
}
