// SSE carries invalidation signals only. Authenticated REST endpoints supply scoped data.
const clients = new Map();
export function pushUserUpdate(userId, data = {}) {
  for (const res of clients.get(String(userId)) || []) res.write(`event: portal-update\ndata: ${JSON.stringify(data)}\n\n`);
}
export function openUserStream(req, res) {
  const key = String(req.session.userId);
  res.status(200).set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache, no-transform', Connection:'keep-alive', 'X-Accel-Buffering':'no' });
  res.flushHeaders();
  if (!clients.has(key)) clients.set(key,new Set());
  const set = clients.get(key); set.add(res);
  res.write('retry: 5000\nevent: portal-update\ndata: {"connected":true}\n\n');
  const heartbeat = setInterval(()=>res.write(': heartbeat\n\n'),25000);
  const expiry = setTimeout(()=>res.end(),5*60*1000); // reconnect revalidates session and account
  res.on('close',()=>{clearInterval(heartbeat);clearTimeout(expiry);set.delete(res);if(!set.size)clients.delete(key);});
}
