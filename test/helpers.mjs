// Boots the real server on a throwaway database, signed in through dev login.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const ADMIN = 'alice@test.dev';
// a team that moved here from another tracker: keeps its key and counts on from 79
export const TEAM = { name: 'Acme', key: 'PIC', firstIssueNumber: 79, cycleAnchor: '2026-08-31', tz: 'America/Los_Angeles' };
export const WEBHOOK_SECRET = 'test-webhook-secret';

export async function boot({ web = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-test-'));
  Object.assign(process.env, {
    KEEL_SKIP_ENV_FILE: '1',
    KEEL_DEV_LOGIN: '1',
    KEEL_ADMIN_EMAILS: ADMIN,
    KEEL_GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
    KEEL_GITHUB_TOKEN: '',
  });
  let webDir = path.join(dir, 'web');
  if (web) {
    fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Keel</title><div id="root"></div>');
    fs.writeFileSync(path.join(webDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  }
  const { createServer } = await import('../server/index.js');
  const { config } = await import('../server/config.js');
  config.devLogin = true;
  const app = createServer({ dataDir: path.join(dir, 'data'), webDir, github: { org: 'acme', token: '', webhookSecret: WEBHOOK_SECRET, pollSeconds: 120 }, team: TEAM });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${app.server.address().port}`;
  config.publicUrl = base;
  return {
    app, base,
    close: () => { app.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

// a cookie-carrying client for one member
export async function signIn(base, email) {
  const r = await fetch(`${base}/auth/dev/as?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  if (r.status !== 302 || !cookie) throw new Error(`sign-in failed for ${email}: ${r.status}`);
  return client(base, { cookie, 'x-requested-with': 'keel' });
}

export function client(base, headers) {
  const call = async (method, p, body) => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    patch: (p, b = {}) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
  };
}

export async function webhook(base, event, payload, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const r = await fetch(`${base}/github/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': sig },
    body,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export function prPayload({ number, title, branch, state = 'open', draft = false, merged = false, action = 'opened', repo = 'acme/app' }) {
  const t = new Date().toISOString();
  return {
    action,
    repository: { full_name: repo },
    pull_request: {
      number, title, draft, state: merged ? 'closed' : state,
      html_url: `https://github.com/${repo}/pull/${number}`,
      head: { ref: branch }, user: { login: 'octocat' },
      created_at: t, updated_at: t, closed_at: merged || state === 'closed' ? t : null, merged_at: merged ? t : null,
    },
  };
}

export async function mcp(base, token, method, params, id = 1) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }), // id null → a notification
  });
  return { status: r.status, body: r.status === 202 ? null : await r.json() };
}

export async function callTool(base, token, name, args) {
  const r = await mcp(base, token, 'tools/call', { name, arguments: args });
  const res = r.body.result;
  return { isError: !!res.isError, data: res.isError ? res.content[0].text : JSON.parse(res.content[0].text) };
}
