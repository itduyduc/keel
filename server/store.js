// The domain layer. REST, MCP and GitHub all write through these functions, so
// validation, activity and live updates happen the same way whoever the caller is.
import { tx, getMeta, setMeta } from './db.js';
import { now, bad, notFound, forbidden, isDateString, randomToken, sha256, slugify } from './util.js';
import { cycleNumberAt, cycleList } from './cycles.js';

export const PRIORITIES = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
export const ESTIMATE_SCALES = {
  exponential: { label: 'Exponential', values: [1, 2, 4, 8, 16] },
  fibonacci: { label: 'Fibonacci', values: [1, 2, 3, 5, 8] },
  linear: { label: 'Linear', values: [1, 2, 3, 4, 5] },
  tshirt: { label: 'T-shirt', values: [1, 2, 3, 5, 8], names: ['XS', 'S', 'M', 'L', 'XL'] },
};
export const PROJECT_ICONS = ['cube', 'heart', 'rocket', 'star', 'flag', 'bolt', 'bug', 'book', 'briefcase', 'chart',
  'code', 'compass', 'globe', 'leaf', 'lightbulb', 'target', 'users', 'shop', 'mountain', 'sparkles'];
const SESSION_DAYS = 400; // browsers cap a cookie's life at 400 days
const DONE_TYPES = new Set(['completed', 'canceled']);

export function createStore(db, { broadcast = () => {}, version = 'dev' } = {}) {
  const cache = new Map();
  const st = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };

  // ── team ────────────────────────────────────────────────────────────────
  function statuses() {
    return st('SELECT id, name, type, color, position FROM statuses ORDER BY position').all();
  }
  const statusById = (id) => statuses().find((s) => s.id === id);
  const statusByName = (name) => statuses().find((s) => s.name.toLowerCase() === String(name).toLowerCase());

  function cycleConfig() {
    return {
      anchor: getMeta(db, 'cycle_anchor'),
      tz: getMeta(db, 'cycle_tz'),
      lengthDays: Number(getMeta(db, 'cycle_length_days')),
    };
  }
  const currentCycle = (at = Date.now()) => cycleNumberAt(at, cycleConfig());

  function team() {
    const key = getMeta(db, 'team_key');
    return {
      key,
      name: getMeta(db, 'team_name'),
      icon: getMeta(db, 'team_icon'),
      color: getMeta(db, 'team_color'),
      cycle: cycleConfig(),
      estimateScale: getMeta(db, 'estimate_scale'),
      estimateScales: ESTIMATE_SCALES,
      defaultStatusId: statusByName(getMeta(db, 'default_status'))?.id ?? statuses()[0].id,
      prOpenStatusId: statusByName(getMeta(db, 'pr_open_status'))?.id ?? null,
      prMergedStatusId: statusByName(getMeta(db, 'pr_merged_status'))?.id ?? null,
      projectIcons: PROJECT_ICONS,
    };
  }
  const identifier = (number) => `${getMeta(db, 'team_key')}-${number}`;

  function updateTeam(actor, patch) {
    requireAdmin(actor);
    if (patch.estimateScale !== undefined) {
      if (!ESTIMATE_SCALES[patch.estimateScale]) throw bad(`estimateScale must be one of ${Object.keys(ESTIMATE_SCALES).join(', ')}`);
      setMeta(db, 'estimate_scale', patch.estimateScale);
    }
    const t = team();
    broadcast({ type: 'team', team: t });
    return t;
  }

  // ── users ───────────────────────────────────────────────────────────────
  function serializeUser(u) {
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      name: u.name || u.email.split('@')[0],
      handle: u.handle,
      gitHandle: u.git_handle,
      avatarUrl: u.avatar_url,
      role: u.role,
      active: !!u.active,
      joined: !!u.last_seen_at,
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
    };
  }
  const userRow = (id) => st('SELECT * FROM users WHERE id = ?').get(id);
  const userByEmail = (email) => st('SELECT * FROM users WHERE email = ?').get(String(email).trim());
  const listUsers = () => st('SELECT * FROM users ORDER BY active DESC, COALESCE(name, email) COLLATE NOCASE').all().map(serializeUser);

  function uniqueHandle(base, exceptId = 0) {
    const clean = String(base).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'user';
    for (let i = 0; i < 1000; i++) {
      const h = i ? `${clean}${i + 1}` : clean;
      const taken = st('SELECT id FROM users WHERE handle = ? AND id != ?').get(h, exceptId);
      if (!taken) return h;
    }
    return `${clean}${Date.now()}`;
  }
  const defaultGitHandle = (email) => email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';

  function inviteUser(actor, { email, role = 'member' } = {}) {
    requireAdmin(actor);
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('A valid email is required');
    if (!['admin', 'member'].includes(role)) throw bad('role must be admin or member');
    const existing = userByEmail(e);
    if (existing) {
      if (existing.active) throw bad(`${e} is already a member`);
      st('UPDATE users SET active = 1, role = ? WHERE id = ?').run(role, existing.id);
    } else {
      st(`INSERT INTO users (email, handle, git_handle, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(e, uniqueHandle(e.split('@')[0]), defaultGitHandle(e), role, actorUserId(actor), now());
    }
    const users = listUsers();
    broadcast({ type: 'users', users });
    return serializeUser(userByEmail(e));
  }

  function updateUser(actor, id, patch = {}) {
    const u = userRow(Number(id));
    if (!u) throw notFound('No such member');
    const self = actor.kind === 'user' && actor.user.id === u.id;
    const admin = actor.kind === 'user' && actor.user.role === 'admin';
    if (!self && !admin) throw forbidden('Only admins can change other members');
    const set = {};
    if (patch.name !== undefined) set.name = String(patch.name).trim().slice(0, 80) || null;
    if (patch.handle !== undefined) {
      const h = String(patch.handle).trim().toLowerCase();
      if (!/^[a-z0-9._-]{1,24}$/.test(h)) throw bad('handle: 1–24 of a-z 0-9 . _ -');
      if (st('SELECT id FROM users WHERE handle = ? AND id != ?').get(h, u.id)) throw bad(`@${h} is taken`);
      set.handle = h;
    }
    if (patch.gitHandle !== undefined) {
      const g = String(patch.gitHandle).trim();
      if (!/^[A-Za-z0-9._-]{1,39}$/.test(g)) throw bad('gitHandle: 1–39 of A-Z a-z 0-9 . _ -');
      set.git_handle = g;
    }
    if (patch.role !== undefined || patch.active !== undefined) {
      if (!admin) throw forbidden('Only admins can change roles or remove members');
      if (patch.role !== undefined) {
        if (!['admin', 'member'].includes(patch.role)) throw bad('role must be admin or member');
        set.role = patch.role;
      }
      if (patch.active !== undefined) set.active = patch.active ? 1 : 0;
      const wouldLoseAdmin = (set.role === 'member' || set.active === 0) && u.role === 'admin';
      if (wouldLoseAdmin && st(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?`).get(u.id).n === 0) {
        throw bad('Duy My Linear needs at least one active admin');
      }
    }
    const keys = Object.keys(set);
    if (keys.length) {
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), u.id);
      if (set.active === 0) st('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      broadcast({ type: 'users', users: listUsers() });
    }
    return serializeUser(userRow(u.id));
  }

  function ensureAdmins(emails) {
    for (const e of emails) {
      const u = userByEmail(e);
      if (!u) {
        st(`INSERT INTO users (email, handle, git_handle, role, created_at) VALUES (?, ?, ?, 'admin', ?)`)
          .run(e, uniqueHandle(e.split('@')[0]), defaultGitHandle(e), now());
      } else if (u.role !== 'admin' || !u.active) {
        st(`UPDATE users SET role = 'admin', active = 1 WHERE id = ?`).run(u.id);
      }
    }
  }

  // Google told us who this is; the invite list decides whether they get in.
  function recordSignIn(email, { name, picture } = {}) {
    const u = userByEmail(email);
    if (!u || !u.active) return null;
    const firstTime = !u.last_seen_at;
    const newName = u.name || (name ? String(name).slice(0, 80) : null);
    let handle = u.handle;
    // an invite got a handle from the email; the first real sign-in can do better
    if (firstTime && name) handle = uniqueHandle(String(name).split(/\s+/)[0], u.id);
    st('UPDATE users SET name = ?, avatar_url = COALESCE(?, avatar_url), handle = ?, last_seen_at = ? WHERE id = ?')
      .run(newName, picture || null, handle, now(), u.id);
    broadcast({ type: 'users', users: listUsers() });
    return userRow(u.id);
  }

  // ── sessions and tokens ────────────────────────────────────────────────
  function createSession(userId, userAgent = '') {
    const token = randomToken(32);
    const t = new Date();
    const exp = new Date(t.getTime() + SESSION_DAYS * 86_400_000);
    st('INSERT INTO sessions (token_hash, user_id, created_at, refreshed_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(token), userId, t.toISOString(), t.toISOString(), exp.toISOString(), String(userAgent).slice(0, 200));
    return token;
  }

  // returns { user, refresh } — refresh=true when the cookie should be re-sent with a new expiry
  function userForSession(token) {
    if (!token) return null;
    const s = st('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
    if (!s) return null;
    if (Date.parse(s.expires_at) < Date.now()) { st('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash); return null; }
    const u = userRow(s.user_id);
    if (!u || !u.active) return null;
    let refresh = false;
    if (Date.now() - Date.parse(s.refreshed_at) > 86_400_000) {
      const t = new Date();
      st('UPDATE sessions SET refreshed_at = ?, expires_at = ? WHERE token_hash = ?')
        .run(t.toISOString(), new Date(t.getTime() + SESSION_DAYS * 86_400_000).toISOString(), s.token_hash);
      st('UPDATE users SET last_seen_at = ? WHERE id = ?').run(t.toISOString(), u.id);
      refresh = true;
    }
    return { user: u, refresh };
  }
  const deleteSession = (token) => token && st('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));

  const listTokens = (user) => st('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC')
    .all(user.id).map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, createdAt: t.created_at, lastUsedAt: t.last_used_at }));

  function createToken(user, name) {
    const n = String(name || '').trim().slice(0, 60);
    if (!n) throw bad('Name the token, e.g. "Claude on my MacBook"');
    const token = `plumb_${randomToken(24)}`;
    st('INSERT INTO api_tokens (user_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, n, sha256(token), token.slice(0, 12), now());
    return { token, tokens: listTokens(user) };
  }

  function revokeToken(user, id) {
    const r = st('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(now(), Number(id), user.id);
    if (!r.changes) throw notFound('No such token');
    return listTokens(user);
  }

  function userForToken(token) {
    if (!token || !token.startsWith('plumb_')) return null;
    const t = st('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL').get(sha256(token));
    if (!t) return null;
    const u = userRow(t.user_id);
    if (!u || !u.active) return null;
    if (!t.last_used_at || Date.now() - Date.parse(t.last_used_at) > 60_000) {
      st('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now(), t.id);
      st('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), u.id);
    }
    return u;
  }

  // ── actors ─────────────────────────────────────────────────────────────
  const actorUserId = (actor) => (actor.kind === 'user' ? actor.user.id : null);
  const actorName = (actor) => (actor.kind === 'user' ? (actor.user.name || actor.user.email) : actor.kind === 'github' ? 'GitHub' : 'Duy My Linear');
  function requireAdmin(actor) {
    if (actor.kind !== 'user' || actor.user.role !== 'admin') throw forbidden('Only admins can do that');
  }

  // ── labels and projects ─────────────────────────────────────────────────
  const serializeLabel = (l) => ({ id: l.id, name: l.name, color: l.color, description: l.description, archived: !!l.archived_at });
  const listLabels = () => st('SELECT * FROM labels ORDER BY name COLLATE NOCASE').all().map(serializeLabel);
  const hexColor = (c) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(c))) throw bad('color must look like #aabbcc');
    return String(c).toLowerCase();
  };

  function createLabel(actor, { name, color = '#bec2c8', description = null } = {}) {
    const n = String(name || '').trim().slice(0, 40);
    if (!n) throw bad('Label name is required');
    if (st('SELECT id FROM labels WHERE name = ?').get(n)) throw bad(`Label "${n}" exists`);
    const r = st('INSERT INTO labels (name, color, description, created_at) VALUES (?, ?, ?, ?)').run(n, hexColor(color), description, now());
    broadcast({ type: 'labels', labels: listLabels() });
    return serializeLabel(st('SELECT * FROM labels WHERE id = ?').get(r.lastInsertRowid));
  }

  function updateLabel(actor, id, patch = {}) {
    const l = st('SELECT * FROM labels WHERE id = ?').get(Number(id));
    if (!l) throw notFound('No such label');
    const name = patch.name !== undefined ? String(patch.name).trim().slice(0, 40) : l.name;
    if (!name) throw bad('Label name is required');
    if (name.toLowerCase() !== l.name.toLowerCase() && st('SELECT id FROM labels WHERE name = ?').get(name)) throw bad(`Label "${name}" exists`);
    const color = patch.color !== undefined ? hexColor(patch.color) : l.color;
    const description = patch.description !== undefined ? (patch.description || null) : l.description;
    const archived = patch.archived !== undefined ? (patch.archived ? l.archived_at || now() : null) : l.archived_at;
    st('UPDATE labels SET name = ?, color = ?, description = ?, archived_at = ? WHERE id = ?').run(name, color, description, archived, l.id);
    broadcast({ type: 'labels', labels: listLabels() });
    return serializeLabel(st('SELECT * FROM labels WHERE id = ?').get(l.id));
  }

  const serializeProject = (p) => ({ id: p.id, name: p.name, icon: p.icon, color: p.color, description: p.description, archived: !!p.archived_at, createdAt: p.created_at });
  const listProjects = () => st('SELECT * FROM projects ORDER BY sort_order, id').all().map(serializeProject);

  function createProject(actor, { name, icon = 'cube', color = '#bec2c8', description = null } = {}) {
    const n = String(name || '').trim().slice(0, 80);
    if (!n) throw bad('Project name is required');
    if (st('SELECT id FROM projects WHERE name = ?').get(n)) throw bad(`Project "${n}" exists`);
    if (!PROJECT_ICONS.includes(icon)) throw bad(`icon must be one of ${PROJECT_ICONS.join(', ')}`);
    const order = (st('SELECT MAX(sort_order) AS m FROM projects').get().m ?? 0) + 1;
    const r = st('INSERT INTO projects (name, icon, color, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(n, icon, hexColor(color), description, order, now());
    broadcast({ type: 'projects', projects: listProjects() });
    return serializeProject(st('SELECT * FROM projects WHERE id = ?').get(r.lastInsertRowid));
  }

  function updateProject(actor, id, patch = {}) {
    const p = st('SELECT * FROM projects WHERE id = ?').get(Number(id));
    if (!p) throw notFound('No such project');
    const name = patch.name !== undefined ? String(patch.name).trim().slice(0, 80) : p.name;
    if (!name) throw bad('Project name is required');
    if (name.toLowerCase() !== p.name.toLowerCase() && st('SELECT id FROM projects WHERE name = ?').get(name)) throw bad(`Project "${name}" exists`);
    const icon = patch.icon !== undefined ? patch.icon : p.icon;
    if (!PROJECT_ICONS.includes(icon)) throw bad(`icon must be one of ${PROJECT_ICONS.join(', ')}`);
    const color = patch.color !== undefined ? hexColor(patch.color) : p.color;
    const description = patch.description !== undefined ? (patch.description || null) : p.description;
    const archived = patch.archived !== undefined ? (patch.archived ? p.archived_at || now() : null) : p.archived_at;
    st('UPDATE projects SET name = ?, icon = ?, color = ?, description = ?, archived_at = ? WHERE id = ?').run(name, icon, color, description, archived, p.id);
    broadcast({ type: 'projects', projects: listProjects() });
    return serializeProject(st('SELECT * FROM projects WHERE id = ?').get(p.id));
  }

  // ── issues ─────────────────────────────────────────────────────────────
  const serializePr = (p) => ({
    id: p.id, repo: p.repo, number: p.number, title: p.title, url: p.url, branch: p.branch, author: p.author,
    state: p.state, draft: !!p.draft, openedAt: p.opened_at, mergedAt: p.merged_at, closedAt: p.closed_at,
  });

  function hydrate(rows) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => '?').join(',');
    const labels = new Map();
    for (const l of db.prepare(`SELECT issue_id, label_id FROM issue_labels WHERE issue_id IN (${marks})`).all(...ids)) {
      if (!labels.has(l.issue_id)) labels.set(l.issue_id, []);
      labels.get(l.issue_id).push(l.label_id);
    }
    const prs = new Map();
    for (const p of db.prepare(`SELECT ip.issue_id, p.* FROM issue_prs ip JOIN pull_requests p ON p.id = ip.pr_id
                                WHERE ip.issue_id IN (${marks}) ORDER BY p.opened_at`).all(...ids)) {
      if (!prs.has(p.issue_id)) prs.set(p.issue_id, []);
      prs.get(p.issue_id).push(serializePr(p));
    }
    const key = getMeta(db, 'team_key');
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      identifier: `${key}-${r.number}`,
      title: r.title,
      description: r.description,
      statusId: r.status_id,
      priority: r.priority,
      assigneeId: r.assignee_id,
      creatorId: r.creator_id,
      projectId: r.project_id,
      cycle: r.cycle,
      parentId: r.parent_id,
      estimate: r.estimate,
      dueDate: r.due_date,
      labelIds: labels.get(r.id) || [],
      prs: prs.get(r.id) || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      canceledAt: r.canceled_at,
    }));
  }

  const issueRowByNumber = (n) => st('SELECT * FROM issues WHERE number = ? AND deleted_at IS NULL').get(Number(n));
  const issueRowById = (id) => st('SELECT * FROM issues WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  const listIssues = () => hydrate(st('SELECT * FROM issues WHERE deleted_at IS NULL ORDER BY number').all());
  const getIssue = (number) => {
    const r = issueRowByNumber(number);
    return r ? hydrate([r])[0] : null;
  };
  const getIssueById = (id) => {
    const r = issueRowById(id);
    return r ? hydrate([r])[0] : null;
  };

  // "PIC-79", "pic-79", "79" → 79
  function parseIdentifier(ref) {
    const s = String(ref ?? '').trim();
    const m = s.match(/^(?:([A-Za-z]+)-)?(\d+)$/);
    if (!m) return null;
    if (m[1] && m[1].toUpperCase() !== getMeta(db, 'team_key')) return null;
    return Number(m[2]);
  }

  function validateIssue(input, { creating, row } = {}) {
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
    if (creating || has('title')) {
      const t = String(input.title ?? '').replace(/\s+/g, ' ').trim();
      if (!t) throw bad('title is required');
      if (t.length > 300) throw bad('title is longer than 300 characters');
      out.title = t;
    }
    if (has('description')) {
      const d = String(input.description ?? '');
      if (d.length > 200_000) throw bad('description is too long');
      out.description = d;
    }
    if (has('statusId')) {
      if (!statusById(Number(input.statusId))) throw bad(`No status with id ${input.statusId}`);
      out.status_id = Number(input.statusId);
    }
    if (has('priority')) {
      const p = Number(input.priority);
      if (!Number.isInteger(p) || p < 0 || p > 4) throw bad('priority is 0 (none), 1 (urgent), 2 (high), 3 (medium) or 4 (low)');
      out.priority = p;
    }
    if (has('assigneeId')) {
      if (input.assigneeId === null) out.assignee_id = null;
      else {
        const u = userRow(Number(input.assigneeId));
        if (!u || !u.active) throw bad(`No active member with id ${input.assigneeId}`);
        out.assignee_id = u.id;
      }
    }
    if (has('projectId')) {
      if (input.projectId === null) out.project_id = null;
      else {
        const p = st('SELECT * FROM projects WHERE id = ?').get(Number(input.projectId));
        if (!p || p.archived_at) throw bad(`No project with id ${input.projectId}`);
        out.project_id = p.id;
      }
    }
    if (has('cycle')) {
      if (input.cycle === null) out.cycle = null;
      else {
        const c = Number(input.cycle);
        if (!Number.isInteger(c) || c < 1) throw bad('cycle is a cycle number (1, 2, …) or null');
        out.cycle = c;
      }
    }
    if (has('estimate')) {
      if (input.estimate === null) out.estimate = null;
      else {
        const e = Number(input.estimate);
        if (!Number.isInteger(e) || e < 0 || e > 100) throw bad('estimate is a whole number from 0 to 100, or null');
        out.estimate = e;
      }
    }
    if (has('dueDate')) {
      if (input.dueDate === null || input.dueDate === '') out.due_date = null;
      else if (!isDateString(input.dueDate)) throw bad('dueDate is YYYY-MM-DD or null');
      else out.due_date = input.dueDate;
    }
    if (has('parentId')) {
      if (input.parentId === null) out.parent_id = null;
      else {
        const parent = issueRowById(Number(input.parentId));
        if (!parent) throw bad(`No issue with id ${input.parentId}`);
        if (row) {
          // walk up from the new parent; meeting this issue means a loop
          for (let p = parent; p; p = p.parent_id ? issueRowById(p.parent_id) : null) {
            if (p.id === row.id) throw bad('An issue cannot be nested under itself or its own sub-issue');
          }
        }
        out.parent_id = parent.id;
      }
    }
    if (has('labelIds')) {
      if (!Array.isArray(input.labelIds)) throw bad('labelIds is a list of label ids');
      const ids = [...new Set(input.labelIds.map(Number))];
      for (const id of ids) {
        const l = st('SELECT * FROM labels WHERE id = ?').get(id);
        if (!l || l.archived_at) throw bad(`No label with id ${id}`);
      }
      out.labelIds = ids;
    }
    return out;
  }

  function serializeActivity(a) {
    return {
      id: a.id, issueId: a.issue_id, actorKind: a.actor_kind, actorId: a.actor_id, actorName: a.actor_name,
      kind: a.kind, from: a.from_value, to: a.to_value, meta: a.meta ? JSON.parse(a.meta) : null, createdAt: a.created_at,
    };
  }

  function addActivity(issueId, actor, kind, from = null, to = null, meta = null) {
    const r = st(`INSERT INTO activity (issue_id, actor_kind, actor_id, actor_name, kind, from_value, to_value, meta, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(issueId, actor.kind, actorUserId(actor), actorName(actor), kind,
        from === null ? null : String(from), to === null ? null : String(to), meta ? JSON.stringify(meta) : null, now());
    return serializeActivity(st('SELECT * FROM activity WHERE id = ?').get(r.lastInsertRowid));
  }

  // status timestamps follow the status type, the way Linear's do
  function statusStamps(row, newStatusId) {
    const type = statusById(newStatusId).type;
    const t = now();
    return {
      started_at: type === 'started' || type === 'completed' ? (row?.started_at || t) : (type === 'backlog' || type === 'unstarted' ? null : row?.started_at ?? null),
      completed_at: type === 'completed' ? (row?.completed_at || t) : null,
      canceled_at: type === 'canceled' ? (row?.canceled_at || t) : null,
    };
  }

  const nameOf = {
    status: (id) => (id ? statusById(id)?.name : null),
    priority: (p) => PRIORITIES[p],
    user: (id) => (id ? serializeUser(userRow(id))?.name : null),
    project: (id) => (id ? st('SELECT name FROM projects WHERE id = ?').get(id)?.name : null),
    issue: (id) => (id ? identifier(st('SELECT number FROM issues WHERE id = ?').get(id)?.number) : null),
    label: (id) => st('SELECT name FROM labels WHERE id = ?').get(id)?.name,
  };

  function createIssue(actor, input = {}) {
    const data = validateIssue(input, { creating: true });
    const statusId = data.status_id ?? team().defaultStatusId;
    const { issue, act } = tx(db, () => {
      const number = Number(getMeta(db, 'next_issue_number'));
      setMeta(db, 'next_issue_number', number + 1);
      const t = now();
      const stamps = statusStamps(null, statusId);
      const r = st(`INSERT INTO issues (number, title, description, status_id, priority, assignee_id, creator_id, project_id, cycle,
                     parent_id, estimate, due_date, created_at, updated_at, started_at, completed_at, canceled_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(number, data.title, data.description ?? '', statusId, data.priority ?? 0, data.assignee_id ?? null, actorUserId(actor),
          data.project_id ?? null, data.cycle ?? null, data.parent_id ?? null, data.estimate ?? null, data.due_date ?? null,
          t, t, stamps.started_at, stamps.completed_at, stamps.canceled_at);
      const id = Number(r.lastInsertRowid);
      for (const lid of data.labelIds || []) st('INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?)').run(id, lid);
      const act = addActivity(id, actor, 'created');
      return { issue: getIssueById(id), act };
    });
    broadcast({ type: 'issue', issue });
    broadcast({ type: 'activity', issueId: issue.id, activity: act });
    return issue;
  }

  function updateIssue(actor, number, input = {}) {
    const row = issueRowByNumber(number);
    if (!row) throw notFound(`No issue ${identifier(number)}`);
    const data = validateIssue(input, { row });
    const acts = [];
    const changed = tx(db, () => {
      const set = {};
      const log = (kind, from, to, meta) => acts.push(addActivity(row.id, actor, kind, from, to, meta));
      if (data.title !== undefined && data.title !== row.title) { set.title = data.title; log('title', row.title, data.title); }
      if (data.description !== undefined && data.description !== row.description) {
        set.description = data.description;
        // the editor saves as you pause; one "updated the description" per sitting, not one per pause
        const last = st('SELECT * FROM activity WHERE issue_id = ? ORDER BY id DESC LIMIT 1').get(row.id);
        const sameSitting = last && last.kind === 'description' && last.actor_kind === actor.kind
          && last.actor_id === actorUserId(actor) && Date.now() - Date.parse(last.created_at) < 10 * 60_000;
        if (sameSitting) st('UPDATE activity SET created_at = ? WHERE id = ?').run(now(), last.id);
        else log('description');
      }
      if (data.status_id !== undefined && data.status_id !== row.status_id) {
        set.status_id = data.status_id;
        Object.assign(set, statusStamps(row, data.status_id));
        log('status', nameOf.status(row.status_id), nameOf.status(data.status_id));
      }
      if (data.priority !== undefined && data.priority !== row.priority) { set.priority = data.priority; log('priority', nameOf.priority(row.priority), nameOf.priority(data.priority)); }
      if (data.assignee_id !== undefined && data.assignee_id !== row.assignee_id) { set.assignee_id = data.assignee_id; log('assignee', nameOf.user(row.assignee_id), nameOf.user(data.assignee_id)); }
      if (data.project_id !== undefined && data.project_id !== row.project_id) { set.project_id = data.project_id; log('project', nameOf.project(row.project_id), nameOf.project(data.project_id)); }
      if (data.cycle !== undefined && data.cycle !== row.cycle) { set.cycle = data.cycle; log('cycle', row.cycle, data.cycle); }
      if (data.estimate !== undefined && data.estimate !== row.estimate) { set.estimate = data.estimate; log('estimate', row.estimate, data.estimate); }
      if (data.due_date !== undefined && data.due_date !== row.due_date) { set.due_date = data.due_date; log('due_date', row.due_date, data.due_date); }
      if (data.parent_id !== undefined && data.parent_id !== row.parent_id) { set.parent_id = data.parent_id; log('parent', nameOf.issue(row.parent_id), nameOf.issue(data.parent_id)); }
      let labelsChanged = false;
      if (data.labelIds) {
        const before = new Set(st('SELECT label_id FROM issue_labels WHERE issue_id = ?').all(row.id).map((x) => x.label_id));
        const after = new Set(data.labelIds);
        for (const id of after) if (!before.has(id)) { st('INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?)').run(row.id, id); log('label_added', null, nameOf.label(id)); labelsChanged = true; }
        for (const id of before) if (!after.has(id)) { st('DELETE FROM issue_labels WHERE issue_id = ? AND label_id = ?').run(row.id, id); log('label_removed', nameOf.label(id), null); labelsChanged = true; }
      }
      const keys = Object.keys(set);
      if (!keys.length && !labelsChanged) return false;
      set.updated_at = now();
      const cols = Object.keys(set);
      db.prepare(`UPDATE issues SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => set[c]), row.id);
      return true;
    });
    const issue = getIssueById(row.id);
    if (changed) {
      broadcast({ type: 'issue', issue });
      for (const a of acts) broadcast({ type: 'activity', issueId: row.id, activity: a });
    }
    return issue;
  }

  function deleteIssue(actor, number) {
    const row = issueRowByNumber(number);
    if (!row) throw notFound(`No issue ${identifier(number)}`);
    const children = st('SELECT id FROM issues WHERE parent_id = ? AND deleted_at IS NULL').all(row.id);
    tx(db, () => {
      st('UPDATE issues SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), row.id);
      addActivity(row.id, actor, 'deleted');
      // sub-issues outlive a deleted parent, the way they do in Linear
      for (const c of children) {
        st('UPDATE issues SET parent_id = NULL, updated_at = ? WHERE id = ?').run(now(), c.id);
        addActivity(c.id, actor, 'parent', identifier(row.number), null);
      }
    });
    broadcast({ type: 'issue_deleted', id: row.id, number: row.number });
    for (const c of children) broadcast({ type: 'issue', issue: getIssueById(c.id) });
    return { deleted: identifier(row.number) };
  }

  // ── comments and reactions ─────────────────────────────────────────────
  function reactionsFor(commentIds) {
    const out = new Map();
    if (!commentIds.length) return out;
    const rows = db.prepare(`SELECT comment_id, emoji, user_id FROM reactions WHERE comment_id IN (${commentIds.map(() => '?').join(',')})
                             ORDER BY created_at`).all(...commentIds);
    for (const r of rows) {
      if (!out.has(r.comment_id)) out.set(r.comment_id, []);
      const list = out.get(r.comment_id);
      let e = list.find((x) => x.emoji === r.emoji);
      if (!e) { e = { emoji: r.emoji, userIds: [] }; list.push(e); }
      e.userIds.push(r.user_id);
    }
    return out;
  }
  const serializeComment = (c, reactions = []) => ({
    id: c.id, issueId: c.issue_id, userId: c.user_id, body: c.body, createdAt: c.created_at, updatedAt: c.updated_at, editedAt: c.edited_at, reactions,
  });

  function listComments(issueId) {
    const rows = st('SELECT * FROM comments WHERE issue_id = ? AND deleted_at IS NULL ORDER BY created_at, id').all(issueId);
    const rx = reactionsFor(rows.map((r) => r.id));
    return rows.map((r) => serializeComment(r, rx.get(r.id) || []));
  }

  const cleanBody = (body) => {
    const b = String(body ?? '').replace(/\s+$/, '');
    if (!b.trim()) throw bad('Comment is empty');
    if (b.length > 100_000) throw bad('Comment is too long');
    return b;
  };

  function addComment(actor, number, body) {
    if (actor.kind !== 'user') throw forbidden('Only members can comment');
    const row = issueRowByNumber(number);
    if (!row) throw notFound(`No issue ${identifier(number)}`);
    const b = cleanBody(body);
    const t = now();
    const r = st('INSERT INTO comments (issue_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(row.id, actor.user.id, b, t, t);
    st('UPDATE issues SET updated_at = ? WHERE id = ?').run(t, row.id);
    const comment = serializeComment(st('SELECT * FROM comments WHERE id = ?').get(r.lastInsertRowid));
    broadcast({ type: 'comment', issueId: row.id, comment });
    return comment;
  }

  function commentRow(id) {
    const c = st('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL').get(Number(id));
    if (!c) throw notFound('No such comment');
    return c;
  }

  function editComment(actor, id, body) {
    const c = commentRow(id);
    if (actor.kind !== 'user' || actor.user.id !== c.user_id) throw forbidden('You can only edit your own comments');
    const b = cleanBody(body);
    if (b !== c.body) st('UPDATE comments SET body = ?, updated_at = ?, edited_at = ? WHERE id = ?').run(b, now(), now(), c.id);
    const comment = serializeComment(st('SELECT * FROM comments WHERE id = ?').get(c.id), reactionsFor([c.id]).get(c.id) || []);
    broadcast({ type: 'comment', issueId: c.issue_id, comment });
    return comment;
  }

  function deleteComment(actor, id) {
    const c = commentRow(id);
    const admin = actor.kind === 'user' && actor.user.role === 'admin';
    if (!(actor.kind === 'user' && actor.user.id === c.user_id) && !admin) throw forbidden('You can only delete your own comments');
    st('UPDATE comments SET deleted_at = ? WHERE id = ?').run(now(), c.id);
    broadcast({ type: 'comment_deleted', issueId: c.issue_id, commentId: c.id });
    return { deleted: c.id };
  }

  function toggleReaction(actor, commentId, emoji) {
    if (actor.kind !== 'user') throw forbidden('Only members can react');
    const c = commentRow(commentId);
    const e = String(emoji ?? '').trim();
    if (!e || e.length > 16 || /\s/.test(e)) throw bad('emoji is a single emoji');
    const existing = st('SELECT 1 FROM reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?').get(c.id, actor.user.id, e);
    if (existing) st('DELETE FROM reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?').run(c.id, actor.user.id, e);
    else st('INSERT INTO reactions (comment_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(c.id, actor.user.id, e, now());
    const reactions = reactionsFor([c.id]).get(c.id) || [];
    broadcast({ type: 'reactions', issueId: c.issue_id, commentId: c.id, reactions });
    return { commentId: c.id, reactions };
  }

  // ── detail ─────────────────────────────────────────────────────────────
  function listActivity(issueId) {
    return st('SELECT * FROM activity WHERE issue_id = ? ORDER BY created_at, id').all(issueId).map(serializeActivity);
  }

  function issueDetail(number) {
    const issue = getIssue(number);
    if (!issue) throw notFound(`No issue ${identifier(number)}`);
    return { issue, comments: listComments(issue.id), activity: listActivity(issue.id) };
  }

  // ── cycles ─────────────────────────────────────────────────────────────
  function cycles(at = Date.now()) {
    return cycleList(cycleConfig(), at);
  }

  // Unfinished work in a cycle that has ended moves into the current one, as in Linear.
  function rollOverCycles(at = Date.now()) {
    const current = currentCycle(at);
    const rows = st(`SELECT i.* FROM issues i JOIN statuses s ON s.id = i.status_id
                     WHERE i.deleted_at IS NULL AND i.cycle IS NOT NULL AND i.cycle < ? AND s.type NOT IN ('completed', 'canceled')`).all(current);
    const system = { kind: 'system' };
    for (const r of rows) {
      const act = tx(db, () => {
        st('UPDATE issues SET cycle = ?, updated_at = ? WHERE id = ?').run(current, now(), r.id);
        return addActivity(r.id, system, 'rolled_over', r.cycle, current);
      });
      broadcast({ type: 'issue', issue: getIssueById(r.id) });
      broadcast({ type: 'activity', issueId: r.id, activity: act });
    }
    return rows.length;
  }

  // ── pull requests ──────────────────────────────────────────────────────
  // returns { pr, previous } so the caller can tell what changed
  function upsertPullRequest(p) {
    const previous = st('SELECT * FROM pull_requests WHERE repo = ? AND number = ?').get(p.repo, p.number);
    if (previous) {
      st(`UPDATE pull_requests SET title = ?, url = ?, branch = ?, author = ?, state = ?, draft = ?, opened_at = ?, merged_at = ?,
          closed_at = ?, updated_at = ? WHERE id = ?`)
        .run(p.title, p.url, p.branch, p.author, p.state, p.draft ? 1 : 0, p.openedAt, p.mergedAt, p.closedAt, p.updatedAt, previous.id);
    } else {
      st(`INSERT INTO pull_requests (repo, number, title, url, branch, author, state, draft, opened_at, merged_at, closed_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(p.repo, p.number, p.title, p.url, p.branch, p.author, p.state, p.draft ? 1 : 0, p.openedAt, p.mergedAt, p.closedAt, p.updatedAt);
    }
    const pr = st('SELECT * FROM pull_requests WHERE repo = ? AND number = ?').get(p.repo, p.number);
    return { pr: serializePr(pr), previous: previous ? serializePr(previous) : null };
  }

  // link once; the first link writes a line in the issue's activity
  function linkPullRequest(issueId, pr) {
    const r = st('INSERT OR IGNORE INTO issue_prs (issue_id, pr_id, linked_at) VALUES (?, ?, ?)').run(issueId, pr.id, now());
    if (!r.changes) return false;
    const act = addActivity(issueId, { kind: 'github' }, 'pr_linked', null, `${pr.repo}#${pr.number}`, { title: pr.title, url: pr.url });
    broadcast({ type: 'activity', issueId, activity: act });
    return true;
  }

  function notePullRequestState(issueId, pr) {
    const act = addActivity(issueId, { kind: 'github' }, 'pr_state', null, pr.state, { repo: pr.repo, number: pr.number, title: pr.title, url: pr.url });
    broadcast({ type: 'activity', issueId, activity: act });
  }

  const issueIdsForPr = (prId) => st('SELECT issue_id FROM issue_prs WHERE pr_id = ?').all(prId).map((r) => r.issue_id);
  const prsForIssue = (issueId) => st(`SELECT p.* FROM issue_prs ip JOIN pull_requests p ON p.id = ip.pr_id WHERE ip.issue_id = ?`).all(issueId).map(serializePr);
  const refreshIssue = (issueId) => {
    const issue = getIssueById(issueId);
    if (issue) broadcast({ type: 'issue', issue });
    return issue;
  };

  // ── bootstrap ──────────────────────────────────────────────────────────
  function bootstrap(user) {
    return {
      version,
      me: serializeUser(userRow(user.id)),
      team: team(),
      statuses: statuses(),
      users: listUsers(),
      labels: listLabels(),
      projects: listProjects(),
      cycles: cycles(),
      issues: listIssues(),
    };
  }

  return {
    db, statuses, statusById, statusByName, team, updateTeam, identifier, parseIdentifier, currentCycle, cycles, rollOverCycles,
    serializeUser, listUsers, userRow, userByEmail, inviteUser, updateUser, ensureAdmins, recordSignIn,
    createSession, userForSession, deleteSession, listTokens, createToken, revokeToken, userForToken,
    listLabels, createLabel, updateLabel, listProjects, createProject, updateProject,
    listIssues, getIssue, getIssueById, createIssue, updateIssue, deleteIssue, issueDetail, listActivity,
    listComments, addComment, editComment, deleteComment, toggleReaction,
    upsertPullRequest, linkPullRequest, notePullRequestState, issueIdsForPr, prsForIssue, refreshIssue,
    bootstrap, slugify, DONE_TYPES,
  };
}
