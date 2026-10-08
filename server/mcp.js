// MCP over Streamable HTTP, tools only, stateless: POST /mcp with a personal token.
// Claude acts as the token's owner, so an issue or comment it writes is authored by them.
//
//   claude mcp add --transport http duy-my-linear https://<host>/mcp --header "Authorization: Bearer plumb_…"
//
// Tool names and argument shapes follow the Linear MCP, so habits carry over.
import { config } from './config.js';
import { authenticate } from './auth.js';
import { readBody, sendJson, slugify, HttpError } from './util.js';
import { PRIORITIES } from './store.js';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export function createMcp(store, { version }) {
  const issueUrl = (identifier) => `${config.publicUrl}/issue/${identifier}`;

  // ── resolvers: names in, ids out ─────────────────────────────────────────
  function resolveUser(v, me) {
    if (v === null) return null;
    const s = String(v).trim().replace(/^@/, '').toLowerCase();
    if (s === 'me') return me.id;
    const users = store.listUsers().filter((u) => u.active);
    const hit = users.filter((u) => u.email.toLowerCase() === s || (u.handle || '').toLowerCase() === s || u.name.toLowerCase() === s);
    const loose = hit.length ? hit : users.filter((u) => u.name.toLowerCase().split(/\s+/)[0] === s);
    if (loose.length === 1) return loose[0].id;
    throw new Error(`No single member matches "${v}". Members: ${users.map((u) => `${u.name} (@${u.handle}, ${u.email})`).join('; ')}`);
  }
  function resolveStatus(v) {
    const s = store.statusByName(v) || store.statuses().find((x) => x.type === String(v).toLowerCase());
    if (!s) throw new Error(`No status "${v}". Statuses: ${store.statuses().map((x) => x.name).join(', ')}`);
    return s.id;
  }
  function resolveProject(v) {
    if (v === null) return null;
    const p = store.listProjects().find((x) => !x.archived && (x.name.toLowerCase() === String(v).toLowerCase() || String(x.id) === String(v)));
    if (!p) throw new Error(`No project "${v}". Projects: ${store.listProjects().filter((x) => !x.archived).map((x) => x.name).join(', ')}`);
    return p.id;
  }
  function resolveLabels(list) {
    if (!Array.isArray(list)) throw new Error('labels is a list of label names');
    const labels = store.listLabels().filter((l) => !l.archived);
    return list.map((name) => {
      const l = labels.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
      if (!l) throw new Error(`No label "${name}". Labels: ${labels.map((x) => x.name).join(', ')}`);
      return l.id;
    });
  }
  function resolveCycle(v) {
    if (v === null) return null;
    const cur = store.currentCycle();
    const s = String(v).trim().toLowerCase().replace(/^cycle\s*/, '');
    if (s === 'current') return cur;
    if (s === 'next') return cur + 1;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1) throw new Error('cycle is "current", "next", a cycle number, or null');
    return n;
  }
  function resolvePriority(v) {
    if (typeof v === 'number' || /^\d$/.test(String(v))) return Number(v);
    const i = { none: 0, 'no priority': 0, urgent: 1, high: 2, medium: 3, low: 4 }[String(v).toLowerCase()];
    if (i === undefined) throw new Error('priority is 0-4 or none/urgent/high/medium/low');
    return i;
  }
  function resolveIssue(ref) {
    const n = store.parseIdentifier(ref);
    const issue = n === null ? null : store.getIssue(n);
    if (!issue) throw new Error(`No issue ${ref}`);
    return issue;
  }

  // ── output shapes ────────────────────────────────────────────────────────
  // one pass over the small tables per call, not per issue
  function lookups() {
    return {
      users: new Map(store.listUsers().map((u) => [u.id, u])),
      labels: new Map(store.listLabels().map((l) => [l.id, l])),
      projects: new Map(store.listProjects().map((p) => [p.id, p])),
      statuses: new Map(store.statuses().map((s) => [s.id, s])),
      identifiers: new Map(store.listIssues().map((x) => [x.id, x.identifier])),
    };
  }

  function brief(i, L) {
    return {
      id: i.identifier,
      title: i.title,
      status: L.statuses.get(i.statusId)?.name,
      priority: { value: i.priority, name: PRIORITIES[i.priority] },
      assignee: i.assigneeId ? L.users.get(i.assigneeId)?.name : null,
      project: i.projectId ? L.projects.get(i.projectId)?.name ?? null : null,
      cycle: i.cycle,
      labels: i.labelIds.map((id) => L.labels.get(id)?.name).filter(Boolean),
      estimate: i.estimate,
      dueDate: i.dueDate,
      parent: i.parentId ? L.identifiers.get(i.parentId) ?? null : null,
      pullRequests: i.prs.map((p) => ({ ref: `${p.repo}#${p.number}`, title: p.title, state: p.draft && p.state === 'open' ? 'draft' : p.state, url: p.url })),
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      url: issueUrl(i.identifier),
    };
  }

  const branchName = (issue, user) => `${user.git_handle || user.email.split('@')[0]}/${issue.identifier.toLowerCase()}-${slugify(issue.title)}`;

  function full(issue, me) {
    const L = lookups();
    const users = L.users;
    const { comments, activity } = store.issueDetail(issue.number);
    const children = store.listIssues().filter((x) => x.parentId === issue.id);
    return {
      ...brief(issue, L),
      description: issue.description,
      creator: issue.creatorId ? users.get(issue.creatorId)?.name : null,
      gitBranchName: branchName(issue, me),
      subIssues: children.map((c) => ({ id: c.identifier, title: c.title, status: store.statusById(c.statusId)?.name })),
      comments: comments.map((c) => ({ id: c.id, author: users.get(c.userId)?.name, body: c.body, createdAt: c.createdAt, reactions: c.reactions.map((r) => `${r.emoji} ${r.userIds.length}`) })),
      activity: activity.map((a) => ({ at: a.createdAt, by: a.actorName, kind: a.kind, from: a.from, to: a.to })),
    };
  }

  // ── tools ────────────────────────────────────────────────────────────────
  const str = (description) => ({ type: 'string', description });
  const key = store.team().key;
  const tools = [
    {
      name: 'list_issues',
      description: `List issues (${key}-<n>), newest activity first. Filters combine. Use assignee "me" for your own.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: str(`Text to find in the title or description, or an issue id like ${key}-80`),
          assignee: { type: ['string', 'null'], description: '"me", a handle, email or name; null for unassigned' },
          state: str('Status name (Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate) or type (backlog, unstarted, started, completed, canceled)'),
          priority: { type: ['number', 'string'], description: '0 none, 1 urgent, 2 high, 3 medium, 4 low (or the name)' },
          label: str('Label name'),
          project: str('Project name'),
          cycle: { type: ['number', 'string'], description: 'Cycle number, or "current" / "next"' },
          parentId: str(`Only sub-issues of this issue, e.g. ${key}-80`),
          includeClosed: { type: 'boolean', description: 'Include Done/Canceled/Duplicate issues (default true)' },
          limit: { type: 'number', description: 'Max results (default 50, max 250)' },
          orderBy: { type: 'string', enum: ['updatedAt', 'createdAt'], description: 'Default updatedAt' },
        },
      },
      annotations: { readOnlyHint: true },
      run(a, me) {
        let list = store.listIssues();
        const statusFilter = a.state ? resolveStatus(a.state) : null;
        const statusType = a.state && !store.statusByName(a.state) ? String(a.state).toLowerCase() : null;
        if (a.query) {
          const q = String(a.query).toLowerCase().trim();
          const n = store.parseIdentifier(q);
          list = list.filter((i) => (n !== null && i.number === n) || i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
        }
        if (a.assignee !== undefined) {
          const id = a.assignee === null || a.assignee === 'null' ? null : resolveUser(a.assignee, me);
          list = list.filter((i) => i.assigneeId === id);
        }
        if (statusType) list = list.filter((i) => store.statusById(i.statusId).type === statusType);
        else if (statusFilter) list = list.filter((i) => i.statusId === statusFilter);
        if (a.priority !== undefined) { const p = resolvePriority(a.priority); list = list.filter((i) => i.priority === p); }
        if (a.label) { const [lid] = resolveLabels([a.label]); list = list.filter((i) => i.labelIds.includes(lid)); }
        if (a.project) { const pid = resolveProject(a.project); list = list.filter((i) => i.projectId === pid); }
        if (a.cycle !== undefined && a.cycle !== null) { const c = resolveCycle(a.cycle); list = list.filter((i) => i.cycle === c); }
        if (a.parentId) { const parent = resolveIssue(a.parentId); list = list.filter((i) => i.parentId === parent.id); }
        if (a.includeClosed === false) list = list.filter((i) => !store.DONE_TYPES.has(store.statusById(i.statusId).type));
        const key = a.orderBy === 'createdAt' ? 'createdAt' : 'updatedAt';
        list.sort((x, y) => (y[key] > x[key] ? 1 : -1));
        const limit = Math.min(250, Math.max(1, Number(a.limit) || 50));
        const L = lookups();
        return { total: list.length, issues: list.slice(0, limit).map((i) => brief(i, L)) };
      },
    },
    {
      name: 'get_issue',
      description: 'Get one issue in full: description, comments, sub-issues, pull requests, activity and the git branch name to use.',
      inputSchema: { type: 'object', properties: { id: str(`Issue id, e.g. ${key}-80`) }, required: ['id'] },
      annotations: { readOnlyHint: true },
      run: (a, me) => full(resolveIssue(a.id), me),
    },
    {
      name: 'save_issue',
      description: 'Create an issue (omit id; title required) or update one (pass id). Only the fields you pass change. Descriptions are markdown; mention teammates as @handle.',
      inputSchema: {
        type: 'object',
        properties: {
          id: str(`Issue to update, e.g. ${key}-80. Omit to create.`),
          title: str('Title'),
          description: str('Markdown description (replaces the whole description)'),
          state: str('Status name, e.g. "In Progress"'),
          priority: { type: ['number', 'string'], description: '0 none, 1 urgent, 2 high, 3 medium, 4 low' },
          assignee: { type: ['string', 'null'], description: '"me", a handle, email or name; null to unassign' },
          project: { type: ['string', 'null'], description: 'Project name; null to remove' },
          cycle: { type: ['number', 'string', 'null'], description: 'Cycle number, "current" or "next"; null to remove' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Label names; replaces the issue\'s labels' },
          parentId: { type: ['string', 'null'], description: 'Parent issue id (makes this a sub-issue); null to detach' },
          estimate: { type: ['number', 'null'], description: 'Estimate points; null to clear' },
          dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD; null to clear' },
        },
      },
      run(a, me) {
        const input = {};
        if (a.title !== undefined) input.title = a.title;
        if (a.description !== undefined) input.description = a.description;
        if (a.state !== undefined) input.statusId = resolveStatus(a.state);
        if (a.priority !== undefined) input.priority = resolvePriority(a.priority);
        if (a.assignee !== undefined) input.assigneeId = resolveUser(a.assignee, me);
        if (a.project !== undefined) input.projectId = resolveProject(a.project);
        if (a.cycle !== undefined) input.cycle = resolveCycle(a.cycle);
        if (a.labels !== undefined) input.labelIds = resolveLabels(a.labels);
        if (a.parentId !== undefined) input.parentId = a.parentId === null ? null : resolveIssue(a.parentId).id;
        if (a.estimate !== undefined) input.estimate = a.estimate;
        if (a.dueDate !== undefined) input.dueDate = a.dueDate;
        const actor = { kind: 'user', user: me };
        const issue = a.id ? store.updateIssue(actor, resolveIssue(a.id).number, input) : store.createIssue(actor, input);
        return brief(issue, lookups());
      },
    },
    {
      name: 'save_comment',
      description: 'Add a markdown comment to an issue, or edit one of your own comments (pass id).',
      inputSchema: {
        type: 'object',
        properties: { issueId: str(`Issue id, e.g. ${key}-80 (to add)`), id: { type: 'number', description: 'Comment id (to edit your own)' }, body: str('Markdown body') },
        required: ['body'],
      },
      run(a, me) {
        const actor = { kind: 'user', user: me };
        if (a.id !== undefined) return store.editComment(actor, a.id, a.body);
        if (!a.issueId) throw new Error('issueId is required to add a comment');
        return store.addComment(actor, resolveIssue(a.issueId).number, a.body);
      },
    },
    {
      name: 'list_comments',
      description: 'List the comments on an issue, oldest first.',
      inputSchema: { type: 'object', properties: { issueId: str(`Issue id, e.g. ${key}-80`) }, required: ['issueId'] },
      annotations: { readOnlyHint: true },
      run(a) {
        const users = new Map(store.listUsers().map((u) => [u.id, u]));
        return { comments: store.listComments(resolveIssue(a.issueId).id).map((c) => ({ id: c.id, author: users.get(c.userId)?.name, body: c.body, createdAt: c.createdAt })) };
      },
    },
    {
      name: 'list_issue_statuses',
      description: 'The team\'s statuses in workflow order.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run: () => ({ statuses: store.statuses().map((s) => ({ name: s.name, type: s.type })) }),
    },
    {
      name: 'list_issue_labels',
      description: 'The labels you can put on issues.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run: () => ({ labels: store.listLabels().filter((l) => !l.archived).map((l) => ({ name: l.name, color: l.color, description: l.description })) }),
    },
    {
      name: 'list_projects',
      description: 'The team\'s projects.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run: () => ({ projects: store.listProjects().filter((p) => !p.archived).map((p) => ({ name: p.name, description: p.description })) }),
    },
    {
      name: 'list_cycles',
      description: 'Weekly cycles: recent, current and upcoming, with their dates.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run: () => store.cycles(),
    },
    {
      name: 'list_users',
      description: 'Team members, with the @handle to mention them by.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run: () => ({ users: store.listUsers().filter((u) => u.active).map((u) => ({ name: u.name, handle: u.handle, email: u.email, role: u.role })) }),
    },
  ];

  const instructions = `Duy My Linear is the ${store.team().name} team's issue tracker, a minimal Linear. Issues are ${key}-<number>. `
    + 'Descriptions and comments are markdown. Mention teammates as @handle (list_users). '
    + 'A pull request whose branch or title contains the issue id links itself; use get_issue for the branch name.';

  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  async function dispatch(msg, me) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg?.id ?? null, -32600, 'Invalid request');
    }
    const isNotification = !('id' in msg);
    const ok = (result) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'plumb', title: 'Duy My Linear', version },
          instructions,
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })) });
      case 'tools/call': {
        const tool = tools.find((t) => t.name === msg.params?.name);
        if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
        try {
          const out = await tool.run(msg.params?.arguments || {}, me);
          return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
        } catch (e) {
          return ok({ content: [{ type: 'text', text: e.message }], isError: true });
        }
      }
      default:
        if (isNotification) return null; // notifications/initialized, notifications/cancelled, …
        return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  return async function handleMcp(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' }, { allow: 'POST' });
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== new URL(config.publicUrl).host) throw new HttpError(403, 'Origin not allowed');
    const auth = authenticate(store, req);
    if (!auth || auth.via !== 'token') {
      return sendJson(res, 401, { error: 'Pass a Duy My Linear token: Authorization: Bearer plumb_… (Settings → API tokens)' }, { 'www-authenticate': 'Bearer' });
    }
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return sendJson(res, 400, rpcError(null, -32700, 'Parse error')); }
    const user = auth.user;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => dispatch(m, user)))).filter(Boolean);
      if (!out.length) { res.writeHead(202); return res.end(); }
      return sendJson(res, 200, out);
    }
    const out = await dispatch(body, user);
    if (!out) { res.writeHead(202); return res.end(); }
    return sendJson(res, 200, out);
  };
}
