import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signIn, webhook, prPayload, callTool, ADMIN } from './helpers.mjs';

let env, alice, bob, carol, ids, eng, eng1;

// collect what one member's live stream receives while `act` runs
async function streamOf(email, act) {
  const r = await fetch(`${env.base}/auth/dev/as?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const ctrl = new AbortController();
  const stream = await fetch(`${env.base}/api/events`, { headers: { cookie }, signal: ctrl.signal });
  const reader = stream.body.getReader();
  const seen = [];
  let buf = '';
  const reading = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += new TextDecoder().decode(value);
        for (const m of buf.matchAll(/data: (.+)\n\n/g)) seen.push(JSON.parse(m[1]));
        buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
      }
    } catch { /* aborted */ }
  })();
  await new Promise((ok) => setTimeout(ok, 50));
  await act();
  await new Promise((ok) => setTimeout(ok, 300));
  ctrl.abort();
  await reading;
  return seen;
}

before(async () => {
  env = await boot();
  alice = await signIn(env.base, ADMIN);
  for (const e of ['bob@test.dev', 'carol@test.dev']) await alice.post('/api/members', { email: e });
  bob = await signIn(env.base, 'bob@test.dev');
  carol = await signIn(env.base, 'carol@test.dev');
  ids = Object.fromEntries((await alice.get('/api/members')).body.users.map((u) => [u.email.split('@')[0], u.id]));
  eng = (await alice.post('/api/teams', { name: 'Engineering', key: 'ENG' })).body;
  eng1 = (await alice.post('/api/issues', { title: 'Secret plan', teamId: eng.id, assigneeId: ids.bob })).body;
});
after(() => env.close());

test('going private keeps everyone who could see the team, until someone is unticked', async () => {
  const r = await alice.patch('/api/teams/ENG', { private: true });
  assert.equal(r.body.private, true);
  assert.deepEqual(r.body.memberIds, [ids.alice, ids.bob, ids.carol]);
  assert.equal((await bob.get('/api/issues/ENG-1')).status, 200);
  assert.equal((await bob.patch('/api/teams/ENG', { memberIds: [ids.bob] })).status, 403, 'only admins change who is in');
});

test('a member taken out sees none of the team, wherever they look, and comes off its issues', async () => {
  const c = (await bob.post('/api/issues/ENG-1/comments', { body: 'mine' })).body;
  await alice.patch('/api/teams/ENG', { memberIds: [ids.alice, ids.carol] });
  const boot = (await bob.get('/api/bootstrap')).body;
  assert.ok(!boot.teams.some((t) => t.key === 'ENG'));
  assert.ok(!boot.issues.some((i) => i.teamId === eng.id));
  assert.ok(!(await bob.get('/api/issues')).body.issues.some((i) => i.teamId === eng.id));
  assert.equal((await bob.get('/api/issues/ENG-1')).status, 404);
  assert.equal((await bob.patch('/api/issues/ENG-1', { title: 'x' })).status, 404);
  assert.equal((await bob.del('/api/issues/ENG-1')).status, 404);
  assert.equal((await bob.post('/api/issues/ENG-1/comments', { body: 'x' })).status, 404);
  assert.equal((await bob.patch(`/api/comments/${c.id}`, { body: 'x' })).status, 404);
  assert.equal((await bob.post(`/api/comments/${c.id}/reactions`, { emoji: '👍' })).status, 404);
  assert.equal((await bob.post('/api/issues', { title: 'x', teamId: eng.id })).status, 400);
  assert.equal((await bob.post('/api/issues', { title: 'x', parentId: eng1.id })).status, 400, 'nor hang an issue under one of its issues');
  // as in Linear, losing sight of a team takes you off its issues
  const detail = (await alice.get('/api/issues/ENG-1')).body;
  assert.equal(detail.issue.assigneeId, null);
  assert.deepEqual([detail.activity.at(-1).kind, detail.activity.at(-1).actorKind], ['assignee', 'system']);
  const r = await alice.patch('/api/issues/ENG-1', { assigneeId: ids.bob });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /isn't a member of Engineering/);
});

test('a bare number only counts the issues you can see', async () => {
  const ops = (await alice.post('/api/teams', { name: 'Ops', key: 'OPS' })).body;
  await alice.post('/api/issues', { title: 'Ops one', teamId: ops.id });
  assert.equal((await bob.get('/api/issues/1')).body.issue.identifier, 'OPS-1', 'ENG-1 is not there for bob');
  assert.equal((await alice.get('/api/issues/1')).status, 404, 'alice sees both, so 1 is ambiguous');
});

test('an admin outside a private team sees it in Settings, not its issues, and can add themselves', async () => {
  await alice.patch('/api/teams/ENG', { memberIds: [ids.carol] });
  const listed = (await alice.get('/api/teams')).body.teams.find((t) => t.key === 'ENG');
  assert.deepEqual([listed.private, listed.canSee], [true, false]);
  assert.ok(!(await alice.get('/api/bootstrap')).body.teams.some((t) => t.key === 'ENG'));
  assert.equal((await alice.get('/api/issues/ENG-1')).status, 404);
  assert.ok(!(await bob.get('/api/teams')).body.teams.some((t) => t.key === 'ENG'), 'a member never learns it exists');
  await alice.patch('/api/teams/ENG', { memberIds: [ids.alice, ids.carol] });
  assert.equal((await alice.get('/api/issues/ENG-1')).status, 200);
});

test('live updates: a private team\'s news reaches only its members; a new member is told to re-fetch', async () => {
  const bobSaw = await streamOf('bob@test.dev', async () => {
    await alice.patch('/api/issues/ENG-1', { title: 'Secret plan, revised' });
    await carol.post('/api/issues/ENG-1/comments', { body: 'shh' });
    await alice.post('/api/issues', { title: 'Open news' });
  });
  assert.ok(!JSON.stringify(bobSaw).includes('Secret plan'), 'nothing about ENG-1');
  assert.ok(!bobSaw.some((e) => e.type === 'comment'));
  assert.ok(bobSaw.some((e) => e.type === 'issue' && e.issue.title === 'Open news'), 'open teams still reach him');
  const carolSaw = await streamOf('carol@test.dev', () => alice.patch('/api/issues/ENG-1', { title: 'Secret plan, v3' }));
  assert.ok(carolSaw.some((e) => e.type === 'issue' && e.issue.title === 'Secret plan, v3'));

  const added = await streamOf('bob@test.dev', () => alice.patch('/api/teams/ENG', { memberIds: [ids.alice, ids.bob, ids.carol] }));
  assert.ok(added.find((e) => e.type === 'teams').teams.some((t) => t.key === 'ENG'));
  assert.ok(added.some((e) => e.type === 'resync'));
  const removed = await streamOf('bob@test.dev', () => alice.patch('/api/teams/ENG', { memberIds: [ids.alice, ids.carol] }));
  assert.ok(!removed.find((e) => e.type === 'teams').teams.some((t) => t.key === 'ENG'));
});

test('MCP: to Claude acting as a non-member, a private team does not exist', async () => {
  const token = (await bob.post('/api/tokens', { name: 'claude' })).body.token;
  assert.ok(!(await callTool(env.base, token, 'list_teams', {})).data.teams.some((t) => t.key === 'ENG'));
  assert.equal((await callTool(env.base, token, 'get_issue', { id: 'ENG-1' })).isError, true);
  const filing = await callTool(env.base, token, 'save_issue', { title: 'x', team: 'ENG' });
  assert.equal(filing.isError, true);
  assert.match(filing.data, /No team "ENG"/);
  const all = await callTool(env.base, token, 'list_issues', { limit: 250 });
  assert.ok(!all.data.issues.some((i) => i.id.startsWith('ENG-')));
  const carolToken = (await carol.post('/api/tokens', { name: 'claude' })).body.token;
  assert.equal((await callTool(env.base, carolToken, 'get_issue', { id: 'ENG-1' })).data.title, 'Secret plan, v3');
});

test('a team made private from the start has only its maker; GitHub still links its PRs', async () => {
  const sec = (await alice.post('/api/teams', { name: 'Security', key: 'SEC', private: true })).body;
  assert.deepEqual(sec.memberIds, [ids.alice]);
  assert.ok(!(await bob.get('/api/bootstrap')).body.teams.some((t) => t.key === 'SEC'));
  await alice.post('/api/issues', { title: 'Rotate keys', teamId: sec.id });
  const r = await webhook(env.base, 'pull_request', prPayload({ number: 9, title: 'SEC-1 rotate', branch: 'x' }));
  assert.equal(r.body.linked, 1);
});
