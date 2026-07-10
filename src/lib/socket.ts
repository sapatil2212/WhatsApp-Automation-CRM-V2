import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

/**
 * Returns a shared Socket.io-client instance.
 * Automatically connects to the current window's protocol, host, and port.
 */
export function getSocket(): Socket {
  if (typeof window === 'undefined') {
    // Return mock socket for SSR environments to prevent compilation/runtime crashes
    return {
      on: () => {},
      off: () => {},
      emit: () => {},
      connect: () => {},
      disconnect: () => {},
      connected: false
    } as any
  }

  if (!socket) {
    socket = io({
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    })
  }
  return socket
}
