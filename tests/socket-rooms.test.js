import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { User } from '../models/userModel.js';
import { initWebSocket } from '../services/websocketService.js';

function packet(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener('message', event => resolve(String(event.data)), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}

test('a signed-in tenant cannot subscribe to another user or admin notifications', { timeout: 5000 }, async t => {
  t.mock.method(User, 'findByPk', async id => ({ id, accountType: 'tenant', isSuspended: false, isArchived: false }));
  const server = http.createServer();
  const io = initWebSocket(server, (req, res, next) => { req.session = { userId: 42 }; next(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`);
  try {
    assert.ok((await packet(client)).startsWith('0'));
    client.send('40');
    assert.ok((await packet(client)).startsWith('40'));
    client.send('42["join_user",99]');
    client.send('42["join_role","super_admin"]');
    client.send('42["join_user",42]');
    client.send('42["join_role","tenant"]');
    client.send('42["ping_server"]');
    assert.match(await packet(client), /pong_server/);
    const socket = [...io.sockets.sockets.values()][0];
    assert.equal(socket.rooms.has('user_99'), false);
    assert.equal(socket.rooms.has('role_super_admin'), false);
    assert.equal(socket.rooms.has('user_42'), true);
    assert.equal(socket.rooms.has('role_tenant'), true);
  } finally {
    client.close();
    await new Promise(resolve => io.close(resolve));
  }
});
