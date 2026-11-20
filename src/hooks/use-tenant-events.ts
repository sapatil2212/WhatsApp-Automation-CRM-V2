'use client';

import { useEffect, useRef } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { getSocket } from '@/lib/socket';

export interface TenantNotificationEvent {
  type: 'booking' | 'message' | 'lead' | 'campaign' | 'template' | 'system';
  title: string;
  body?: string;
  href?: string;
  at: string;
}

/** Subscribes to the tenant's realtime "notification" events. */
export function useTenantEvents(handler: (event: TenantNotificationEvent) => void, enabled = true) {
  const { profile } = useAuth();
  const tenantId = (profile as { tenant_id?: string; tenantId?: string } | null)?.tenant_id ?? (profile as { tenantId?: string } | null)?.tenantId;
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });

  useEffect(() => {
    if (!enabled || !tenantId) return;
    const socket = getSocket();
    const join = () => socket.emit('join-tenant', tenantId);
    const onEvent = (e: TenantNotificationEvent) => ref.current(e);
    if (!socket.connected) socket.connect();
    else join();
    socket.on('connect', join);
    socket.on('notification', onEvent);
    return () => {
      socket.off('connect', join);
      socket.off('notification', onEvent);
    };
  }, [tenantId, enabled]);
}
