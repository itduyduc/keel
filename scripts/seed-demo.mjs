// Fills a LOCAL Plumb with the issues from Duy's Linear screenshots (2026-09-29),
// so the two can be compared side by side. Local dev only: it signs in through dev
// login and refuses any address that isn't localhost.
//
//   node scripts/seed-demo.mjs [http://localhost:4747]
import crypto from 'node:crypto';

const base = process.argv[2] || 'http://localhost:4747';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  console.error(`refusing: ${base} is not a local server`);
  process.exit(1);
}
const secret = process.env.PLUMB_GITHUB_WEBHOOK_SECRET || 'local-dev-secret';

async function session(email) {
  const r = await fetch(`${base}/auth/dev/as?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error(`dev sign-in failed for ${email} (${r.status}) — is PLUMB_DEV_LOGIN=1 set?`);
  return async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { cookie, 'x-requested-with': 'plumb', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${json.error}`);
    return json;
  };
}

const duy = await session('it.duy.duc@gmail.com');
const boot = await duy('GET', '/api/bootstrap');
if (boot.issues.length) { console.log(`already has ${boot.issues.length} issues; not seeding twice`); process.exit(0); }

for (const email of ['harshit@pitrade.com', 'priyanka@pitrade.com']) {
  if (!boot.users.some((u) => u.email === email)) await duy('POST', '/api/members', { email });
}
const users = (await duy('GET', '/api/members')).users;
const who = (email) => users.find((u) => u.email === email).id;
const status = (name) => boot.statuses.find((s) => s.name === name).id;
const project = (name) => boot.projects.find((p) => p.name === name).id;
const label = (name) => boot.labels.find((l) => l.name === name).id;
const cycle = boot.cycles.current;
const D = 'it.duy.duc@gmail.com', H = 'harshit@pitrade.com', P = 'priyanka@pitrade.com';

const pic68 = `The five rows of the Mac home status panel each placed their own green checkmark, and no two agreed. Three orders across five rows:

| Row | Before |
| -- | -- |
| Private connection | ✓ Disconnect |
| AI assistant | Change ✓ |
| Files & folders | ✓ Manage |
| Build apps | ✓ ⌄ |
| Build advanced games | Manage ✓ |

The checks landed at a different x on every row, so the panel read as five unrelated rows rather than one checklist.

## Fix

\`SetupRow\` now owns the check: a \`done: Bool\` and a fixed-width status column that is always last in the row. Call sites pass \`done:\` and no longer place \`RowCheckmark()\` themselves, so the order cannot drift again.

Side effect worth having: the column is reserved whether or not the check is showing, so a row's button no longer slides sideways the moment that row completes.

Files: \`Anur/Setup/SetupRow.swift\` plus the five row call sites.`;

const seed = [
  { title: 'Mac status panel: green checks sit in one trailing column', description: pic68, statusId: status('In Progress'), priority: 4, assigneeId: who(D), cycle, pr: 246 },
  { title: 'Duy — connect with 3 potential customers', statusId: status('In Progress'), priority: 1, assigneeId: who(D), projectId: project('Thesis survives or dies') },
  { title: 'Apps on the shared wildcard profile stop launching when it is reissued', statusId: status('In Progress'), priority: 2, assigneeId: who(D), cycle },
  { title: 'Harshit — connect with 3 potential customers', statusId: status('Todo'), priority: 1, assigneeId: who(H), projectId: project('Thesis survives or dies') },
  { title: 'Priyanka — connect with 3 potential customers', statusId: status('Todo'), priority: 1, assigneeId: who(P), projectId: project('Thesis survives or dies') },
  { title: 'Quick-start: a first app lands before the full build finishes', statusId: status('Todo'), priority: 2, assigneeId: who(D) },
  { title: "Nebula UDP listener rebinds every ~10s on Duy's Mac", statusId: status('Todo'), priority: 3, assigneeId: who(D) },
  { title: "Set up TikTok as Duy's build-in-public account", statusId: status('Todo'), priority: 0, assigneeId: who(D), projectId: project('Biz') },
  { title: 'When hit x it shoudl live in mac top menu bar.', statusId: status('Todo'), priority: 0, assigneeId: who(D) },
  { title: 'Invite flow: remind the invitee which Google account to use', statusId: status('Backlog'), priority: 3, labelIds: [label('Improvement')] },
  { title: 'Crash when a comment has only an image', statusId: status('Backlog'), priority: 2, labelIds: [label('Bug')], assigneeId: who(H), dueDate: '2026-10-02' },
  { title: 'Menu bar status item for background builds', statusId: status('Backlog'), priority: 0, labelIds: [label('Feature'), label('apply-to-anur')], estimate: 3 },
  { title: 'Ship the phone onboarding copy', statusId: status('Done'), priority: 3, assigneeId: who(H), cycle },
];

for (const s of seed) {
  const { pr, ...input } = s;
  const issue = await duy('POST', '/api/issues', input);
  console.log(`${issue.identifier}  ${issue.title}`);
  if (pr) {
    const t = new Date().toISOString();
    const payload = JSON.stringify({
      action: 'opened', repository: { full_name: 'HeyAnurAI/Anur' },
      pull_request: {
        number: pr, title: "Mac: every row's green check in one trailing column", state: 'open', draft: false,
        html_url: `https://github.com/HeyAnurAI/Anur/pull/${pr}`, head: { ref: `itduyduc/${issue.identifier.toLowerCase()}-mac-status-panel-green-checks` },
        user: { login: 'itduyduc' }, created_at: t, updated_at: t, closed_at: null, merged_at: null,
      },
    });
    const sig = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
    const r = await fetch(`${base}/github/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig }, body: payload });
    console.log(`   PR #${pr} webhook → ${r.status}`);
  }
}
const [first] = (await duy('GET', '/api/issues')).issues;
await duy('POST', `/api/issues/${first.number}/comments`, { body: 'Checked on the Mac at 1440 and 1280 widths: one column, all five rows. @harshit can you eyeball it on yours?' });
console.log('seeded');
