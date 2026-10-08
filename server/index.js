// Duy My Linear server: JSON API, live updates, sign-in, GitHub, MCP, and the web UI's files.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { broadcast } from './events.js';
import { handleAuth } from './auth.js';
import { createApi } from './api.js';
import { createGithub } from './github.js';
import { createMcp } from './mcp.js';
import { HttpError, sendJson, sendHtml, log } from './util.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function createServer({ dataDir = config.dataDir, webDir: webDirIn = config.webDir, github: githubCfg = config.github, team = config.team } = {}) {
  const webDir = path.resolve(webDirIn);
  const db = openDb(dataDir, team);
  const store = createStore(db, { broadcast, version: config.version });
  store.ensureAdmins(config.adminEmails);
  const github = createGithub(store, githubCfg);
  const api = createApi(store, { github, version: config.version });
  const mcp = createMcp(store, { version: config.version });

  function serveStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed');
    const index = path.join(webDir, 'index.html');
    if (!fs.existsSync(index)) {
      return sendHtml(res, 503, '<p style="font:14px -apple-system;color:#ccc;background:#111;padding:24px">The web UI is not built. Run <code>npm run build</code>.</p>');
    }
    let file = path.normalize(path.join(webDir, decodeURIComponent(url.pathname)));
    if (file !== webDir && !file.startsWith(webDir + path.sep)) throw new HttpError(404, 'Not found');
    let stat = fs.statSync(file, { throwIfNoEntry: false });
    // app routes (/issue/PIC-80, /my-issues, …) are the single page
    if (!stat || stat.isDirectory()) {
      if (path.extname(url.pathname)) throw new HttpError(404, 'Not found');
      file = index;
      stat = fs.statSync(file);
    }
    // Vite fingerprints everything under /assets, so those never change; the page itself
    // must always be fresh, or a deploy would not reach an open window on ⌘R.
    const immutable = url.pathname.startsWith('/assets/');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  // The privacy page names whoever runs this instance (PLUMB_OPERATOR_NAME, PLUMB_CONTACT_EMAIL).
  function servePrivacy(req, res) {
    const file = path.join(webDir, 'privacy.html');
    if (!fs.existsSync(file)) throw new HttpError(404, 'Not found');
    const { name, contact } = config.operator;
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const html = fs.readFileSync(file, 'utf8')
      .replaceAll('{{operator}}', esc(name))
      .replaceAll('{{contact}}', contact ? `<a href="mailto:${esc(contact)}">${esc(contact)}</a>` : 'an administrator of this instance');
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : html);
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://plumb.local');
      const p = url.pathname;
      if (p === '/version') return sendJson(res, 200, { version: config.version });
      if (p === '/health') return sendJson(res, 200, { ok: true });
      if (p.startsWith('/auth/')) return await handleAuth(store, req, res, url);
      if (p === '/github/webhook') return await github.handleWebhook(req, res);
      if (p === '/mcp') return await mcp(req, res);
      if (p.startsWith('/api/')) return await api(req, res, url);
      if (p === '/privacy.html') return servePrivacy(req, res);
      return serveStatic(req, res, url);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) log(`error ${req.method} ${url?.pathname}:`, e.stack || e.message);
      if (res.headersSent) { try { res.end(); } catch {} return; }
      return sendJson(res, status, { error: status >= 500 ? 'Server error' : e.message, ...(e.extra || {}) });
    }
  });

  // unfinished issues follow the calendar into the next cycle
  const rollover = setInterval(() => {
    try {
      const n = store.rollOverCycles();
      if (n) log(`cycles: rolled ${n} unfinished issue(s) into cycle ${store.currentCycle()}`);
    } catch (e) { log('cycles: rollover failed —', e.message); }
  }, 60_000);
  rollover.unref();

  return {
    server, store, db, github,
    close() { clearInterval(rollover); github.stop(); server.close(); db.close(); },
  };
}

// run directly: node server/index.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createServer();
  app.store.rollOverCycles();
  app.github.start();
  app.server.listen(config.port, config.host, () => {
    log(`duy-my-linear ${config.version} on http://${config.host}:${config.port} · public ${config.publicUrl} · data ${config.dataDir}`);
    log(`  google sign-in: ${config.google.clientId ? 'on' : 'off'} · dev login: ${config.devLogin ? 'ON (localhost only)' : 'off'} · github: webhook ${config.github.webhookSecret ? 'on' : 'off'}, poll ${config.github.token ? 'on' : 'off'}`);
  });
  const shutdown = () => { log('shutting down'); app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
