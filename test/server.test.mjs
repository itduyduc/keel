import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signIn, client, webhook, prPayload, mcp, callTool, ADMIN } from './helpers.mjs';
import { cycleNumberAt, cycleRange, zonedMidnight } from '../server/cycles.js';

let env, alice, bob;
const status = (name) => env.app.store.statusByName(name).id;

before(async () => {
  env = await boot({ web: true });
  alice = await signIn(env.base, ADMIN);
  await alice.post('/api/members', { email: 'bob@test.dev' });
  bob = await signIn(env.base, 'bob@test.dev');
});
after(() => env.close());

test('a fresh database is the team from config, Linear-shaped statuses, and no projects', async () => {
  const { body } = await alice.get('/api/bootstrap');
  assert.equal(body.team.key, 'PIC');
  assert.equal(body.team.name, 'Acme');
  assert.deepEqual(body.statuses.map((s) => s.name), ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate']);
  assert.deepEqual(body.labels.map((l) => l.name).sort(), ['Bug', 'Feature', 'Improvement']);
  assert.deepEqual(body.projects, []);
  assert.equal(body.me.role, 'admin');
  assert.equal(body.team.estimateScale, 'fibonacci');
  await alice.post('/api/projects', { name: 'Biz' });   // the MCP test below files an issue under it
});

test('numbering starts where the team says (79 here), so no number means two things', async () => {
  const { body } = await alice.post('/api/issues', { title: 'First Duy My Linear issue' });
  assert.equal(body.identifier, 'PIC-79');
  assert.equal(body.statusId, status('Backlog'));
  const second = await alice.post('/api/issues', { title: 'Second' });
  assert.equal(second.body.identifier, 'PIC-80');
});

test('every property change lands in the activity trail with who and what', async () => {
  const { body: issue } = await alice.post('/api/issues', { title: 'Trail me', priority: 3 });
  const me = (await alice.get('/api/me')).body;
  const [bug] = (await alice.get('/api/labels')).body.labels.filter((l) => l.name === 'Bug');
  const r = await alice.patch(`/api/issues/${issue.identifier}`, {
    statusId: status('In Progress'), priority: 1, assigneeId: me.id, cycle: 5, labelIds: [bug.id], estimate: 3, dueDate: '2026-10-09',
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.startedAt, 'In Progress stamps startedAt');
  const kinds = (await alice.get(`/api/issues/${issue.number}`)).body.activity.map((a) => `${a.kind}:${a.from ?? ''}→${a.to ?? ''}`);
  assert.deepEqual(kinds, [
    'created:→', 'status:Backlog→In Progress', 'priority:Medium→Urgent', `assignee:→${me.name}`,
    'cycle:→5', 'estimate:→3', 'due_date:→2026-10-09', 'label_added:→Bug',
  ]);
  const done = await alice.patch(`/api/issues/${issue.identifier}`, { statusId: status('Done') });
  assert.ok(done.body.completedAt);
  const reopened = await alice.patch(`/api/issues/${issue.identifier}`, { statusId: status('Todo') });
  assert.equal(reopened.body.completedAt, null);
  assert.equal(reopened.body.startedAt, null);
});

test('autosaving a description logs one activity line per sitting, not one per pause', async () => {
  const { body: issue } = await alice.post('/api/issues', { title: 'Autosave me' });
  for (const text of ['D', 'Dr', 'Draft', 'Draft done']) await alice.patch(`/api/issues/${issue.identifier}`, { description: text });
  const detail = (await alice.get(`/api/issues/${issue.identifier}`)).body;
  assert.equal(detail.issue.description, 'Draft done');
  assert.equal(detail.activity.filter((a) => a.kind === 'description').length, 1);
  // someone else editing is their own line
  await bob.patch(`/api/issues/${issue.identifier}`, { description: 'Draft done, reviewed' });
  const after = (await alice.get(`/api/issues/${issue.identifier}`)).body;
  assert.equal(after.activity.filter((a) => a.kind === 'description').length, 2);
});

test('bad input is refused with a reason', async () => {
  assert.equal((await alice.post('/api/issues', { title: '  ' })).status, 400);
  assert.equal((await alice.post('/api/issues', { title: 'x', priority: 9 })).status, 400);
  assert.equal((await alice.post('/api/issues', { title: 'x', dueDate: 'tomorrow' })).status, 400);
  assert.equal((await alice.post('/api/issues', { title: 'x', statusId: 999 })).status, 400);
  assert.equal((await alice.get('/api/issues/PIC-999')).status, 404);
  assert.equal((await alice.get('/api/issues/ENG-79')).status, 404);
});

test('sub-issues cannot loop back on themselves', async () => {
  const parent = (await alice.post('/api/issues', { title: 'Parent' })).body;
  const child = (await alice.post('/api/issues', { title: 'Child', parentId: parent.id })).body;
  assert.equal(child.parentId, parent.id);
  const loop = await alice.patch(`/api/issues/${parent.identifier}`, { parentId: child.id });
  assert.equal(loop.status, 400);
  const self = await alice.patch(`/api/issues/${parent.identifier}`, { parentId: parent.id });
  assert.equal(self.status, 400);
  // deleting the parent frees the child rather than orphaning it
  await alice.del(`/api/issues/${parent.identifier}`);
  const after = (await alice.get(`/api/issues/${child.identifier}`)).body.issue;
  assert.equal(after.parentId, null);
});

test('comments, edits and reactions, each by their owner only', async () => {
  const issue = (await alice.post('/api/issues', { title: 'Talk about it' })).body;
  const c = (await alice.post(`/api/issues/${issue.identifier}/comments`, { body: 'Hey @bob, **look**' })).body;
  assert.equal(c.body, 'Hey @bob, **look**');
  assert.equal((await bob.patch(`/api/comments/${c.id}`, { body: 'hijack' })).status, 403);
  const edited = (await alice.patch(`/api/comments/${c.id}`, { body: 'Hey @bob, look again' })).body;
  assert.ok(edited.editedAt);
  await bob.post(`/api/comments/${c.id}/reactions`, { emoji: '👍' });
  const both = (await alice.post(`/api/comments/${c.id}/reactions`, { emoji: '👍' })).body;
  assert.equal(both.reactions[0].userIds.length, 2);
  const undone = (await alice.post(`/api/comments/${c.id}/reactions`, { emoji: '👍' })).body;
  assert.equal(undone.reactions[0].userIds.length, 1);
  assert.equal((await alice.post(`/api/issues/${issue.identifier}/comments`, { body: '   ' })).status, 400);
});

test('only invited emails get in, and only admins invite', async () => {
  const r = await fetch(`${env.base}/auth/dev/as?email=stranger@test.dev`, { redirect: 'manual' });
  assert.equal(r.status, 403);
  assert.equal((await bob.post('/api/members', { email: 'friend@test.dev' })).status, 403);
  assert.equal((await fetch(`${env.base}/api/bootstrap`)).status, 401);
});

test('cookie requests need the X-Requested-With header (CSRF)', async () => {
  const r = await fetch(`${env.base}/auth/dev/as?email=${ADMIN}`, { redirect: 'manual' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const naked = await fetch(`${env.base}/api/issues`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"title":"csrf"}' });
  assert.equal(naked.status, 403);
});

test('a personal token works as a bearer and dies when revoked', async () => {
  const { body } = await alice.post('/api/tokens', { name: 'test' });
  assert.match(body.token, /^plumb_/);
  const bearer = client(env.base, { authorization: `Bearer ${body.token}` });
  assert.equal((await bearer.get('/api/me')).body.email, ADMIN);
  // a bearer needs no CSRF header: other sites cannot send one
  assert.equal((await bearer.post('/api/issues', { title: 'via token' })).status, 200);
  await alice.del(`/api/tokens/${body.tokens[0].id}`);
  assert.equal((await bearer.get('/api/me')).status, 401);
});

test('the Mac sign-in hands back a one-time code the shell exchanges for a cookie', async () => {
  const r = await fetch(`${env.base}/auth/dev/as?client=mac&email=${ADMIN}`, { redirect: 'manual' });
  const loc = r.headers.get('location');
  assert.match(loc, /^plumb:\/\/auth\?code=/);
  const code = new URL(loc).searchParams.get('code');
  const ex = await fetch(`${env.base}/auth/exchange?code=${code}`, { redirect: 'manual' });
  assert.equal(ex.status, 302);
  assert.match(ex.headers.get('set-cookie'), /plumb_session=/);
  const again = await fetch(`${env.base}/auth/exchange?code=${code}`, { redirect: 'manual' });
  assert.equal(again.status, 400, 'a code works once');
});

test('MCP: Claude creates, updates and comments as the token owner', async () => {
  const token = (await alice.post('/api/tokens', { name: 'claude' })).body.token;
  const init = await mcp(env.base, token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal((await mcp(env.base, token, 'notifications/initialized', undefined, null)).status, 202);
  const tools = (await mcp(env.base, token, 'tools/list', {})).body.result.tools.map((t) => t.name);
  for (const t of ['list_issues', 'get_issue', 'save_issue', 'save_comment', 'list_comments', 'list_users']) assert.ok(tools.includes(t), t);

  const created = await callTool(env.base, token, 'save_issue', {
    title: 'From Claude', description: '## Plan\n\n- a\n- b', state: 'Todo', priority: 'high', assignee: 'me',
    project: 'Biz', labels: ['Feature'], cycle: 'current', estimate: 5,
  });
  assert.equal(created.isError, false, created.data);
  assert.equal(created.data.status, 'Todo');
  assert.equal(created.data.assignee, env.app.store.userByEmail(ADMIN).name || 'alice');
  assert.deepEqual(created.data.labels, ['Feature']);

  const updated = await callTool(env.base, token, 'save_issue', { id: created.data.id, state: 'In Progress', assignee: 'bob' });
  assert.equal(updated.data.status, 'In Progress');

  const comment = await callTool(env.base, token, 'save_comment', { issueId: created.data.id, body: 'Picked this up' });
  assert.equal(comment.isError, false);
  const full = await callTool(env.base, token, 'get_issue', { id: created.data.id });
  assert.equal(full.data.comments.at(-1).body, 'Picked this up');
  assert.match(full.data.gitBranchName, new RegExp(`^alice/${created.data.id.toLowerCase()}-from-claude$`));

  const mine = await callTool(env.base, token, 'list_issues', { assignee: 'bob', state: 'started' });
  assert.ok(mine.data.issues.some((i) => i.id === created.data.id));

  const oops = await callTool(env.base, token, 'save_issue', { id: created.data.id, state: 'Shipped' });
  assert.equal(oops.isError, true);
  assert.match(oops.data, /Statuses: Backlog/);

  const noToken = await fetch(`${env.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noToken.status, 401);
});

test('GitHub: a PR naming the issue links itself, and status follows it', async () => {
  const issue = (await alice.post('/api/issues', { title: 'Wire the PR loop', statusId: status('In Progress') })).body;
  const branch = `octocat/${issue.identifier.toLowerCase()}-wire-the-pr-loop`;

  const bad = await webhook(env.base, 'pull_request', prPayload({ number: 12, title: 'x', branch }), 'wrong-secret');
  assert.equal(bad.status, 401);

  // a draft links but moves nothing
  await webhook(env.base, 'pull_request', prPayload({ number: 12, title: 'Wire it', branch, draft: true }));
  let now = (await alice.get(`/api/issues/${issue.identifier}`)).body;
  assert.equal(now.issue.prs.length, 1);
  assert.equal(now.issue.statusId, status('In Progress'));

  // ready for review → In Review
  await webhook(env.base, 'pull_request', prPayload({ number: 12, title: 'Wire it', branch, action: 'ready_for_review' }));
  now = (await alice.get(`/api/issues/${issue.identifier}`)).body;
  assert.equal(now.issue.statusId, status('In Review'));

  // a second open PR (named in the title) holds Done back until it closes
  await webhook(env.base, 'pull_request', prPayload({ number: 13, title: `${issue.identifier}: follow-up`, branch: 'other' }));
  await webhook(env.base, 'pull_request', prPayload({ number: 12, title: 'Wire it', branch, merged: true, action: 'closed' }));
  now = (await alice.get(`/api/issues/${issue.identifier}`)).body;
  assert.equal(now.issue.statusId, status('In Review'), 'waits for every linked PR');

  // closing the other one unmerged releases it: one merged, none open → Done
  await webhook(env.base, 'pull_request', prPayload({ number: 13, title: `${issue.identifier}: follow-up`, branch: 'other', state: 'closed', action: 'closed' }));
  now = (await alice.get(`/api/issues/${issue.identifier}`)).body;
  assert.equal(now.issue.statusId, status('Done'));
  const kinds = now.activity.map((a) => a.kind);
  assert.ok(kinds.includes('pr_linked'));
  assert.ok(now.activity.some((a) => a.kind === 'status' && a.actorKind === 'github' && a.to === 'Done'));

  // reopening a PR never drags a Done issue backwards
  await webhook(env.base, 'pull_request', prPayload({ number: 13, title: `${issue.identifier}: follow-up`, branch: 'other', action: 'reopened' }));
  now = (await alice.get(`/api/issues/${issue.identifier}`)).body;
  assert.equal(now.issue.statusId, status('Done'));
});

test('GitHub: numbers from before the move and look-alikes never link', async () => {
  const gh = env.app.github;
  assert.deepEqual(gh.refsIn('octocat/pic-68-mac-status'), [68]);
  assert.deepEqual(gh.refsIn('EPIC-80 and SPIC-81'), []);
  assert.deepEqual(gh.refsIn('PIC-80, pic-81'), [80, 81]);
  // PIC-68 predates this database (the team started at 79), so a PR naming it attaches to nothing
  const r = await webhook(env.base, 'pull_request', prPayload({ number: 246, title: 'Mac: green checks', branch: 'octocat/pic-68-mac-status' }));
  assert.equal(r.body.linked, 0);
  // repos outside the org are ignored
  const other = await webhook(env.base, 'pull_request', prPayload({ number: 1, title: 'PIC-79', branch: 'x', repo: 'someone/else' }));
  assert.equal(other.status, 202);
});

test('cycles: numbered weeks from 2026-08-31 in Pacific time, DST-safe', () => {
  const cfg = { anchor: '2026-08-31', tz: 'America/Los_Angeles', lengthDays: 7 };
  assert.equal(cycleNumberAt(Date.parse('2026-09-29T19:00:00Z'), cfg), 5);
  // Sunday 11pm Pacific is still the old cycle; midnight Monday is the new one
  assert.equal(cycleNumberAt(Date.parse('2026-10-05T06:59:00Z'), cfg), 5);
  assert.equal(cycleNumberAt(Date.parse('2026-10-05T07:00:00Z'), cfg), 6);
  // clocks go back on 2026-11-01, so the 11-02 boundary is 08:00Z
  assert.equal(cycleRange(10, cfg).startsAt, '2026-11-02T08:00:00.000Z');
  assert.equal(new Date(zonedMidnight('2026-09-28', cfg.tz)).toISOString(), '2026-09-28T07:00:00.000Z');
});

test('cycles: unfinished work rolls into the current cycle, finished work stays', async () => {
  const store = env.app.store;
  const cur = store.currentCycle();
  const open = (await alice.post('/api/issues', { title: 'Unfinished', cycle: cur - 1, statusId: status('Todo') })).body;
  const done = (await alice.post('/api/issues', { title: 'Finished', cycle: cur - 1, statusId: status('Done') })).body;
  store.rollOverCycles();
  assert.equal(store.getIssue(open.number).cycle, cur);
  assert.equal(store.getIssue(done.number).cycle, cur - 1);
  const act = store.issueDetail(open.number).activity.at(-1);
  assert.equal(act.kind, 'rolled_over');
  assert.equal(act.actorKind, 'system');
});

test('the page is served fresh, fingerprinted assets forever, app routes fall back to it', async () => {
  const page = await fetch(`${env.base}/issue/PIC-79`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  const asset = await fetch(`${env.base}/assets/app-abc123.js`);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${env.base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${env.base}/..%2f..%2fetc%2fpasswd`)).status, 404);
});

test('live updates: a change by one member reaches another member\'s stream', async () => {
  const r = await fetch(`${env.base}/auth/dev/as?email=bob@test.dev`, { redirect: 'manual' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const ctrl = new AbortController();
  const stream = await fetch(`${env.base}/api/events`, { headers: { cookie }, signal: ctrl.signal });
  const reader = stream.body.getReader();
  const seen = [];
  const reading = (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += new TextDecoder().decode(value);
      for (const m of buf.matchAll(/data: (.+)\n\n/g)) seen.push(JSON.parse(m[1]));
      buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
      if (seen.some((e) => e.type === 'issue' && e.issue.title === 'Live one')) return;
    }
  })();
  await alice.post('/api/issues', { title: 'Live one' });
  await Promise.race([reading, new Promise((_, no) => setTimeout(() => no(new Error('no live event within 3s')), 3000))]);
  ctrl.abort();
  assert.equal(seen[0].type, 'hello');
  assert.ok(seen.some((e) => e.type === 'issue' && e.issue.title === 'Live one'));
});
