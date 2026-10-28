export const socketHandler = (io) => {
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('joinRoom', ({ room }) => {
      if (room) socket.join(room);
    });

    socket.on('leaveRoom', ({ room }) => {
      if (room) socket.leave(room);
    });

    socket.on('sendMessage', (message) => {
      if (message?.room) {
        io.to(message.room).emit('receiveMessage', message);
      }
    });

    socket.on('notification', (notification) => {
      if (notification?.userId) {
        io.to(`user_${notification.userId}`).emit('notification', notification);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
};
