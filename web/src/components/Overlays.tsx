// The three overlays: New issue (C), the command palette (⌘K) and the shortcut sheet (?).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, createIssue, getState } from '../state';
import { useUi, setUi, contextIssueId, openCreate } from '../ui';
import { navigate } from '../router';
import { Editor } from './Editor';
import { Avatar, Kbd, LabelDot } from './bits';
import { StatusIcon, PriorityIcon, ProjectIcon, CycleIcon, TeamIcon, Icon } from '../icons';
import { pickStatus, pickPriority, pickAssignee, pickLabels, pickProject, pickCycle, pickEstimate, pickDueDate, pickParent, issuePickers } from '../pickers';
import { PRIORITY_NAMES, dayLabel, estimateLabel } from '../util';
import { copyBranch, copyId, copyLink, assignToMe, confirmDelete } from '../actions';
import { toast } from '../toast';
import type { IssuePatch } from '../types';

export function CreateIssue() {
  const { data } = useApp();
  const ui = useUi();
  if (!ui.create || !data) return null;
  return <CreateDialog key={JSON.stringify(ui.create)} defaults={ui.create} />;
}

function CreateDialog({ defaults }: { defaults: IssuePatch }) {
  const { data } = useApp();
  const d = data!;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [p, setP] = useState<IssuePatch>({ statusId: d.team.defaultStatusId, priority: 0, labelIds: [], ...defaults });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const latest = useRef(p);
  latest.current = p;
  const upd = (x: IssuePatch) => setP((cur) => ({ ...cur, ...x }));
  const close = () => setUi({ create: null });

  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    const issue = await createIssue({ ...p, title, description });
    setBusy(false);
    if (!issue) return;
    toast(`Created ${issue.identifier}`);
    if (more) { setTitle(''); setDescription(''); titleRef.current?.focus(); }
    else close();
  };

  const status = d.statuses.find((s) => s.id === p.statusId);
  const assignee = d.users.find((u) => u.id === p.assigneeId);
  const project = d.projects.find((x) => x.id === p.projectId);
  const labels = (p.labelIds || []).map((id) => d.labels.find((l) => l.id === id)).filter(Boolean);
  const parent = p.parentId ? d.issues.find((i) => i.id === p.parentId) : undefined;
  const chip = (content: React.ReactNode, onClick: (el: Element) => void, empty = false) => (
    <button className={`prop-chip${empty ? ' empty' : ''}`} onClick={(e) => onClick(e.currentTarget)}>{content}</button>
  );

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog create" onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
      }}>
        <div className="dialog-head">
          <span className="team-chip"><TeamIcon color={d.team.color} size={14} /> {d.team.key}</span>
          <Icon name="chevronRight" size={12} className="crumb-sep" />
          <span>{parent ? <>New sub-issue of <span className="muted">{parent.identifier}</span></> : 'New issue'}</span>
          <button className="icon-btn dialog-close" onClick={close}><Icon name="x" size={14} /></button>
        </div>
        <input ref={titleRef} className="create-title" placeholder="Issue title" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); (document.querySelector('.create .editor textarea') as HTMLElement)?.focus(); } }} />
        <Editor className="create-description" value={description} onChange={setDescription} placeholder="Add description… (markdown, @ to mention)" minRows={3} onSubmit={submit} />
        <div className="prop-chips">
          {chip(<><StatusIcon status={status} statuses={d.statuses} /> {status?.name}</>, (el) => pickStatus(p.statusId!, el, (v) => upd({ statusId: v })))}
          {chip(<><PriorityIcon priority={p.priority || 0} /> {p.priority ? PRIORITY_NAMES[p.priority] : 'Priority'}</>, (el) => pickPriority(p.priority || 0, el, (v) => upd({ priority: v })), !p.priority)}
          {chip(<><Avatar user={assignee} size={16} /> {assignee?.name || 'Assignee'}</>, (el) => pickAssignee(p.assigneeId ?? null, el, (v) => upd({ assigneeId: v })), !assignee)}
          {chip(project ? <><ProjectIcon icon={project.icon} color={project.color} /> {project.name}</> : <><Icon name="projects" /> Project</>, (el) => pickProject(p.projectId ?? null, el, (v) => upd({ projectId: v })), !project)}
          {chip(labels.length ? <>{labels.map((l) => <LabelDot key={l!.id} color={l!.color} />)} {labels.length === 1 ? labels[0]!.name : `${labels.length} labels`}</> : <><Icon name="tag" /> Labels</>,
            (el) => pickLabels(() => latest.current.labelIds || [], el, (v) => upd({ labelIds: v })), !labels.length)}
          {chip(<><CycleIcon /> {p.cycle ? `Cycle ${p.cycle}` : 'Cycle'}</>, (el) => pickCycle(p.cycle ?? null, el, (v) => upd({ cycle: v })), !p.cycle)}
          {chip(<><Icon name="estimate" /> {p.estimate != null ? estimateLabel(d, p.estimate) : 'Estimate'}</>, (el) => pickEstimate(p.estimate ?? null, el, (v) => upd({ estimate: v })), p.estimate == null)}
          {chip(<><Icon name="calendar" /> {p.dueDate ? dayLabel(p.dueDate) : 'Due date'}</>, (el) => pickDueDate(p.dueDate ?? null, el, (v) => upd({ dueDate: v })), !p.dueDate)}
          {chip(<><Icon name="subissue" /> {parent ? parent.identifier : 'Parent'}</>, (el) => pickParent(null, p.parentId ?? null, el, (v) => upd({ parentId: v })), !parent)}
        </div>
        <div className="dialog-foot">
          <label className="toggle"><input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} /> Create more</label>
          <button className="btn primary" disabled={!title.trim() || busy} onClick={submit}>Create issue <Kbd>⌘↵</Kbd></button>
        </div>
      </div>
    </div>
  );
}

// ── ⌘K ─────────────────────────────────────────────────────────────────────
interface Cmd { key: string; label: string; icon: React.ReactNode; hint?: string; run: () => void; section: string }

export function CommandPalette() {
  const ui = useUi();
  const { data } = useApp();
  if (!ui.palette || !data) return null;
  return <Palette />;
}

function Palette() {
  const { data } = useApp();
  const d = data!;
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => setUi({ palette: false });
  const ctx = d.issues.find((i) => i.id === contextIssueId());

  const commands: Cmd[] = useMemo(() => {
    const go = (label: string, path: string, icon: string, hint?: string): Cmd => ({ key: `go-${path}`, label, icon: <Icon name={icon} />, hint, section: 'Navigate', run: () => navigate(path) });
    const list: Cmd[] = [
      { key: 'new', label: 'Create new issue', icon: <Icon name="compose" />, hint: 'C', section: 'Commands', run: () => openCreate() },
      go('Go to My issues', '/my-issues', 'user', 'G M'),
      go('Go to Issues', '/issues', 'issues', 'G I'),
      go('Go to Active issues', '/issues?tab=active', 'issues'),
      go('Go to Backlog', '/issues?tab=backlog', 'issues'),
      go('Go to Cycles', '/cycles', 'cycles', 'G C'),
      go('Go to current cycle', `/cycle/${d.cycles.current}`, 'cycles'),
      go('Go to Projects', '/projects', 'projects', 'G P'),
      go('Go to Settings', '/settings', 'settings', 'G S'),
      go('Create an API token for Claude', '/settings/tokens', 'key'),
      { key: 'shortcuts', label: 'Keyboard shortcuts', icon: <Icon name="command" />, hint: '?', section: 'Commands', run: () => setUi({ shortcuts: true }) },
    ];
    if (ctx) {
      const at = null;
      const on = (label: string, icon: React.ReactNode, run: () => void, hint?: string): Cmd => ({ key: `ctx-${label}`, label: `${label}`, icon, hint, section: `${ctx.identifier} ${ctx.title}`, run });
      list.unshift(
        on('Change status…', <StatusIcon status={d.statuses.find((s) => s.id === ctx.statusId)} statuses={d.statuses} />, () => issuePickers.status(ctx, at), 'S'),
        on('Set priority…', <PriorityIcon priority={ctx.priority} />, () => issuePickers.priority(ctx, at), 'P'),
        on('Assign to…', <Icon name="user" />, () => issuePickers.assignee(ctx, at), 'A'),
        on(ctx.assigneeId === d.me.id ? 'Unassign from me' : 'Assign to me', <Icon name="user" />, () => assignToMe(ctx), 'I'),
        on('Change labels…', <Icon name="tag" />, () => issuePickers.labels(ctx, at), 'L'),
        on('Move to project…', <Icon name="projects" />, () => issuePickers.project(ctx, at), '⇧P'),
        on('Move to cycle…', <Icon name="cycles" />, () => issuePickers.cycle(ctx, at), '⇧C'),
        on('Set estimate…', <Icon name="estimate" />, () => issuePickers.estimate(ctx, at), '⇧E'),
        on('Set due date…', <Icon name="calendar" />, () => issuePickers.dueDate(ctx, at), '⇧D'),
        on('Set parent issue…', <Icon name="subissue" />, () => issuePickers.parent(ctx, at)),
        on('Add sub-issue', <Icon name="plus" />, () => openCreate({ parentId: ctx.id, projectId: ctx.projectId, cycle: ctx.cycle })),
        on('Copy git branch name', <Icon name="branch" />, () => copyBranch(ctx), '⌘⇧.'),
        on('Copy issue ID', <Icon name="copy" />, () => copyId(ctx), '⌘.'),
        on('Copy issue link', <Icon name="link" />, () => copyLink(ctx), '⌘⇧,'),
        on('Delete issue', <Icon name="trash" />, () => confirmDelete(ctx), '⌘⌫'),
      );
    }
    return list;
  }, [d, ctx]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const cmds = s ? commands.filter((c) => c.label.toLowerCase().includes(s)) : commands;
    if (!s) return cmds;
    const n = s.replace(/^[a-z]+-/, '');
    const issues = d.issues
      .map((i) => {
        const idHit = /^\d+$/.test(n) && String(i.number).startsWith(n) || i.identifier.toLowerCase() === s;
        const titleHit = i.title.toLowerCase().includes(s);
        const bodyHit = !titleHit && i.description.toLowerCase().includes(s);
        return { i, score: idHit ? 3 : titleHit ? 2 : bodyHit ? 1 : 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.i.number - a.i.number)
      .slice(0, 12)
      .map(({ i }): Cmd => ({
        key: `issue-${i.id}`, label: `${i.identifier}  ${i.title}`, section: 'Issues',
        icon: <StatusIcon status={d.statuses.find((st) => st.id === i.statusId)} statuses={d.statuses} />,
        run: () => navigate(`/issue/${i.identifier}`),
      }));
    return [...issues, ...cmds];
  }, [q, commands, d]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const run = (c: Cmd | undefined) => { if (!c) return; close(); setTimeout(c.run, 0); };

  let lastSection = '';
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog palette" onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
        if (e.key === 'Enter') { e.preventDefault(); run(results[active]); }
      }}>
        {ctx && <div className="palette-context"><span className="muted">{ctx.identifier}</span> {ctx.title}</div>}
        <input className="palette-input" autoFocus placeholder="Type a command or search issues…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="palette-list" ref={listRef}>
          {results.map((c, idx) => {
            const head = c.section !== lastSection ? c.section : null;
            lastSection = c.section;
            return (
              <div key={c.key}>
                {head && <div className="menu-section">{head}</div>}
                <div data-idx={idx} className={`menu-item${idx === active ? ' active' : ''}`} onMouseMove={() => setActive(idx)} onClick={() => run(c)}>
                  <span className="menu-icon">{c.icon}</span>
                  <span className="menu-label">{c.label}</span>
                  {c.hint && <span className="menu-right"><Kbd>{c.hint}</Kbd></span>}
                </div>
              </div>
            );
          })}
          {!results.length && <div className="menu-empty">Nothing matches “{q}”</div>}
        </div>
      </div>
    </div>
  );
}

// ── ? ──────────────────────────────────────────────────────────────────────
const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Command menu and search'], ['C', 'Create issue'], ['/', 'Search'], ['?', 'This sheet'],
  ['J / ↓', 'Next issue'], ['K / ↑', 'Previous issue'], ['↵', 'Open issue'], ['Esc', 'Back / close'],
  ['S', 'Change status'], ['P', 'Set priority'], ['A', 'Assign'], ['I', 'Assign to me'], ['L', 'Labels'],
  ['⇧P', 'Project'], ['⇧C', 'Cycle'], ['⇧E', 'Estimate'], ['⇧D', 'Due date'],
  ['⌘.', 'Copy ID'], ['⌘⇧.', 'Copy git branch name'], ['⌘⇧,', 'Copy link'], ['⌘⌫', 'Delete issue'],
  ['G then M', 'My issues'], ['G then I', 'Issues'], ['G then C', 'Cycles'], ['G then P', 'Projects'], ['G then S', 'Settings'],
];
export function ShortcutSheet() {
  const ui = useUi();
  if (!ui.shortcuts) return null;
  const close = () => setUi({ shortcuts: false });
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <div className="dialog shortcuts" tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="dialog-head"><span>Keyboard shortcuts</span><button className="icon-btn dialog-close" onClick={close}><Icon name="x" size={14} /></button></div>
        <div className="shortcut-grid">{SHORTCUTS.map(([k, v]) => <div key={k} className="shortcut"><span>{v}</span><Kbd>{k}</Kbd></div>)}</div>
      </div>
    </div>
  );
}

export const currentData = () => getState().data;
