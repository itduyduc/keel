// JSON API for the app (session cookie) and for scripts (bearer token).
import { authenticate } from './auth.js';
import { subscribe, disconnectUser } from './events.js';
import { HttpError, readBody, parseJson, sendJson, notFound, bad, log } from './util.js';

export function createApi(store, { github, version }) {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler });
  };

  const issueNumber = (ref) => {
    const n = store.parseIdentifier(decodeURIComponent(ref));
    if (n === null) throw notFound(`No issue ${ref}`);
    return n;
  };

  add('GET', '/api/bootstrap', ({ user }) => store.bootstrap(user));
  add('GET', '/api/me', ({ user }) => store.serializeUser(user));

  add('GET', '/api/issues', () => ({ issues: store.listIssues() }));
  add('POST', '/api/issues', ({ actor, body }) => store.createIssue(actor, body));
  add('GET', '/api/issues/:ref', ({ params }) => store.issueDetail(issueNumber(params.ref)));
  add('PATCH', '/api/issues/:ref', ({ actor, params, body }) => store.updateIssue(actor, issueNumber(params.ref), body));
  add('DELETE', '/api/issues/:ref', ({ actor, params }) => store.deleteIssue(actor, issueNumber(params.ref)));

  add('POST', '/api/issues/:ref/comments', ({ actor, params, body }) => store.addComment(actor, issueNumber(params.ref), body.body));
  add('PATCH', '/api/comments/:id', ({ actor, params, body }) => store.editComment(actor, params.id, body.body));
  add('DELETE', '/api/comments/:id', ({ actor, params }) => store.deleteComment(actor, params.id));
  add('POST', '/api/comments/:id/reactions', ({ actor, params, body }) => store.toggleReaction(actor, params.id, body.emoji));

  add('GET', '/api/labels', () => ({ labels: store.listLabels() }));
  add('POST', '/api/labels', ({ actor, body }) => store.createLabel(actor, body));
  add('PATCH', '/api/labels/:id', ({ actor, params, body }) => store.updateLabel(actor, params.id, body));

  add('GET', '/api/projects', () => ({ projects: store.listProjects() }));
  add('POST', '/api/projects', ({ actor, body }) => store.createProject(actor, body));
  add('PATCH', '/api/projects/:id', ({ actor, params, body }) => store.updateProject(actor, params.id, body));

  add('GET', '/api/members', () => ({ users: store.listUsers() }));
  add('POST', '/api/members', ({ actor, body }) => store.inviteUser(actor, body));
  add('PATCH', '/api/members/:id', ({ actor, params, body }) => {
    const u = store.updateUser(actor, params.id, body);
    if (!u.active) disconnectUser(u.id);
    return u;
  });

  add('GET', '/api/tokens', ({ user }) => ({ tokens: store.listTokens(user) }));
  add('POST', '/api/tokens', ({ user, body }) => store.createToken(user, body.name));
  add('DELETE', '/api/tokens/:id', ({ user, params }) => ({ tokens: store.revokeToken(user, params.id) }));

  add('PATCH', '/api/team', ({ actor, body }) => store.updateTeam(actor, body));
  add('GET', '/api/cycles', () => store.cycles());
  add('GET', '/api/github/status', () => github.status());

  // the app reports its own errors here, so a teammate's broken window shows up in the server log
  add('POST', '/api/client-log', ({ user, body }) => {
    log(`client[${user.email}] ${String(body.level || 'error')}: ${String(body.message || '').slice(0, 2000)}`);
    return { ok: true };
  });

  return async function handleApi(req, res, url) {
    const auth = authenticate(store, req);
    if (!auth) throw new HttpError(401, 'Sign in first');
    const extraHeaders = auth.refreshCookie ? { 'set-cookie': auth.refreshCookie } : {};

    if (url.pathname === '/api/events' && req.method === 'GET') {
      if (auth.refreshCookie) res.setHeader('set-cookie', auth.refreshCookie);
      return subscribe(req, res, auth.user, version);
    }

    // A cookie rides along on cross-site requests; a custom header cannot be added by
    // another site without CORS saying yes, which this server never does.
    if (auth.via === 'session' && req.method !== 'GET' && req.headers['x-requested-with'] !== 'keel') {
      throw new HttpError(403, 'Missing X-Requested-With: keel');
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? parseJson(await readBody(req)) : {};
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('Body must be a JSON object');
      const result = await r.handler({ req, res, url, params, body, user: auth.user, actor: { kind: 'user', user: auth.user } });
      return sendJson(res, 200, result ?? { ok: true }, extraHeaders);
    }
    throw new HttpError(404, `No route ${req.method} ${url.pathname}`);
  };
}
