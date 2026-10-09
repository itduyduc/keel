import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boot, signIn, webhook, prPayload, callTool, mcp, ADMIN } from './helpers.mjs';
import { MIGRATIONS, openDb } from '../server/db.js';

let env, alice, bob, eng;

before(async () => {
  env = await boot();
  alice = await signIn(env.base, ADMIN);
  await alice.post('/api/members', { email: 'bob@test.dev' });
  bob = await signIn(env.base, 'bob@test.dev');
});
after(() => env.close());

test('an admin creates a team; its key is checked and its cycles start off, as in Linear', async () => {
  assert.equal((await bob.post('/api/teams', { name: 'Engineering', key: 'ENG' })).status, 403);
  assert.equal((await alice.post('/api/teams', { name: 'Engineering', key: 'EN-G' })).status, 400);
  assert.equal((await alice.post('/api/teams', { name: 'Engineering', key: 'TOOLONG' })).status, 400);
  assert.equal((await alice.post('/api/teams', { name: 'Again', key: 'pic' })).status, 400, 'PIC is taken, in any case');
  assert.equal((await alice.post('/api/teams', { name: 'acme', key: 'ACM' })).status, 400, 'so is the name');
  const r = await alice.post('/api/teams', { name: 'Engineering', key: 'eng', color: '#4cb782' });
  assert.equal(r.status, 200);
  eng = r.body;
  assert.deepEqual([eng.key, eng.name, eng.color, eng.cyclesEnabled], ['ENG', 'Engineering', '#4cb782', false]);
  const boot = (await bob.get('/api/bootstrap')).body;
  assert.deepEqual(boot.teams.map((t) => t.key), ['PIC', 'ENG']);
});

test('each team numbers its own issues from 1, and ids say which team', async () => {
  const pic = (await alice.post('/api/issues', { title: 'In the first team' })).body;
  assert.equal(pic.identifier, 'PIC-79');
  const one = (await alice.post('/api/issues', { title: 'First ENG issue', teamId: eng.id })).body;
  const two = (await alice.post('/api/issues', { title: 'Second ENG issue', teamId: eng.id })).body;
  assert.deepEqual([one.identifier, one.teamId, two.identifier], ['ENG-1', eng.id, 'ENG-2']);
  assert.equal((await alice.get('/api/issues/eng-1')).body.issue.title, 'First ENG issue');
  assert.equal((await alice.post('/api/issues', { title: 'Nowhere', teamId: 999 })).status, 400);
  // a bare number only answers while one team has it
  assert.equal((await alice.get('/api/issues/2')).body.issue.identifier, 'ENG-2');
  await alice.post('/api/teams', { name: 'Design', key: 'DES' });
  const des = (await alice.get('/api/teams')).body.teams.find((t) => t.key === 'DES');
  await alice.post('/api/issues', { title: 'Design one', teamId: des.id });
  assert.equal((await alice.get('/api/issues/1')).status, 404);
  assert.equal((await alice.get('/api/issues/DES-1')).status, 200);
});

test('an issue stays in its team, and a team keeps its key', async () => {
  const r = await alice.patch('/api/issues/ENG-1', { teamId: 1 });
  assert.equal(r.status, 400);
  assert.equal((await alice.patch('/api/teams/ENG', { key: 'ENGR' })).status, 400);
  const renamed = await alice.patch('/api/teams/eng', { name: 'Platform' });
  assert.equal(renamed.body.name, 'Platform');
  assert.equal((await bob.patch('/api/teams/ENG', { name: 'Mine' })).status, 403);
  assert.equal((await alice.get('/api/issues/ENG-1')).body.issue.identifier, 'ENG-1');
});

test('cycles: off refuses a cycle, on takes one, and only teams that run cycles roll over', async () => {
  const store = env.app.store;
  const cur = store.currentCycle();
  const refused = await alice.post('/api/issues', { title: 'Cycled', teamId: eng.id, cycle: cur });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /cycles turned off/);
  assert.equal((await alice.patch('/api/teams/ENG', { cyclesEnabled: true })).body.cyclesEnabled, true);
  const late = (await alice.post('/api/issues', { title: 'Late', teamId: eng.id, cycle: cur - 1 })).body;
  await alice.patch('/api/teams/ENG', { cyclesEnabled: false });
  store.rollOverCycles();
  assert.equal(store.getIssue(late.identifier).cycle, cur - 1, 'cycles off: left where it was');
  await alice.patch('/api/teams/ENG', { cyclesEnabled: true });
  store.rollOverCycles();
  assert.equal(store.getIssue(late.identifier).cycle, cur);
});

test('GitHub links a PR to whichever team its id names', async () => {
  const gh = env.app.github;
  assert.deepEqual(gh.refsIn('octocat/eng-2-fix and PIC-79'), ['ENG-2', 'PIC-79']);
  assert.deepEqual(gh.refsIn('PENG-2'), []);
  const r = await webhook(env.base, 'pull_request', prPayload({ number: 7, title: 'Fix it', branch: 'octocat/eng-2-second' }));
  assert.equal(r.body.linked, 1);
  const issue = (await alice.get('/api/issues/ENG-2')).body.issue;
  assert.equal(issue.prs[0].number, 7);
  assert.equal((await alice.get('/api/issues/PIC-79')).body.issue.prs.length, 0);
});

test('MCP: Claude lists teams, files into one by key or name, and defaults to the first', async () => {
  const token = (await alice.post('/api/tokens', { name: 'claude' })).body.token;
  const init = await mcp(env.base, token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.match(init.body.result.instructions, /PIC \(Acme\), ENG \(Platform\), DES \(Design\)/);
  const teams = await callTool(env.base, token, 'list_teams', {});
  assert.deepEqual(teams.data.teams.map((t) => t.key), ['PIC', 'ENG', 'DES']);
  const byName = await callTool(env.base, token, 'save_issue', { title: 'Via Claude', team: 'platform' });
  assert.equal(byName.data.id, `ENG-${Number(byName.data.id.split('-')[1])}`);
  assert.equal(byName.data.team, 'Platform');
  const plain = await callTool(env.base, token, 'save_issue', { title: 'No team named' });
  assert.match(plain.data.id, /^PIC-/);
  const wrong = await callTool(env.base, token, 'save_issue', { title: 'x', team: 'Sales' });
  assert.equal(wrong.isError, true);
  assert.match(wrong.data, /Teams: PIC \(Acme\)/);
  const list = await callTool(env.base, token, 'list_issues', { team: 'ENG', limit: 250 });
  assert.ok(list.data.issues.length > 0);
  assert.ok(list.data.issues.every((i) => i.id.startsWith('ENG-')));
  const one = await callTool(env.base, token, 'get_issue', { id: 'eng-1' });
  assert.equal(one.data.title, 'First ENG issue');
});

test('a database from before teams upgrades in place: same ids, numbers, links, and the count goes on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-migrate-'));
  try {
    const old = new DatabaseSync(path.join(dir, 'keel.db'));
    old.exec(MIGRATIONS[0]);
    const t = '2026-09-01T00:00:00.000Z';
    const meta = { team_key: 'PIC', team_name: 'PiCubed', team_icon: 'shop', team_color: '#4ea7fc', next_issue_number: '82',
      cycle_anchor: '2026-08-31', cycle_tz: 'America/Los_Angeles', cycle_length_days: '7', estimate_scale: 'fibonacci',
      default_status: 'Backlog', pr_open_status: 'In Review', pr_merged_status: 'Done' };
    for (const [k, v] of Object.entries(meta)) old.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(k, v);
    old.exec(`INSERT INTO statuses (id, name, type, color, position) VALUES (1, 'Backlog', 'backlog', '#bec2c8', 0);
      INSERT INTO users (id, email, role, created_at) VALUES (1, 'a@x.dev', 'admin', '${t}');
      INSERT INTO labels (id, name, color, created_at) VALUES (1, 'Bug', '#eb5757', '${t}');
      INSERT INTO issues (id, number, title, status_id, created_at, updated_at) VALUES (5, 79, 'Parent', 1, '${t}', '${t}');
      INSERT INTO issues (id, number, title, status_id, parent_id, cycle, created_at, updated_at) VALUES (6, 80, 'Child', 1, 5, 3, '${t}', '${t}');
      INSERT INTO issues (id, number, title, status_id, created_at, updated_at, deleted_at) VALUES (7, 81, 'Gone', 1, '${t}', '${t}', '${t}');
      INSERT INTO issue_labels (issue_id, label_id) VALUES (6, 1);
      INSERT INTO comments (id, issue_id, user_id, body, created_at, updated_at) VALUES (1, 6, 1, 'hi', '${t}', '${t}');
      INSERT INTO activity (issue_id, actor_kind, kind, created_at) VALUES (6, 'system', 'created', '${t}');
      INSERT INTO pull_requests (id, repo, number, title, url, state) VALUES (1, 'acme/app', 3, 'PR', 'https://x', 'open');
      INSERT INTO issue_prs (issue_id, pr_id, linked_at) VALUES (6, 1, '${t}');
      PRAGMA user_version = 1;`);
    old.close();

    const db = openDb(dir, { name: 'ignored', key: 'IGN', firstIssueNumber: 1, tz: 'UTC' });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'checks are back on after the rebuild');
    assert.deepEqual({ ...db.prepare('SELECT key, name, color, next_issue_number, cycles_enabled FROM teams').get() },
      { key: 'PIC', name: 'PiCubed', color: '#4ea7fc', next_issue_number: 82, cycles_enabled: 1 });
    assert.deepEqual(db.prepare('SELECT id, team_id, number, parent_id, cycle, deleted_at IS NOT NULL AS gone FROM issues ORDER BY id').all().map((r) => ({ ...r })), [
      { id: 5, team_id: 1, number: 79, parent_id: null, cycle: null, gone: 0 },
      { id: 6, team_id: 1, number: 80, parent_id: 5, cycle: 3, gone: 0 },
      { id: 7, team_id: 1, number: 81, parent_id: null, cycle: null, gone: 1 },
    ]);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'workspace_name'").get().value, 'PiCubed');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key IN ('team_key', 'next_issue_number')").get().n, 0);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'cycle_anchor'").get().value, '2026-08-31');
    // the tables that point at issues still find them, and still guard them
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments c JOIN issues i ON i.id = c.issue_id').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM issue_prs p JOIN issues i ON i.id = p.issue_id').get().n, 1);
    assert.throws(() => db.prepare("INSERT INTO comments (issue_id, user_id, body, created_at, updated_at) VALUES (999, 1, 'x', 'a', 'a')").run(), /FOREIGN KEY/);
    assert.throws(() => db.prepare("INSERT INTO issues (team_id, number, title, status_id, created_at, updated_at) VALUES (1, 79, 'dup', 1, 'a', 'a')").run(), /UNIQUE/);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
