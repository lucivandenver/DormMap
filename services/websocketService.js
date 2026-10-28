import { Server } from 'socket.io';

let io = null;

/**
 * Initialize Socket.io with HTTP Server and configure real-time channels
 */
export function initWebSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    // Client joins user-specific room
    socket.on('join_user', (userId) => {
      if (userId) {
        socket.join(`user_${userId}`);
      }
    });

    // Client joins role-specific room (e.g., 'super_admin', 'barangay', 'boarding_house_owner', 'tenant')
    socket.on('join_role', (role) => {
      if (role) {
        socket.join(`role_${role}`);
      }
    });

    // Client joins boarding house channel for live inquiries/room slot updates
    socket.on('join_house', (houseId) => {
      if (houseId) {
        socket.join(`house_${houseId}`);
      }
    });

    // Live chat typing / messaging relay between tenant and owner
    socket.on('chat_message', (payload) => {
      if (payload && payload.recipientId) {
        io.to(`user_${payload.recipientId}`).emit('new_chat_message', {
          ...payload,
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('typing', (payload) => {
      if (payload && payload.recipientId) {
        io.to(`user_${payload.recipientId}`).emit('user_typing', payload);
      }
    });

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
