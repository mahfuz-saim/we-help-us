/**
 * Socket.io client singleton.
 *
 * The actual auth handshake + reconnection logic is finalized in Module 7.4
 * (Socket.io Real-Time). For the skeleton we just lazy-construct the
 * client with sane defaults and expose a `disconnect()` helper.
 */

import { io } from 'socket.io-client';
import { TOKEN_STORAGE_KEY } from '../utils/constants';

let socket = null;

export function getSocket() {
  if (socket) return socket;

  const baseURL =
    import.meta.env.VITE_SOCKET_URL ||
    import.meta.env.VITE_API_URL ||
    window.location.origin;

  socket = io(baseURL, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    auth: (cb) => {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY);
      cb({ token: token || undefined });
    },
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export default { getSocket, disconnectSocket };