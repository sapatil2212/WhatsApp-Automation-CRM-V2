"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getSocket } from "@/lib/socket";
import type { Message, Conversation } from "@/types";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string; // Left for API compatibility
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
}

export function useRealtime({
  onMessageEvent,
  onConversationEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const { profile } = useAuth();
  const tenantId = (profile as any)?.tenant_id || (profile as any)?.tenantId; // Handle both snake_case and camelCase profile shapes

  // Store callbacks in refs to avoid re-subscribing when closures change
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);

  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  useEffect(() => {
    if (!enabled || !tenantId) return;

    const socket = getSocket();

    // 1. Establish connection if not already connected
    if (!socket.connected) {
      socket.connect();
    }

    const handleConnect = () => {
      setIsConnected(true);
      // Join isolated room for this tenant
      socket.emit("join-tenant", tenantId);
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    // If already connected, join room directly
    if (socket.connected) {
      handleConnect();
    }

    // 2. Set up event listeners
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    const handleMessage = (event: RealtimeEvent<Message>) => {
      onMessageRef.current?.(event);
    };

    const handleConversation = (event: RealtimeEvent<Conversation>) => {
      onConversationRef.current?.(event);
    };

    socket.on("message", handleMessage);
    socket.on("conversation", handleConversation);

    // 3. Cleanup on unmount
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("message", handleMessage);
      socket.off("conversation", handleConversation);
    };
  }, [tenantId, enabled]);

  const unsubscribe = () => {
    // Left as no-op to maintain API compatibility without breaking inbox components
  };

  return { isConnected, unsubscribe };
}
