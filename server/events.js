// Live updates: every signed-in window holds one Server-Sent Events stream, and
// every change anyone makes is pushed down all of them. A window that drops the
// stream re-fetches everything when it reconnects, so a missed event costs nothing.
const clients = new Set();

export function subscribe(req, res, user, version) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = { res, userId: user.id };
  clients.add(client);
  res.write(`data: ${JSON.stringify({ type: 'hello', version })}\n\n`);
  const drop = () => clients.delete(client);
  req.on('close', drop);
  res.on('error', drop);
}

export function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    try { c.res.write(line); } catch { clients.delete(c); }
  }
}

// a member who was removed loses their open windows too
export function disconnectUser(userId) {
  for (const c of clients) if (c.userId === userId) { try { c.res.end(); } catch {} clients.delete(c); }
}

export const clientCount = () => clients.size;

// proxies close quiet connections; a comment line every 25 s keeps them open
setInterval(() => {
  for (const c of clients) {
    try { c.res.write(': ping\n\n'); } catch { clients.delete(c); }
  }
}, 25_000).unref();
