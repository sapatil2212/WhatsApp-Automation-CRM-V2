import { Server as SocketIOServer } from 'socket.io'

type GlobalWithIO = typeof globalThis & {
  io?: SocketIOServer
}

/**
 * Trigger a realtime event to a specific tenant room.
 * Safely checks if the Socket.io server is initialized (e.g. in dev server environment).
 */
export function triggerRealtimeEvent(tenantId: string, event: string, data: any) {
  const g = global as unknown as GlobalWithIO
  if (g.io) {
    g.io.to(tenantId).emit(event, data)
    console.log(`[Realtime] Emitted event "${event}" to tenant room "${tenantId}"`)
  } else {
    console.warn(`[Realtime] Socket.io server not initialized. Event "${event}" dropped.`)
  }
}
