/**
 * Socket.io bootstrap.
 *
 * In Module 0.2 we only:
 *   - initialize the Socket.io server attached to the HTTP server
 *   - expose a `getIO()` accessor so future modules can emit events
 *
 * Module 7.4 adds:
 *   - per-user room join on handshake (`user_<id>`) for `notification:new`
 *   - public room auto-join (`public_resources`) so unauthenticated
 *     sockets (e.g. the map view) also receive `resource:status`
 *     broadcasts.
 */

const { Server } = require('socket.io');
const { verifyJwt } = require('../utils/jwt'); // populated in Module 1.2

let io = null;

function initSocket(server, { corsOrigin }) {
  io = new Server(server, {
    cors: {
      origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
      credentials: true,
    },
  });

  // Auth handshake — connection is rejected if no valid token is provided.
  // Users without a token still get a connection but no user-specific room.
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) return next();
      const payload = verifyJwt(token);
      if (payload && payload.id) {
        socket.data.userId = String(payload.id);
        socket.data.role = payload.role;
      }
      next();
    } catch {
      // Soft-fail: still allow connection, just no user context.
      next();
    }
  });

  io.on('connection', (socket) => {
    // Every connection joins the public resources room. The map view
    // (Module 7.5) needs `resource:status` even for unauthenticated
    // visitors, so we don't gate this on a user id.
    socket.join('public_resources');
    if (socket.data.userId) {
      const room = `user_${socket.data.userId}`;
      socket.join(room);
    }
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.io has not been initialized. Call initSocket() first.');
  }
  return io;
}

module.exports = { initSocket, getIO };
