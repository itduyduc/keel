// Live updates: every signed-in window holds one Server-Sent Events stream, and
// every change anyone makes is pushed down all of them that may see it. A window that drops the
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

// `forUser`, when given, decides per person: it returns the event that user gets, or
// null to skip them, so a private team's issues reach only the people who can see it.
export function broadcast(event, forUser = null) {
  const lines = new Map(); // user id → line, worked out once per person
  const lineFor = (userId) => {
    if (!lines.has(userId)) {
      const e = forUser ? forUser(userId) : event;
      lines.set(userId, e ? `data: ${JSON.stringify(e)}\n\n` : null);
    }
    return lines.get(userId);
  };
  for (const c of clients) {
    const line = lineFor(c.userId);
    if (!line) continue;
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
