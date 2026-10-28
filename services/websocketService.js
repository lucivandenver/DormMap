import { Server } from 'socket.io';
import { User } from '../models/userModel.js';

let io = null;

/**
 * Initialize Socket.io with HTTP Server and configure real-time channels
 */
export function initWebSocket(httpServer, sessionMiddleware) {
  io = new Server(httpServer, {
    transports: ['websocket', 'polling']
  });
  io.engine.use(sessionMiddleware);
  io.use(async (socket, next) => {
    try {
      const userId = socket.request.session?.userId;
      if (userId) {
        const user = await User.findByPk(userId);
        if (!user || user.isSuspended || user.isArchived) return next(new Error('Account unavailable.'));
        socket.data.userId = user.id;
        socket.data.role = user.accountType === 'bplo_admin' ? 'super_admin' : user.accountType;
      }
      next();
    } catch (error) { next(error); }
  });

  io.on('connection', (socket) => {
    // Room identity comes from the signed session, never a client-supplied ID.
    socket.on('join_user', (userId) => {
      if (socket.data.userId && String(userId) === String(socket.data.userId)) {
        socket.join(`user_${socket.data.userId}`);
      }
    });

    // Client joins role-specific room (e.g., 'super_admin', 'barangay', 'boarding_house_owner', 'tenant')
    socket.on('join_role', (role) => {
      if (socket.data.role && role === socket.data.role) {
        socket.join(`role_${socket.data.role}`);
      }
    });

    // Client joins boarding house channel for live inquiries/room slot updates
    socket.on('join_house', (houseId) => {
      if (/^[1-9]\d*$/.test(String(houseId))) {
        socket.join(`house_${houseId}`);
      }
    });

    // Messages are persisted and broadcast by the authenticated HTTP controllers.
    // No arbitrary client-to-user event relay is exposed here.

    // Client ping/pong for liveness check
    socket.on('ping_server', () => {
      socket.emit('pong_server', { time: Date.now() });
    });
  });

  console.log('⚡ WebSocket (Socket.io) initialized successfully.');
  return io;
}

export function getIo() {
  return io;
}

/**
 * Emit event to a specific user
 */
export function emitToUser(userId, event, data) {
  if (io && userId) {
    io.to(`user_${userId}`).emit(event, data);
  }
}

/**
 * Emit event to a role group
 */
export function emitToRole(role, event, data) {
  if (io && role) {
    io.to(`role_${role}`).emit(event, data);
  }
}

/**
 * Emit event to people viewing or managing a specific boarding house
 */
export function emitToHouse(houseId, event, data) {
  if (io && houseId) {
    io.to(`house_${houseId}`).emit(event, data);
  }
}

/**
 * Broadcast event to all connected clients
 */
export function broadcastEvent(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

export default {
  initWebSocket,
  getIo,
  emitToUser,
  emitToRole,
  emitToHouse,
  broadcastEvent
};
