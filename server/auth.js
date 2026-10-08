// Sign-in. Google says who you are; the invite list says whether you get in.
//
// Browser:  /auth/google → Google → /auth/google/callback → session cookie → /
// Mac app:  Google refuses OAuth inside an embedded web view (403 disallowed_useragent),
//           so the shell runs the same flow in ASWebAuthenticationSession with
//           ?client=mac. The callback then hands back plumb://auth?code=… (single use,
//           2 minutes), and the shell loads /auth/exchange?code=… in its web view,
//           which sets the cookie there.
import crypto from 'node:crypto';
import { config, googleConfigured } from './config.js';
import { randomToken, redirect, sendHtml, parseCookies, escapeHtml, log, HttpError, readBody } from './util.js';

const COOKIE = 'plumb_session';
const STATE_TTL = 10 * 60_000;
const CODE_TTL = 2 * 60_000;
const pendingStates = new Map(); // state → { client, verifier, at }
const exchangeCodes = new Map(); // code → { userId, at }

setInterval(() => {
  const t = Date.now();
  for (const [k, v] of pendingStates) if (t - v.at > STATE_TTL) pendingStates.delete(k);
  for (const [k, v] of exchangeCodes) if (t - v.at > CODE_TTL) exchangeCodes.delete(k);
}, 60_000).unref();

const secureCookies = () => config.publicUrl.startsWith('https://');

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${400 * 86400}${secureCookies() ? '; Secure' : ''}`;
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies() ? '; Secure' : ''}`;

// Loopback, no proxy in between, and addressed as localhost: dev login needs all three.
function isLocalRequest(req) {
  const addr = req.socket.remoteAddress || '';
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr) && !req.headers['x-forwarded-for']
    && ['localhost', '127.0.0.1', '[::1]'].includes(host);
}
export const devLoginAllowed = (req) => config.devLogin && isLocalRequest(req);

// who is asking: a bearer token (MCP, scripts) or the session cookie (the app)
export function authenticate(store, req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  if (m) {
    const user = store.userForToken(m[1]);
    return user ? { user, via: 'token' } : null;
  }
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const s = store.userForSession(token);
  return s ? { user: s.user, via: 'session', refreshCookie: s.refresh ? sessionCookie(token) : null } : null;
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Duy My Linear</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f0f10; color: #e6e6e6;
         font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Inter", sans-serif; }
  main { width: min(420px, calc(100% - 32px)); background: #151516; border: 1px solid #232326; border-radius: 12px; padding: 28px; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 8px; color: #f7f8f8; }
  p { margin: 0 0 16px; color: #9b9b9b; }
  a.btn, button { display: block; width: 100%; box-sizing: border-box; text-align: left; background: #1c1c1f; color: #e6e6e6;
         border: 1px solid #2a2a2e; border-radius: 8px; padding: 10px 12px; margin: 0 0 8px; font: inherit; text-decoration: none; cursor: pointer; }
  a.btn:hover, button:hover { background: #232327; }
  small { color: #6e6e73; }
</style></head><body><main>${body}</main></body></html>`;
}

function complete(store, req, res, user, client) {
  if (client === 'mac') {
    const code = randomToken(24);
    exchangeCodes.set(code, { userId: user.id, at: Date.now() });
    log(`auth: ${user.email} signed in (mac, code issued)`);
    return redirect(res, `plumb://auth?code=${encodeURIComponent(code)}`);
  }
  const token = store.createSession(user.id, req.headers['user-agent']);
  log(`auth: ${user.email} signed in (web)`);
  return redirect(res, '/', { 'set-cookie': sessionCookie(token) });
}

function notInvited(res, email) {
  return sendHtml(res, 403, page('Not invited', `<h1>${escapeHtml(email)} isn't on this team</h1>
    <p>Duy My Linear only lets in email addresses an admin has invited. Ask one to add you, or try another Google account.</p>
    <a class="btn" href="/auth/google">Use another account</a>`));
}

async function googleExchange(code, verifier) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, code_verifier: verifier, grant_type: 'authorization_code',
      client_id: config.google.clientId, client_secret: config.google.clientSecret,
      redirect_uri: `${config.publicUrl}/auth/google/callback`,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.id_token) throw new Error(`token exchange failed: ${r.status} ${body.error || ''} ${body.error_description || ''}`.trim());
  // Straight from Google's token endpoint over TLS, so the TLS check stands in for the
  // signature check (OpenID Connect Core §3.1.3.7). Audience, issuer and expiry still count.
  const claims = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString('utf8'));
  if (claims.aud !== config.google.clientId) throw new Error('id_token audience mismatch');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('id_token issuer mismatch');
  if (claims.exp * 1000 < Date.now()) throw new Error('id_token expired');
  if (!(claims.email_verified === true || claims.email_verified === 'true')) throw new Error('Google has not verified this email');
  return claims;
}

export async function handleAuth(store, req, res, url) {
  const p = url.pathname;
  const client = url.searchParams.get('client') === 'mac' ? 'mac' : 'web';

  if (p === '/auth/google' && req.method === 'GET') {
    if (!googleConfigured()) {
      if (devLoginAllowed(req)) return redirect(res, `/auth/dev?client=${client}`);
      return sendHtml(res, 503, page('Not set up', '<h1>Google sign-in isn\'t set up yet</h1><p>The server has no Google OAuth client. Set PLUMB_GOOGLE_CLIENT_ID and PLUMB_GOOGLE_CLIENT_SECRET.</p>'));
    }
    const state = randomToken(16);
    const verifier = randomToken(32);
    pendingStates.set(state, { client, verifier, at: Date.now() });
    const q = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: `${config.publicUrl}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  }

  if (p === '/auth/google/callback' && req.method === 'GET') {
    const st = pendingStates.get(url.searchParams.get('state') || '');
    pendingStates.delete(url.searchParams.get('state') || '');
    if (!st || Date.now() - st.at > STATE_TTL) {
      return sendHtml(res, 400, page('Expired', '<h1>That sign-in expired</h1><p>Start again from Duy My Linear.</p><a class="btn" href="/auth/google">Sign in with Google</a>'));
    }
    if (url.searchParams.get('error')) {
      return sendHtml(res, 400, page('Canceled', `<h1>Sign-in didn't finish</h1><p>Google said: ${escapeHtml(url.searchParams.get('error'))}</p>`));
    }
    let claims;
    try {
      claims = await googleExchange(url.searchParams.get('code') || '', st.verifier);
    } catch (e) {
      log('auth: google exchange failed —', e.message);
      return sendHtml(res, 502, page('Failed', `<h1>Google sign-in failed</h1><p>${escapeHtml(e.message)}</p>`));
    }
    const user = store.recordSignIn(claims.email, { name: claims.name, picture: claims.picture });
    if (!user) { log(`auth: refused ${claims.email} (not invited)`); return notInvited(res, claims.email); }
    return complete(store, req, res, user, st.client);
  }

  if (p === '/auth/exchange' && req.method === 'GET') {
    const code = url.searchParams.get('code') || '';
    const entry = exchangeCodes.get(code);
    exchangeCodes.delete(code);
    if (!entry || Date.now() - entry.at > CODE_TTL) {
      return sendHtml(res, 400, page('Expired', '<h1>That sign-in expired</h1><p>Sign in again.</p><a class="btn" href="/">Back to Duy My Linear</a>'));
    }
    const token = store.createSession(entry.userId, req.headers['user-agent']);
    return redirect(res, '/', { 'set-cookie': sessionCookie(token) });
  }

  // Development only: pick an invited member instead of going to Google.
  if (p === '/auth/dev' && req.method === 'GET') {
    if (!devLoginAllowed(req)) throw new HttpError(404, 'Not found');
    const users = store.listUsers().filter((u) => u.active);
    const links = users.map((u) => `<a class="btn" href="/auth/dev/as?client=${client}&email=${encodeURIComponent(u.email)}">${escapeHtml(u.name)} <small>${escapeHtml(u.email)}</small></a>`).join('');
    return sendHtml(res, 200, page('Dev sign-in', `<h1>Dev sign-in</h1><p>Google isn't configured; this page only answers on localhost with PLUMB_DEV_LOGIN=1.</p>${links || '<p>No members. Set PLUMB_ADMIN_EMAILS.</p>'}`));
  }
  if (p === '/auth/dev/as' && req.method === 'GET') {
    if (!devLoginAllowed(req)) throw new HttpError(404, 'Not found');
    const user = store.recordSignIn(url.searchParams.get('email') || '', {});
    if (!user) return notInvited(res, url.searchParams.get('email') || '');
    return complete(store, req, res, user, client);
  }

  if (p === '/auth/logout' && req.method === 'POST') {
    await readBody(req);
    store.deleteSession(parseCookies(req.headers.cookie)[COOKIE]);
    res.writeHead(204, { 'set-cookie': clearCookie(), 'cache-control': 'no-store' });
    return res.end();
  }

  throw new HttpError(404, 'Not found');
}
