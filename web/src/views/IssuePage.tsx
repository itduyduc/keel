import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp, loadDetail, updateIssue, addComment, editComment, deleteComment, toggleReaction } from '../state';
import { setUi, useUi, openCreate } from '../ui';
import { navigate } from '../router';
import { issuePickers, cycleProgress } from '../pickers';
import { copyBranch, copyId, copyLink, contextMenu } from '../actions';
import { StatusIcon, PriorityIcon, CycleIcon, PrIcon, ProjectIcon, TeamIcon, Icon, prColor } from '../icons';
import { Avatar, LabelChip, ProjectChip } from '../components/bits';
import { Markdown } from '../components/Markdown';
import { Editor } from '../components/Editor';
import { openMenu, anchorOf } from '../components/Menu';
import { PRIORITY_NAMES, ago, fullTime, dayLabel, isOverdue, isClosed, estimateLabel, cycleSpan, sortIssues } from '../util';
import type { Activity, Bootstrap, Comment, Issue } from '../types';

const REACTIONS = ['👍', '👎', '❤️', '🎉', '😄', '👀', '🚀', '🙏'];

export function IssuePage({ refStr }: { refStr: string }) {
  const { data, detail } = useApp();
  const ui = useUi();
  const d = data!;
  const number = Number((refStr.match(/(\d+)$/) || [])[1]);
  const issue = d.issues.find((i) => i.number === number);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
    loadDetail(number).catch(() => setMissing(true));
  }, [number]);
  useEffect(() => { setUi({ pageIssueId: issue?.id ?? null }); return () => setUi({ pageIssueId: null }); }, [issue?.id]);

  if (!issue) {
    return <div className="empty">{missing ? `${refStr} doesn't exist, or was deleted.` : 'Loading…'}</div>;
  }
  const det = detail[issue.id];
  const pos = ui.listOrder.indexOf(issue.id);
  const go = (delta: number) => {
    const id = ui.listOrder[pos + delta];
    const next = id && d.issues.find((x) => x.id === id);
    if (next) navigate(`/issue/${next.identifier}`, { replace: true });
  };

  return (
    <div className="issue-page">
      <header className="topbar">
        <div className="crumbs">
          <TeamIcon color={d.team.color} size={16} />
          <span className="crumb" onClick={() => navigate('/issues')}>{d.team.name}</span>
          <Icon name="chevronRight" size={12} className="crumb-sep" />
          <span className="crumb" onClick={() => navigate('/issues')}>Issues</span>
          <Icon name="chevronRight" size={12} className="crumb-sep" />
          <span className="crumb-current"><span className="crumb-id">{issue.identifier}</span> {issue.title}</span>
          <button className="icon-btn" title="More actions" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(issue, { clientX: r.left, clientY: r.bottom + 4 }); }}>
            <Icon name="more" size={16} />
          </button>
        </div>
        {pos >= 0 && (
          <div className="pager">
            <span className="muted">{pos + 1} / {ui.listOrder.length}</span>
            <button className="icon-btn" title="Next issue (J)" disabled={pos >= ui.listOrder.length - 1} onClick={() => go(1)}><Icon name="arrowDown" size={14} /></button>
            <button className="icon-btn" title="Previous issue (K)" disabled={pos <= 0} onClick={() => go(-1)}><Icon name="arrowUp" size={14} /></button>
          </div>
        )}
      </header>
      <div className="main-scroll">
        <div className="issue-body">
          <div className="issue-main">
            <Title issue={issue} />
            <Description issue={issue} />
            <SubIssues issue={issue} data={d} />
            <Timeline issue={issue} data={d} comments={det?.comments} activity={det?.activity} />
          </div>
          <Rail issue={issue} data={d} />
        </div>
      </div>
    </div>
  );
}

function Title({ issue }: { issue: Issue }) {
  const [value, setValue] = useState(issue.title);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setValue(issue.title); }, [issue.title, editing]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px`; }
  }, [value]);
  const save = () => {
    setEditing(false);
    const t = value.replace(/\s+/g, ' ').trim();
    if (t && t !== issue.title) updateIssue(issue, { title: t });
    else setValue(issue.title);
  };
  return (
    <textarea
      ref={ref}
      className="issue-title"
      value={value}
      rows={1}
      spellCheck
      onFocus={() => setEditing(true)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setValue(issue.title); setTimeout(() => ref.current?.blur(), 0); }
      }}
    />
  );
}

function Description({ issue }: { issue: Issue }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issue.description);
  const cancelled = useRef(false);
  const start = () => { setDraft(issue.description); cancelled.current = false; setEditing(true); };
  const finish = () => {
    setEditing(false);
    if (cancelled.current) return;
    if (draft !== issue.description) updateIssue(issue, { description: draft });
  };
  if (editing) {
    return (
      <Editor
        className="description-editor"
        value={draft}
        onChange={setDraft}
        autoFocus
        minRows={4}
        placeholder="Add description… (markdown)"
        onBlur={finish}
        onSubmit={() => (document.activeElement as HTMLElement)?.blur()}
        onCancel={() => { cancelled.current = true; (document.activeElement as HTMLElement)?.blur(); }}
      />
    );
  }
  return (
    <div className="description" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) start(); }}>
      {issue.description.trim() ? <Markdown source={issue.description} /> : <p className="placeholder">Add description…</p>}
    </div>
  );
}

function SubIssues({ issue, data }: { issue: Issue; data: Bootstrap }) {
  const children = sortIssues(data.issues.filter((i) => i.parentId === issue.id));
  const done = children.filter((c) => isClosed(data.statuses.find((s) => s.id === c.statusId))).length;
  return (
    <div className="subissues">
      <div className="section-head">
        <span>Sub-issues</span>
        {children.length > 0 && <span className="muted">{done}/{children.length}</span>}
        <button className="icon-btn" title="Add sub-issue" onClick={() => openCreate({ parentId: issue.id, projectId: issue.projectId, cycle: issue.cycle })}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {children.map((c) => {
        const st = data.statuses.find((s) => s.id === c.statusId);
        return (
          <div key={c.id} className="subissue-row" onClick={() => navigate(`/issue/${c.identifier}`)} onContextMenu={(e) => { e.preventDefault(); contextMenu(c, e); }}>
            <span onClick={(e) => { e.stopPropagation(); issuePickers.status(c, e.currentTarget); }}><StatusIcon status={st} statuses={data.statuses} /></span>
            <span className="row-id">{c.identifier}</span>
            <span className="row-title">{c.title}</span>
            <Avatar user={data.users.find((u) => u.id === c.assigneeId)} size={16} />
          </div>
        );
      })}
    </div>
  );
}

// ── activity and comments, in one timeline ─────────────────────────────────
function Timeline({ issue, data, comments, activity }: { issue: Issue; data: Bootstrap; comments?: Comment[]; activity?: Activity[] }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const submit = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    if (await addComment(issue, draft)) setDraft('');
    setSending(false);
  };
  const items = [
    ...(activity || []).map((a) => ({ at: a.createdAt, id: `a${a.id}`, a })),
    ...(comments || []).map((c) => ({ at: c.createdAt, id: `c${c.id}`, c })),
  ].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));

  return (
    <div className="timeline">
      <div className="section-head"><span>Activity</span></div>
      {!activity && <div className="muted small">Loading…</div>}
      {items.map((it) => ('a' in it && it.a ? <ActivityLine key={it.id} a={it.a} data={data} /> : <CommentCard key={it.id} c={(it as any).c} data={data} />))}
      <div className="composer">
        <Editor value={draft} onChange={setDraft} onSubmit={submit} placeholder="Leave a comment…" minRows={2} />
        <div className="composer-foot">
          <span className="muted small">Markdown · @ to mention · ⌘↵ to send</span>
          <button className="btn primary small" disabled={!draft.trim() || sending} onClick={submit}>Comment</button>
        </div>
      </div>
    </div>
  );
}

function actorOf(a: Activity, data: Bootstrap) {
  if (a.actorKind === 'github') return { name: 'GitHub', user: null };
  if (a.actorKind === 'system') return { name: 'Plumb', user: null };
  const u = data.users.find((x) => x.id === a.actorId);
  return { name: u?.name || a.actorName || 'Someone', user: u };
}

function ActivityLine({ a, data }: { a: Activity; data: Bootstrap }) {
  const actor = actorOf(a, data);
  const b = (s: string | null) => <strong>{s}</strong>;
  const status = (name: string | null) => {
    const s = data.statuses.find((x) => x.name === name);
    return <span className="inline-status">{s && <StatusIcon status={s} statuses={data.statuses} size={12} />}{b(name)}</span>;
  };
  let text: React.ReactNode;
  switch (a.kind) {
    case 'created': text = <>created the issue</>; break;
    case 'title': text = <>changed the title to {b(a.to)}</>; break;
    case 'description': text = <>updated the description</>; break;
    case 'status': text = <>changed status from {status(a.from)} to {status(a.to)}</>; break;
    case 'priority': text = a.to === 'No priority' ? <>removed the priority</> : <>set priority to {b(a.to)}</>; break;
    case 'assignee': text = a.to ? (a.to === actor.name ? <>self-assigned the issue</> : <>assigned the issue to {b(a.to)}</>) : <>unassigned {b(a.from)}</>; break;
    case 'project': text = a.to ? <>added the issue to {b(a.to)}</> : <>removed the issue from {b(a.from)}</>; break;
    case 'cycle': text = a.to ? (a.from ? <>moved the issue from Cycle {a.from} to {b(`Cycle ${a.to}`)}</> : <>added the issue to {b(`Cycle ${a.to}`)}</>) : <>removed the issue from Cycle {a.from}</>; break;
    case 'estimate': text = a.to ? <>set the estimate to {b(estimateLabel(data, Number(a.to)))}</> : <>removed the estimate</>; break;
    case 'due_date': text = a.to ? <>set the due date to {b(dayLabel(a.to))}</> : <>removed the due date</>; break;
    case 'parent': text = a.to ? <>made this a sub-issue of {b(a.to)}</> : <>removed the parent {b(a.from)}</>; break;
    case 'label_added': text = <>added label {b(a.to)}</>; break;
    case 'label_removed': text = <>removed label {b(a.from)}</>; break;
    case 'pr_linked': text = <>linked <a href={a.meta?.url} target="_blank" rel="noopener noreferrer">{a.to}</a> {a.meta?.title}</>; break;
    case 'pr_state': text = <><a href={a.meta?.url} target="_blank" rel="noopener noreferrer">{a.meta?.repo}#{a.meta?.number}</a> was {b(a.to === 'open' ? 'reopened' : a.to)}</>; break;
    case 'rolled_over': text = <>moved it from Cycle {a.from} to {b(`Cycle ${a.to}`)} when the cycle ended</>; break;
    case 'deleted': text = <>deleted the issue</>; break;
    default: text = <>{a.kind}</>;
  }
  return (
    <div className="activity-line">
      <span className="activity-icon">
        {a.actorKind === 'github' ? <Icon name="github" size={14} /> : a.actorKind === 'system' ? <Icon name="cycles" size={14} /> : <Avatar user={actor.user} size={16} />}
      </span>
      <span className="activity-text"><span className="activity-actor">{actor.name}</span> {text}</span>
      <span className="activity-time" title={fullTime(a.createdAt)}>· {ago(a.createdAt)}</span>
    </div>
  );
}

function CommentCard({ c, data }: { c: Comment; data: Bootstrap }) {
  const author = data.users.find((u) => u.id === c.userId);
  const mine = c.userId === data.me.id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const save = async () => { if (draft.trim() && (await editComment(c, draft))) setEditing(false); };
  return (
    <div className="comment" id={`comment-${c.id}`}>
      <div className="comment-head">
        <Avatar user={author} size={18} />
        <span className="comment-author">{author?.name || 'Someone'}</span>
        <span className="muted" title={fullTime(c.createdAt)}>{ago(c.createdAt)}{c.editedAt ? ' · edited' : ''}</span>
        <span className="comment-tools">
          <button className="icon-btn" title="React" onClick={(e) => reactMenu(c, e.currentTarget)}><Icon name="smile" size={14} /></button>
          {mine && <button className="icon-btn" title="Edit" onClick={() => { setDraft(c.body); setEditing(true); }}><Icon name="edit" size={14} /></button>}
          {(mine || data.me.role === 'admin') && <button className="icon-btn" title="Delete" onClick={() => { if (confirm('Delete this comment?')) deleteComment(c); }}><Icon name="trash" size={14} /></button>}
        </span>
      </div>
      {editing ? (
        <div className="comment-edit">
          <Editor value={draft} onChange={setDraft} autoFocus onSubmit={save} onCancel={() => setEditing(false)} minRows={2} />
          <div className="composer-foot">
            <button className="btn ghost small" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn primary small" onClick={save}>Save</button>
          </div>
        </div>
      ) : <Markdown source={c.body} className="comment-body" />}
      {c.reactions.length > 0 && (
        <div className="reactions">
          {c.reactions.map((r) => (
            <button key={r.emoji} className={`reaction${r.userIds.includes(data.me.id) ? ' mine' : ''}`}
              title={r.userIds.map((id) => data.users.find((u) => u.id === id)?.name).join(', ')}
              onClick={() => toggleReaction(c, r.emoji)}>
              <span>{r.emoji}</span><span>{r.userIds.length}</span>
            </button>
          ))}
          <button className="reaction add" title="Add reaction" onClick={(e) => reactMenu(c, e.currentTarget)}><Icon name="smile" size={13} /></button>
        </div>
      )}
    </div>
  );
}

function reactMenu(c: Comment, el: Element) {
  openMenu({
    anchor: anchorOf(el), width: 232,
    content: (close) => (
      <div className="emoji-grid">
        {REACTIONS.map((e) => <button key={e} onClick={() => { toggleReaction(c, e); close(); }}>{e}</button>)}
      </div>
    ),
  });
}

// ── the right rail ─────────────────────────────────────────────────────────
function Rail({ issue, data }: { issue: Issue; data: Bootstrap }) {
  const status = data.statuses.find((s) => s.id === issue.statusId);
  const assignee = data.users.find((u) => u.id === issue.assigneeId);
  const project = data.projects.find((p) => p.id === issue.projectId);
  const labels = issue.labelIds.map((id) => data.labels.find((l) => l.id === id)).filter(Boolean);
  const parent = issue.parentId ? data.issues.find((i) => i.id === issue.parentId) : undefined;
  const cycle = data.cycles.cycles.find((c) => c.number === issue.cycle);
  const closed = isClosed(status);
  const prop = (key: keyof typeof issuePickers, icon: React.ReactNode, label: React.ReactNode, empty = false, title?: string) => (
    <button className={`prop${empty ? ' empty' : ''}`} title={title} onClick={(e) => issuePickers[key](issue, e.currentTarget)}>
      <span className="prop-icon">{icon}</span><span className="prop-label">{label}</span>
    </button>
  );

  return (
    <aside className="rail">
      <div className="issue-actions">
        <button className="round-btn" title="Copy link (⌘⇧,)" onClick={() => copyLink(issue)}><Icon name="link" /></button>
        <button className="round-btn" title="Copy ID (⌘.)" onClick={() => copyId(issue)}><Icon name="copy" /></button>
        <button className="round-btn" title="Copy git branch name (⌘⇧.)" onClick={() => copyBranch(issue)}><Icon name="branch" /></button>
      </div>
      {issue.prs.length > 0 && (
        <section>
          <h4>Diffs</h4>
          {issue.prs.map((pr) => (
            <a key={pr.id} className="prop pr" href={pr.url} target="_blank" rel="noopener noreferrer" title={`${pr.repo}#${pr.number} · ${pr.draft && pr.state === 'open' ? 'draft' : pr.state}`}>
              <span className="prop-icon"><PrIcon pr={pr} /></span>
              <span className="prop-label">{pr.title}</span>
              <span className="pr-state" style={{ color: prColor(pr) }}>{pr.draft && pr.state === 'open' ? 'Draft' : pr.state === 'open' ? 'Open' : pr.state === 'merged' ? 'Merged' : 'Closed'}</span>
            </a>
          ))}
        </section>
      )}
      <section>
        <h4>Properties</h4>
        {prop('status', <StatusIcon status={status} statuses={data.statuses} />, status?.name, false, 'Change status (S)')}
        {prop('priority', <PriorityIcon priority={issue.priority} />, issue.priority ? PRIORITY_NAMES[issue.priority] : 'Set priority', !issue.priority, 'Set priority (P)')}
        {prop('assignee', <Avatar user={assignee} size={16} />, assignee?.name || 'Assign', !assignee, 'Assign (A)')}
        {prop('cycle', <CycleIcon progress={cycle?.isCurrent ? cycleProgress(cycle.startsAt, cycle.endsAt) : cycle?.isPast ? 1 : 0} />, issue.cycle !== null ? `Cycle ${issue.cycle}` : 'Add to cycle', issue.cycle === null, cycle ? cycleSpan(cycle.startDate, cycle.endDate) : 'Cycle (⇧C)')}
        {prop('estimate', <Icon name="estimate" />, issue.estimate !== null ? `${estimateLabel(data, issue.estimate)} ${data.team.estimateScale === 'tshirt' ? '' : 'points'}` : 'Estimate', issue.estimate === null, 'Estimate (⇧E)')}
        {prop('dueDate', <Icon name="calendar" color={issue.dueDate && isOverdue(issue.dueDate) && !closed ? '#eb5757' : undefined} />,
          issue.dueDate ? <span className={isOverdue(issue.dueDate) && !closed ? 'overdue-text' : ''}>{dayLabel(issue.dueDate)}</span> : 'Due date', !issue.dueDate, 'Due date (⇧D)')}
      </section>
      <section>
        <h4>Labels</h4>
        {labels.length > 0 && (
          <div className="rail-labels">
            {labels.map((l) => <LabelChip key={l!.id} label={l!} onClick={(e) => issuePickers.labels(issue, e.currentTarget)} />)}
          </div>
        )}
        <button className="prop empty" onClick={(e) => issuePickers.labels(issue, e.currentTarget)}><span className="prop-icon"><Icon name="tag" /></span><span className="prop-label">Add label</span></button>
      </section>
      <section>
        <h4>Project</h4>
        {project
          ? <div className="rail-labels"><ProjectChip project={project} onClick={(e) => issuePickers.project(issue, e.currentTarget)} /></div>
          : <button className="prop empty" onClick={(e) => issuePickers.project(issue, e.currentTarget)}><span className="prop-icon"><ProjectIcon icon="cube" color="#6e6e73" /></span><span className="prop-label">Add to project</span></button>}
      </section>
      {parent && (
        <section>
          <h4>Parent</h4>
          <button className="prop" onClick={() => navigate(`/issue/${parent.identifier}`)}>
            <span className="prop-icon"><StatusIcon status={data.statuses.find((s) => s.id === parent.statusId)} statuses={data.statuses} /></span>
            <span className="prop-label"><span className="muted">{parent.identifier}</span> {parent.title}</span>
          </button>
        </section>
      )}
    </aside>
  );
}
