"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getSocket } from "@/lib/socket";

export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  const { profile } = useAuth();
  const tenantId = (profile as any)?.tenant_id || (profile as any)?.tenantId;

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/unread-count")
      if (res.ok) {
        const data = await res.json()
        setTotal(data.count ?? 0)
      }
    } catch (err) {
      console.error("[useTotalUnread] Error fetching unread count:", err)
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!tenantId) return;

    // Initial load
    fetchUnreadCount();

    // Set up Socket.io listener
    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
    }

    const handleConversationUpdate = () => {
      if (!cancelled) {
        fetchUnreadCount();
      }
    };

    socket.on("conversation", handleConversationUpdate);

    return () => {
      cancelled = true;
      socket.off("conversation", handleConversationUpdate);
    };
  }, [tenantId, fetchUnreadCount]);

  return total;
}
