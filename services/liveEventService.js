// Streams carry invalidation signals. Authenticated REST endpoints supply scoped data.
const userClients = new Map();
const publicClients = new Set();

function send(response, frame) {
  if (response.writableEnded || response.destroyed) return;
  // Reconnect slow readers so buffered event frames cannot grow indefinitely.
  if (!response.write(frame)) response.end();
}

function event(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function pushUserUpdate(userId, data = {}) {
  const subscribers = userClients.get(String(userId));
  if (!subscribers?.size) return;
  const frame = event('portal-update', data);
  for (const response of subscribers) send(response, frame);
}

export function pushPublicUpdate(data = {}) {
  if (!publicClients.size) return;
  const frame = event('landing-update', data);
  for (const response of publicClients) send(response, frame);
}

function subscribe(response, clients, name, onClose = () => {}) {
  response.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  response.flushHeaders();
  clients.add(response);
  // Reconnect periodically to check that the account and session are still authorized.
  const expiry = setTimeout(() => response.end(), 5 * 60 * 1000);
  expiry.unref();
  response.on('close', () => {
    clearTimeout(expiry);
    clients.delete(response);
    onClose();
  });
  send(response, 'retry: 4000\n' + event(name, { connected: true }));
}

const heartbeat = setInterval(() => {
  for (const response of publicClients) send(response, ': heartbeat\n\n');
  for (const subscribers of userClients.values()) {
    for (const response of subscribers) send(response, ': heartbeat\n\n');
  }
}, 25000);
heartbeat.unref();

export function openUserStream(req, res) {
  const key = String(req.session.userId);
  if (!userClients.has(key)) userClients.set(key, new Set());
  const clients = userClients.get(key);
  subscribe(res, clients, 'portal-update', () => { if (!clients.size) userClients.delete(key); });
}

export function openPublicStream(req, res) {
  subscribe(res, publicClients, 'landing-update');
}
