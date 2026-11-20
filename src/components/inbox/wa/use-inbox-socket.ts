"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { getSocket } from "@/lib/socket";

import type { ConversationStatus, InboxMessage, Reaction } from "./types";

export interface MessageEvent {
  kind: "created" | "updated";
  conversationId: string;
  message: InboxMessage;
}

export interface ConversationEvent {
  kind: "created" | "updated";
  conversationId: string;
  patch: {
    id: string;
    contactId: string;
    status: ConversationStatus;
    assignedAgentId: string | null;
    lastMessageText: string | null;
    lastMessageAt: string | null;
    unreadCount: number;
    updatedAt: string;
  };
}

export interface ReactionEvent {
  conversationId: string;
  messageId: string;
  reactions: Reaction[];
}

interface Handlers {
  onMessage?: (e: MessageEvent) => void;
  onConversation?: (e: ConversationEvent) => void;
  onReaction?: (e: ReactionEvent) => void;
  onContact?: (e: { contactId: string }) => void;
  /** Fired after a reconnect, so callers can refetch what they missed. */
  onResync?: () => void;
}

/**
 * Subscribes to the tenant room's `inbox:*` events (emitted by
 * `src/server/realtime/inbox-events.ts`). Handlers are read through a ref so
 * callers can pass inline closures without re-subscribing.
 */
export function useInboxSocket(handlers: Handlers) {
  const { profile } = useAuth();
  const tenantId = (profile as { tenant_id?: string | null } | null)?.tenant_id ?? null;
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const socket = getSocket();
    let hadConnection = false;

    const join = () => {
      socket.emit("join-tenant", tenantId);
      setConnected(true);
      if (hadConnection) ref.current.onResync?.();
      hadConnection = true;
    };
    const drop = () => setConnected(false);
    const onMessage = (e: MessageEvent) => ref.current.onMessage?.(e);
    const onConversation = (e: ConversationEvent) => ref.current.onConversation?.(e);
    const onReaction = (e: ReactionEvent) => ref.current.onReaction?.(e);
    const onContact = (e: { contactId: string }) => ref.current.onContact?.(e);

    socket.on("connect", join);
    socket.on("disconnect", drop);
    socket.on("inbox:message", onMessage);
    socket.on("inbox:conversation", onConversation);
    socket.on("inbox:reaction", onReaction);
    socket.on("inbox:contact", onContact);

    if (socket.connected) join();
    else socket.connect();

    return () => {
      socket.off("connect", join);
      socket.off("disconnect", drop);
      socket.off("inbox:message", onMessage);
      socket.off("inbox:conversation", onConversation);
      socket.off("inbox:reaction", onReaction);
      socket.off("inbox:contact", onContact);
    };
  }, [tenantId]);

  return { connected };
}
