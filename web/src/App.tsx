import { useEffect, useState } from 'react';
import { useApp, load, getState, signOut } from './state';
import { useLocation, parseRoute, navigate, type Route } from './router';
import { getUi, setUi, openCreate, contextIssueId } from './ui';
import { MenuHost, menuOpen, openMenu, anchorOf, closeMenu } from './components/Menu';
import { CreateIssue, CommandPalette, ShortcutSheet } from './components/Overlays';
import { IssuePage } from './views/IssuePage';
import { TeamIssues, MyIssues, ProjectsView, ProjectView, CyclesView, CycleView } from './views/Lists';
import { Settings } from './views/Settings';
import { issuePickers } from './pickers';
import { assignToMe, confirmDelete, copyBranch, copyId, copyLink } from './actions';
import { Avatar } from './components/bits';
import { TeamIcon, Icon, ProjectIcon, CycleIcon } from './icons';
import { isTyping } from './util';
import { useToasts } from './toast';

export function App() {
  const s = useApp();
  const loc = useLocation();
  useEffect(() => { load(); }, []);
  useShortcuts();

  if (s.phase === 'loading') return <div className="splash" />;
  if (s.phase === 'signed-out') return <Login />;
  if (!s.data) {
    return (
      <div className="login"><div className="login-card">
        <h1>Can't reach Keel</h1><p className="muted">{s.error}</p>
        <button className="btn primary" onClick={() => load()}>Try again</button>
      </div></div>
    );
  }
  const route = parseRoute(loc);
  if (loc === '/' || loc === '') { navigate('/issues', { replace: true }); return null; }

  return (
    <div className="app">
      <Sidebar route={route} />
      <main className="main">
        <div className="panel">
          <View route={route} />
        </div>
      </main>
      <CreateIssue />
      <CommandPalette />
      <ShortcutSheet />
      <MenuHost />
      <Toasts />
    </div>
  );
}

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'issue': return <IssuePage refStr={route.ref} key={route.ref} />;
    case 'my': return <MyIssues tab={route.tab} />;
    case 'projects': return <ProjectsView />;
    case 'project': return <ProjectView id={route.id} key={route.id} />;
    case 'cycles': return <CyclesView />;
    case 'cycle': return <CycleView number={route.number} key={route.number} />;
    case 'settings': return <Settings section={route.section} />;
    default: return <TeamIssues tab={route.tab} />;
  }
}

function Sidebar({ route }: { route: Route }) {
  const { data, newVersion, connected } = useApp();
  const d = data!;
  const item = (label: string, icon: React.ReactNode, path: string, active: boolean, extra?: React.ReactNode) => (
    <button className={`nav-item${active ? ' active' : ''}`} onClick={() => navigate(path)}>
      <span className="nav-icon">{icon}</span><span className="nav-label">{label}</span>{extra}
    </button>
  );
  const myCount = d.issues.filter((i) => i.assigneeId === d.me.id && ['started', 'unstarted'].includes(d.statuses.find((s) => s.id === i.statusId)!.type)).length;
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="workspace" onClick={(e) => openMenu({
          anchor: anchorOf(e.currentTarget), width: 220,
          options: () => [
            { key: 'settings', label: 'Settings', icon: <Icon name="settings" color="#9b9b9e" /> },
            { key: 'tokens', label: 'Connect Claude (MCP)', icon: <Icon name="key" color="#9b9b9e" /> },
            { key: 'shortcuts', label: 'Keyboard shortcuts', icon: <Icon name="command" color="#9b9b9e" /> },
            { key: 'signout', label: 'Sign out', icon: <Icon name="logout" color="#9b9b9e" /> },
          ],
          onSelect: (o) => {
            if (o.key === 'settings') navigate('/settings');
            if (o.key === 'tokens') navigate('/settings/tokens');
            if (o.key === 'shortcuts') setUi({ shortcuts: true });
            if (o.key === 'signout') signOut();
          },
        })}>
          <TeamIcon color={d.team.color} size={18} />
          <span className="workspace-name">{d.team.name}</span>
          <Icon name="chevronDown" size={12} color="#8a8f98" />
        </button>
        <button className="icon-btn" title="Search (⌘K)" onClick={() => setUi({ palette: true })}><Icon name="search" /></button>
        <button className="icon-btn compose" title="New issue (C)" onClick={() => openCreate(getUi().viewDefaults)}><Icon name="compose" /></button>
      </div>
      <nav className="nav">
        {item('My issues', <Icon name="user" />, '/my-issues', route.name === 'my', myCount ? <span className="nav-count">{myCount}</span> : null)}
        <div className="nav-section">Your team</div>
        <div className="nav-team"><TeamIcon color={d.team.color} size={16} /><span>{d.team.name}</span></div>
        <div className="nav-indent">
          {item('Issues', <Icon name="issues" />, '/issues', route.name === 'issues' || route.name === 'issue')}
          {item('Cycles', <CycleIcon size={16} />, '/cycles', route.name === 'cycles' || route.name === 'cycle')}
          {item('Projects', <Icon name="projects" />, '/projects', route.name === 'projects')}
        </div>
        {d.projects.some((p) => !p.archived) && <div className="nav-section">Projects</div>}
        {d.projects.filter((p) => !p.archived).map((p) => (
          <div key={p.id}>{item(p.name, <ProjectIcon icon={p.icon} color={p.color} />, `/project/${p.id}`, route.name === 'project' && route.id === p.id)}</div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        {newVersion && <button className="update-pill" onClick={() => location.reload()}><Icon name="refresh" size={13} /> New version · Reload</button>}
        {!connected && <div className="offline-note">Reconnecting…</div>}
        {item('Settings', <Icon name="settings" />, '/settings', route.name === 'settings')}
        <div className="me-row"><Avatar user={d.me} size={20} /><span>{d.me.name}</span></div>
      </div>
    </aside>
  );
}

function Login() {
  const [error, setError] = useState<string | null>(null);
  const native = (window as any).webkit?.messageHandlers?.keel;
  useEffect(() => {
    (window as any).keelSignInFailed = (msg: string) => { if (msg !== 'canceled') setError(msg); };
  }, []);
  const signIn = () => {
    setError(null);
    if (native) native.postMessage({ action: 'signIn' });
    else location.href = '/auth/google';
  };
  return (
    <div className="login">
      <div className="login-card">
        <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="#1c1c1f" /><path d="M16 5v9" stroke="#f7f8f8" strokeWidth="1.6" strokeLinecap="round" /><path d="M16 27l-6.2-8.2A2.2 2.2 0 0 1 11.6 15h8.8a2.2 2.2 0 0 1 1.8 3.8z" fill="#f7f8f8" /></svg>
        <h1>Keel</h1>
        <p className="muted">Your team's issue tracker</p>
        <button className="btn google" onClick={signIn}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </button>
        {error && <p className="login-error">{error}</p>}
        <p className="muted small">Only invited teammates can sign in. <a className="login-privacy" href="/privacy.html">Privacy</a></p>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useToasts();
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>;
}

// ── keyboard ───────────────────────────────────────────────────────────────
function useShortcuts() {
  useEffect(() => {
    let pendingG = 0;
    const issueFor = () => {
      const id = contextIssueId();
      return id ? getState().data?.issues.find((i) => i.id === id) : undefined;
    };
    const anchorFor = (id: number) => document.querySelector(`[data-issue-row="${id}"] .row-status`) || document.querySelector('.rail') || null;
    const move = (delta: number) => {
      const ui = getUi();
      if (ui.pageIssueId) {
        const idx = ui.listOrder.indexOf(ui.pageIssueId);
        const next = getState().data?.issues.find((i) => i.id === ui.listOrder[idx + delta]);
        if (idx >= 0 && next) navigate(`/issue/${next.identifier}`, { replace: true });
        return;
      }
      if (!ui.listOrder.length) return;
      const idx = ui.focusedIssueId ? ui.listOrder.indexOf(ui.focusedIssueId) : -1;
      const nextId = ui.listOrder[Math.max(0, Math.min(ui.listOrder.length - 1, idx + delta))];
      setUi({ focusedIssueId: nextId });
      document.querySelector(`[data-issue-row="${nextId}"]`)?.scrollIntoView({ block: 'nearest' });
    };

    const onKey = (e: KeyboardEvent) => {
      const ui = getUi();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); closeMenu(); setUi({ palette: !ui.palette }); return; }
      if (!getState().data || menuOpen() || ui.palette || ui.create || ui.shortcuts) return;
      if (isTyping(e.target)) return;
      const issue = issueFor();
      if (mod) {
        if (!issue) return;
        if (e.code === 'Period' && e.shiftKey) { e.preventDefault(); copyBranch(issue); }
        else if (e.code === 'Period') { e.preventDefault(); copyId(issue); }
        else if (e.code === 'Comma' && e.shiftKey) { e.preventDefault(); copyLink(issue); }
        else if (e.key === 'Backspace') { e.preventDefault(); confirmDelete(issue); }
        return;
      }
      if (e.altKey) return;
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const to = { m: '/my-issues', i: '/issues', c: '/cycles', p: '/projects', s: '/settings' }[e.key.toLowerCase()];
        if (to) { e.preventDefault(); navigate(to); }
        return;
      }
      const a = issue ? anchorFor(issue.id) : null;
      const pick = (fn: (i: NonNullable<typeof issue>, el: Element | null) => void) => { if (issue) { e.preventDefault(); fn(issue, a); } };
      switch (e.key) {
        case 'g': pendingG = Date.now(); return;
        case 'c': e.preventDefault(); openCreate(ui.viewDefaults); return;
        case '/': e.preventDefault(); setUi({ palette: true }); return;
        case '?': e.preventDefault(); setUi({ shortcuts: true }); return;
        case 'j': case 'ArrowDown': e.preventDefault(); move(1); return;
        case 'k': case 'ArrowUp': e.preventDefault(); move(-1); return;
        case 'Enter': case 'o':
          if (!ui.pageIssueId && issue) { e.preventDefault(); navigate(`/issue/${issue.identifier}`); }
          return;
        case 'Escape':
          if (ui.pageIssueId) { e.preventDefault(); navigate(ui.lastList || '/issues'); }
          return;
        case 's': return pick(issuePickers.status);
        case 'p': return pick(issuePickers.priority);
        case 'a': return pick(issuePickers.assignee);
        case 'l': return pick(issuePickers.labels);
        case 'i': if (issue) { e.preventDefault(); assignToMe(issue); } return;
        case 'P': return pick(issuePickers.project);
        case 'C': return pick(issuePickers.cycle);
        case 'E': return pick(issuePickers.estimate);
        case 'D': return pick(issuePickers.dueDate);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
