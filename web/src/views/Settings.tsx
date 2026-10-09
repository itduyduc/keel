import { useEffect, useState } from 'react';
import { useApp, saveLabel, saveProject, saveTeam, signOut } from '../state';
import { get, post, patch, del } from '../api';
import { navigate } from '../router';
import { toast } from '../toast';
import { copy, teamByKey, teamPath } from '../util';
import { Avatar, LabelDot } from '../components/bits';
import { Icon, ProjectIcon, TeamIcon, PROJECT_ICON_NAMES } from '../icons';
import { openMenu, anchorOf } from '../components/Menu';
import type { Bootstrap, Label, Project, Team, User } from '../types';

const SECTIONS = [
  { key: 'profile', label: 'Profile', icon: 'user' },
  { key: 'members', label: 'Members', icon: 'members' },
  { key: 'tokens', label: 'API & Claude', icon: 'key' },
  { key: 'labels', label: 'Labels', icon: 'tag' },
  { key: 'projects', label: 'Projects', icon: 'projects' },
  { key: 'github', label: 'GitHub', icon: 'github' },
  { key: 'teams', label: 'Teams', icon: 'users' },
  { key: 'workspace', label: 'Workspace', icon: 'settings' },
];
const COLORS = ['#bec2c8', '#95a2b3', '#5e6ad2', '#26b5ce', '#4cb782', '#f2c94c', '#f2994a', '#fc7840', '#eb5757', '#bb87fc', '#9b7bff', '#4ea7fc'];

export function Settings({ section: asked, sub }: { section: string; sub: string | null }) {
  const section = asked === 'team' ? 'teams' : asked; // /settings/team, from before there were teams
  return (
    <>
      <header className="topbar"><div className="crumbs"><Icon name="settings" size={16} color="#9b9b9e" /><span className="view-title">Settings</span></div></header>
      <div className="main-scroll">
        <div className="settings">
          <nav className="settings-nav">
            {SECTIONS.map((s) => (
              <button key={s.key} className={`nav-item${s.key === section ? ' active' : ''}`} onClick={() => navigate(`/settings/${s.key}`, { replace: true })}>
                <Icon name={s.icon} size={15} /> {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-body">
            {section === 'profile' && <Profile />}
            {section === 'members' && <Members />}
            {section === 'tokens' && <Tokens />}
            {section === 'labels' && <Labels />}
            {section === 'projects' && <Projects />}
            {section === 'github' && <GitHub />}
            {section === 'teams' && <TeamsSection sub={sub} />}
            {section === 'workspace' && <WorkspaceSettings />}
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

function Profile() {
  const { data } = useApp();
  const me = data!.me;
  const [name, setName] = useState(me.name);
  const [handle, setHandle] = useState(me.handle);
  const [gitHandle, setGitHandle] = useState(me.gitHandle);
  const save = async () => {
    try { await patch(`/api/members/${me.id}`, { name, handle, gitHandle }); toast('Profile saved'); } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <div className="settings-section">
      <h2>Profile</h2>
      <div className="profile-card"><Avatar user={me} size={40} /><div><div>{me.name}</div><div className="muted small">{me.email} · {me.role}</div></div></div>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Mention handle" hint={<>Teammates mention you as <code>@{handle}</code>.</>}><input value={handle} onChange={(e) => setHandle(e.target.value)} /></Field>
      <Field label="Git branch prefix" hint={<>Branch names look like <code>{gitHandle}/{data!.teams[0].key.toLowerCase()}-80-short-title</code>.</>}><input value={gitHandle} onChange={(e) => setGitHandle(e.target.value)} /></Field>
      <div className="row-gap"><button className="btn primary" onClick={save}>Save</button><button className="btn ghost" onClick={() => signOut()}><Icon name="logout" size={14} /> Sign out</button></div>
    </div>
  );
}

function Members() {
  const { data } = useApp();
  const d = data!;
  const admin = d.me.role === 'admin';
  const [email, setEmail] = useState('');
  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await post('/api/members', { email }); toast(`Invited ${email}. They can sign in with Google now.`); setEmail(''); } catch (err) { toast((err as Error).message, 'error'); }
  };
  const change = async (u: User, body: Partial<User>) => { try { await patch(`/api/members/${u.id}`, body); } catch (e) { toast((e as Error).message, 'error'); } };
  return (
    <div className="settings-section">
      <h2>Members</h2>
      <p className="muted">Only invited emails can sign in. Inviting sends nothing; tell them the address to open.</p>
      {admin && (
        <form className="inline-form" onSubmit={invite}>
          <input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="btn primary" type="submit">Invite</button>
        </form>
      )}
      <div className="table-list">
        {d.users.map((u) => (
          <div key={u.id} className={`table-row static${u.active ? '' : ' inactive'}`}>
            <span className="table-name"><Avatar user={u} size={20} /> {u.name} <span className="muted small">{u.email}</span></span>
            <span className="muted small">{!u.active ? 'Removed' : u.joined ? `@${u.handle}` : 'Invited'}</span>
            <span className="row-gap">
              {admin && u.id !== d.me.id && u.active && (
                <>
                  <select value={u.role} onChange={(e) => change(u, { role: e.target.value as User['role'] })}>
                    <option value="member">Member</option><option value="admin">Admin</option>
                  </select>
                  <button className="btn ghost small" onClick={() => { if (confirm(`Remove ${u.name}? They lose access right away.`)) change(u, { active: false }); }}>Remove</button>
                </>
              )}
              {admin && !u.active && <button className="btn ghost small" onClick={() => change(u, { active: true })}>Restore</button>}
              {(!admin || u.id === d.me.id) && <span className="muted small">{u.role === 'admin' ? 'Admin' : 'Member'}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Token { id: number; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }
function Tokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState('Claude on my Mac');
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => { get<{ tokens: Token[] }>('/api/tokens').then((r) => setTokens(r.tokens)).catch(() => {}); }, []);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try { const r = await post<{ token: string; tokens: Token[] }>('/api/tokens', { name }); setFresh(r.token); setTokens(r.tokens); } catch (err) { toast((err as Error).message, 'error'); }
  };
  const revoke = async (t: Token) => {
    if (!confirm(`Revoke "${t.name}"? Anything using it stops working.`)) return;
    const r = await del<{ tokens: Token[] }>(`/api/tokens/${t.id}`);
    setTokens(r.tokens);
  };
  const cmd = (token: string) => `claude mcp add --scope user --transport http keel ${location.origin}/mcp --header "Authorization: Bearer ${token}"`;
  return (
    <div className="settings-section">
      <h2>API & Claude</h2>
      <p className="muted">A personal token lets Claude (through the MCP) or a script act as you: every issue and comment it writes is yours.</p>
      <form className="inline-form" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="What will use it?" />
        <button className="btn primary" type="submit">Create token</button>
      </form>
      {fresh && (
        <div className="callout">
          <div><strong>Copy this now.</strong> It is shown once.</div>
          <code className="token">{fresh}</code>
          <div className="muted small">Add Keel to Claude Code, for every project on this Mac:</div>
          <code className="token">{cmd(fresh)}</code>
          <div className="row-gap"><button className="btn primary small" onClick={() => copy(cmd(fresh), 'the Claude command')}>Copy command</button><button className="btn ghost small" onClick={() => copy(fresh, 'token')}>Copy token</button></div>
        </div>
      )}
      <div className="table-list">
        {tokens.map((t) => (
          <div key={t.id} className="table-row static">
            <span className="table-name"><Icon name="key" size={14} /> {t.name} <span className="muted small">{t.prefix}…</span></span>
            <span className="muted small">{t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used'}</span>
            <button className="btn ghost small" onClick={() => revoke(t)}>Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function colorMenu(el: Element, value: string, onPick: (c: string) => void) {
  openMenu({
    anchor: anchorOf(el), width: 200,
    content: (close) => <div className="color-grid">{COLORS.map((c) => <button key={c} style={{ background: c }} className={c === value ? 'on' : ''} onClick={() => { onPick(c); close(); }} />)}</div>,
  });
}

function Labels() {
  const { data } = useApp();
  const [name, setName] = useState('');
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (await saveLabel({ name, color: COLORS[Math.floor(Math.random() * COLORS.length)] })) setName(''); };
  return (
    <div className="settings-section">
      <h2>Labels</h2>
      <form className="inline-form" onSubmit={add}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="New label" required /><button className="btn primary" type="submit">Add</button></form>
      <div className="table-list">
        {data!.labels.map((l: Label) => (
          <div key={l.id} className={`table-row static${l.archived ? ' inactive' : ''}`}>
            <span className="table-name">
              <button className="swatch" onClick={(e) => colorMenu(e.currentTarget, l.color, (color) => saveLabel({ id: l.id, color }))}><LabelDot color={l.color} size={10} /></button>
              <input className="bare" defaultValue={l.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== l.name) saveLabel({ id: l.id, name: e.target.value }); }} />
            </span>
            <span className="muted small">{data!.issues.filter((i) => i.labelIds.includes(l.id)).length} issues</span>
            <button className="btn ghost small" onClick={() => saveLabel({ id: l.id, archived: !l.archived })}>{l.archived ? 'Restore' : 'Archive'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Projects() {
  const { data } = useApp();
  const [name, setName] = useState('');
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (await saveProject({ name })) setName(''); };
  const iconMenu = (el: Element, p: Project) => openMenu({
    anchor: anchorOf(el), width: 224,
    content: (close) => <div className="icon-grid">{PROJECT_ICON_NAMES.map((ic) => <button key={ic} title={ic} className={ic === p.icon ? 'on' : ''} onClick={() => { saveProject({ id: p.id, icon: ic }); close(); }}><ProjectIcon icon={ic} color={p.color} /></button>)}</div>,
  });
  return (
    <div className="settings-section">
      <h2>Projects</h2>
      <form className="inline-form" onSubmit={add}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project" required /><button className="btn primary" type="submit">Add</button></form>
      <div className="table-list">
        {data!.projects.map((p) => (
          <div key={p.id} className={`table-row static${p.archived ? ' inactive' : ''}`}>
            <span className="table-name">
              <button className="swatch" title="Icon" onClick={(e) => iconMenu(e.currentTarget, p)}><ProjectIcon icon={p.icon} color={p.color} /></button>
              <button className="swatch" title="Color" onClick={(e) => colorMenu(e.currentTarget, p.color, (color) => saveProject({ id: p.id, color }))}><LabelDot color={p.color} size={10} /></button>
              <input className="bare" defaultValue={p.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== p.name) saveProject({ id: p.id, name: e.target.value }); }} />
            </span>
            <span className="muted small">{data!.issues.filter((i) => i.projectId === p.id).length} issues</span>
            <button className="btn ghost small" onClick={() => saveProject({ id: p.id, archived: !p.archived })}>{p.archived ? 'Restore' : 'Archive'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface GhStatus { org: string; webhookConfigured: boolean; pollConfigured: boolean; pollSeconds: number; lastWebhookAt: string | null; lastPollAt: string | null; lastPollError: string | null; repos: string[] }
function GitHub() {
  const { data } = useApp();
  const [s, setS] = useState<GhStatus | null>(null);
  useEffect(() => { get<GhStatus>('/api/github/status').then(setS).catch(() => {}); }, []);
  const key = data!.teams[0].key;
  return (
    <div className="settings-section">
      <h2>GitHub</h2>
      <p className="muted">A pull request whose branch or title contains an issue id, like <code>{key}-123</code>, attaches to that issue. Opening it moves the issue to In Review; once every linked PR is merged or closed, with at least one merged, it moves to Done. A draft, or a PR closed without merging, moves nothing.</p>
      {s && (
        <div className="kv">
          <span>Organization</span><span>{s.org}</span>
          <span>Webhook</span><span>{s.webhookConfigured ? (s.lastWebhookAt ? `on · last delivery ${new Date(s.lastWebhookAt).toLocaleString()}` : 'on · no delivery yet') : 'not configured'}</span>
          <span>Catch-up poll</span><span>{s.pollConfigured ? `every ${s.pollSeconds}s · ${s.lastPollError ? `failing: ${s.lastPollError}` : s.lastPollAt ? `last ${new Date(s.lastPollAt).toLocaleTimeString()}` : 'starting'}` : 'not configured'}</span>
          <span>Repositories</span><span>{s.repos.length ? s.repos.join(', ') : '—'}</span>
          <span>Webhook URL</span><span><code>{location.origin}/github/webhook</code></span>
        </div>
      )}
    </div>
  );
}

// What every team shares. The cycle schedule is read from the first start (KEEL_CYCLE_ANCHOR).
function WorkspaceSettings() {
  const { data } = useApp();
  const d = data!;
  const admin = d.me.role === 'admin';
  const setScale = async (estimateScale: string) => { try { await patch('/api/workspace', { estimateScale }); toast('Estimate scale saved'); } catch (e) { toast((e as Error).message, 'error'); } };
  return (
    <div className="settings-section">
      <h2>Workspace</h2>
      <p className="muted">Shared by every team: statuses, labels, projects, the cycle weeks and the estimate scale.</p>
      <div className="kv">
        <span>Name</span><span>{d.workspace.name}</span>
        <span>Cycles</span><span>Weekly, starting Monday 00:00 ({d.workspace.cycle.tz}), for each team that runs them; unfinished issues roll into the next cycle.</span>
      </div>
      <Field label="Estimate scale" hint={admin ? undefined : 'Only admins can change this.'}>
        <select value={d.workspace.estimateScale} disabled={!admin} onChange={(e) => setScale(e.target.value)}>
          {Object.entries(d.workspace.estimateScales).map(([k, v]) => <option key={k} value={k}>{v.label} — {(v.names || v.values).join(', ')}</option>)}
        </select>
      </Field>
    </div>
  );
}

// ── teams ──────────────────────────────────────────────────────────────────
function TeamsSection({ sub }: { sub: string | null }) {
  const { data } = useApp();
  const d = data!;
  if (sub === 'new') return <CreateTeam />;
  const team = teamByKey(d, sub);
  if (sub && !team) return <div className="settings-section"><h2>No team {sub}</h2></div>;
  if (team) return <TeamSettings team={team} key={team.id} />;
  return (
    <div className="settings-section">
      <h2>Teams</h2>
      <p className="muted">Each team has its own issue ids and numbering, and decides whether it runs cycles.</p>
      {d.me.role === 'admin' && <button className="btn primary small" onClick={() => navigate('/settings/teams/new')}><Icon name="plus" size={14} /> Create team</button>}
      <div className="table-list">
        {d.teams.map((t) => (
          <div key={t.id} className="table-row" onClick={() => navigate(`/settings/teams/${t.key}`)}>
            <span className="table-name"><TeamIcon color={t.color} size={16} /> {t.name} <span className="muted small">{t.key}</span></span>
            <span className="muted small">{d.issues.filter((i) => i.teamId === t.id).length} issues</span>
            <span className="muted small">{t.cyclesEnabled ? 'Cycles' : 'No cycles'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// "Engineering" → ENG, "Design Ops" → DO, the way Linear suggests one
function suggestKey(name: string) {
  const words = name.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0]?.slice(0, 3) || '').slice(0, 5);
}
// the first color no team has yet, past the two grays
const unusedColor = (d: Bootstrap) => COLORS.slice(2).find((c) => !d.teams.some((t) => t.color === c)) || COLORS[2];

function ColorRow({ value, onPick, disabled }: { value: string; onPick: (c: string) => void; disabled?: boolean }) {
  return (
    <div className="color-grid inline">
      {COLORS.map((c) => <button type="button" key={c} disabled={disabled} style={{ background: c }} className={c === value ? 'on' : ''} onClick={() => onPick(c)} />)}
    </div>
  );
}

function CreateTeam() {
  const { data } = useApp();
  const d = data!;
  const [name, setName] = useState('');
  const [typedKey, setTypedKey] = useState<string | null>(null);
  const [color, setColor] = useState(() => unusedColor(d));
  const [busy, setBusy] = useState(false);
  const key = typedKey ?? suggestKey(name);
  if (d.me.role !== 'admin') return <div className="settings-section"><h2>Create a team</h2><p className="muted">Only admins can create teams.</p></div>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const t = await saveTeam({ name, key, color });
    setBusy(false);
    if (t) { toast(`Created ${t.name}`); navigate(teamPath(t)); }
  };
  return (
    <form className="settings-section" onSubmit={submit}>
      <h2>Create a team</h2>
      <p className="muted">Statuses, labels and projects are shared with your other teams. Cycles start off; turn them on in the team's settings.</p>
      <Field label="Team name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" autoFocus /></Field>
      <Field label="Identifier" hint={<>Every issue id starts with it: <code>{key || 'ENG'}-1</code>. 1 to 5 letters. It cannot change later.</>}>
        <input value={key} onChange={(e) => setTypedKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5))} placeholder="ENG" />
      </Field>
      <div className="field"><span className="field-label">Color</span><ColorRow value={color} onPick={setColor} /></div>
      <div className="row-gap">
        <button className="btn primary" type="submit" disabled={busy || !name.trim() || !key}>Create team</button>
        <button className="btn ghost" type="button" onClick={() => navigate('/settings/teams')}>Cancel</button>
      </div>
    </form>
  );
}

function TeamSettings({ team }: { team: Team }) {
  const { data } = useApp();
  const d = data!;
  const admin = d.me.role === 'admin';
  const [name, setName] = useState(team.name);
  const save = async (patch: { name?: string; color?: string; cyclesEnabled?: boolean }) => { if (await saveTeam(patch, team)) toast('Team saved'); };
  return (
    <div className="settings-section">
      <h2><span className="crumb" onClick={() => navigate('/settings/teams')}>Teams</span> <Icon name="chevronRight" size={12} className="crumb-sep" /> {team.name}</h2>
      <div className="kv">
        <span>Identifier</span><span><code>{team.key}</code> · issues are {team.key}-1, {team.key}-2, … It cannot change.</span>
        <span>Issues</span><span>{d.issues.filter((i) => i.teamId === team.id).length}</span>
      </div>
      <form className="field" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name !== team.name) save({ name }); }}>
        <span className="field-label">Name</span>
        <div className="row-gap">
          <input value={name} disabled={!admin} onChange={(e) => setName(e.target.value)} />
          {admin && <button className="btn primary" type="submit" disabled={!name.trim() || name === team.name}>Save</button>}
        </div>
      </form>
      <div className="field"><span className="field-label">Color</span><ColorRow value={team.color} disabled={!admin} onPick={(color) => save({ color })} /></div>
      <div className="field">
        <label className="toggle"><input type="checkbox" checked={team.cyclesEnabled} disabled={!admin} onChange={(e) => save({ cyclesEnabled: e.target.checked })} /> Cycles</label>
        <span className="field-hint">Weekly, from Monday 00:00 ({d.workspace.cycle.tz}), the same weeks as every team that runs them. Unfinished issues roll into the next cycle.</span>
      </div>
      {!admin && <p className="muted small">Only admins can change a team.</p>}
    </div>
  );
}
