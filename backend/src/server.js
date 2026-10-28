import dotenv from 'dotenv';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app.js';
import { socketHandler } from './utils/socket.js';

dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });

// Keep the API separate from the server-rendered app, which uses PORT (3000).
const PORT = process.env.API_PORT || 4000;
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

socketHandler(io);

server.listen(PORT, () => {
  console.log(`🚀 DormMap backend running on http://localhost:${PORT}`);
});
