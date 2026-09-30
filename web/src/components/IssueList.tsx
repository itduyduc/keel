import { memo, useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { getUi, setUi, openCreate, useUi } from '../ui';
import { navigate } from '../router';
import { groupOrder, sortIssues, shortDate, dayLabel, isOverdue, isClosed, estimateLabel, PRIORITY_NAMES } from '../util';
import { StatusIcon, PriorityIcon, CycleIcon, PrIcon, Icon } from '../icons';
import { Avatar, Chip, LabelChip, ProjectChip } from './bits';
import { issuePickers, cycleProgress } from '../pickers';
import { contextMenu } from '../actions';
import type { Bootstrap, Issue, IssuePatch, Status } from '../types';

const store = {
  get(key: string) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
  set(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window: forget it */ } },
};

export function IssueList({ issues, viewKey, createDefaults = {}, emptyText = 'No issues' }: {
  issues: Issue[]; viewKey: string; createDefaults?: IssuePatch; emptyText?: string;
}) {
  const { data } = useApp();
  const ui = useUi();
  const d = data!;
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>(() => {
    const saved = store.get(`plumb.collapsed.${viewKey}`);
    if (saved) return saved;
    // finished work starts folded away, the way it sits at the bottom in Linear
    return Object.fromEntries(d.statuses.filter((s) => isClosed(s)).map((s) => [s.id, true]));
  });
  const toggle = (id: number) => setCollapsed((c) => { const n = { ...c, [id]: !c[id] }; store.set(`plumb.collapsed.${viewKey}`, n); return n; });

  const groups = useMemo(() => {
    const by = new Map<number, Issue[]>();
    for (const i of issues) { if (!by.has(i.statusId)) by.set(i.statusId, []); by.get(i.statusId)!.push(i); }
    return groupOrder(d.statuses).filter((s) => by.has(s.id)).map((s) => ({ status: s, issues: sortIssues(by.get(s.id)!) }));
  }, [issues, d.statuses]);

  const order = useMemo(() => groups.flatMap((g) => (collapsed[g.status.id] ? [] : g.issues.map((i) => i.id))), [groups, collapsed]);
  useEffect(() => { setUi({ listOrder: order }); }, [order]);
  useEffect(() => () => setUi({ focusedIssueId: null }), []);

  const childCounts = useMemo(() => {
    const m = new Map<number, { total: number; done: number }>();
    for (const i of d.issues) {
      if (!i.parentId) continue;
      const c = m.get(i.parentId) || { total: 0, done: 0 };
      c.total++;
      if (isClosed(d.statuses.find((s) => s.id === i.statusId))) c.done++;
      m.set(i.parentId, c);
    }
    return m;
  }, [d.issues, d.statuses]);

  if (!issues.length) return <div className="empty">{emptyText}</div>;

  return (
    <div className="issue-list" onMouseLeave={() => setUi({ focusedIssueId: null })}>
      {groups.map(({ status, issues: list }) => (
        <section key={status.id}>
          <div className="group-header" onClick={() => toggle(status.id)}>
            <span className={`group-chevron${collapsed[status.id] ? ' closed' : ''}`}><Icon name="chevronDown" size={12} /></span>
            <StatusIcon status={status} statuses={d.statuses} />
            <span className="group-name">{status.name}</span>
            <span className="group-count">{list.length}</span>
            <button className="icon-btn group-add" title={`New issue in ${status.name}`}
              onClick={(e) => { e.stopPropagation(); openCreate({ ...createDefaults, statusId: status.id }); }}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          {!collapsed[status.id] && list.map((i) => (
            <IssueRow key={i.id} issue={i} data={d} status={status} focused={ui.focusedIssueId === i.id} sub={childCounts.get(i.id)} />
          ))}
        </section>
      ))}
    </div>
  );
}

export const IssueRow = memo(function IssueRow({ issue, data, status, focused, sub }: {
  issue: Issue; data: Bootstrap; status: Status; focused: boolean; sub?: { total: number; done: number };
}) {
  const assignee = data.users.find((u) => u.id === issue.assigneeId);
  const project = issue.projectId ? data.projects.find((p) => p.id === issue.projectId) : undefined;
  const labels = issue.labelIds.map((id) => data.labels.find((l) => l.id === id)).filter(Boolean);
  const cycle = issue.cycle ? data.cycles.cycles.find((c) => c.number === issue.cycle) : undefined;
  const stop = (fn: (el: Element) => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(e.currentTarget); };
  const closed = isClosed(status);

  return (
    <div
      className={`issue-row${focused ? ' focused' : ''}`}
      data-issue-row={issue.id}
      onMouseEnter={() => { if (getUi().focusedIssueId !== issue.id) setUi({ focusedIssueId: issue.id }); }}
      onClick={() => navigate(`/issue/${issue.identifier}`)}
      onContextMenu={(e) => { e.preventDefault(); contextMenu(issue, e); }}
    >
      <span className="row-priority" title={PRIORITY_NAMES[issue.priority]} onClick={stop((el) => issuePickers.priority(issue, el))}>
        <PriorityIcon priority={issue.priority} />
      </span>
      <span className="row-id">{issue.identifier}</span>
      <span className="row-status" title={status.name} onClick={stop((el) => issuePickers.status(issue, el))}>
        <StatusIcon status={status} statuses={data.statuses} />
      </span>
      <span className="row-title">{issue.title}</span>
      <span className="row-meta">
        {sub && <Chip title="Sub-issues"><Icon name="subissue" size={13} /><span>{sub.done}/{sub.total}</span></Chip>}
        {labels.map((l) => <LabelChip key={l!.id} label={l!} onClick={stop((el) => issuePickers.labels(issue, el))} />)}
        {issue.prs.map((pr) => (
          <Chip key={pr.id} title={`${pr.repo}#${pr.number} · ${pr.title}`} onClick={(e) => { e.stopPropagation(); window.open(pr.url, '_blank', 'noopener'); }}>
            <PrIcon pr={pr} size={14} /><span>#{pr.number}</span>
          </Chip>
        ))}
        {issue.cycle !== null && (
          <Chip title={`Cycle ${issue.cycle}`} onClick={stop((el) => issuePickers.cycle(issue, el))}>
            <CycleIcon size={14} progress={cycle?.isCurrent ? cycleProgress(cycle.startsAt, cycle.endsAt) : cycle?.isPast ? 1 : 0} /><span>{issue.cycle}</span>
          </Chip>
        )}
        {issue.estimate !== null && (
          <Chip title="Estimate" onClick={stop((el) => issuePickers.estimate(issue, el))}><Icon name="estimate" size={13} /><span>{estimateLabel(data, issue.estimate)}</span></Chip>
        )}
        {issue.dueDate && (
          <Chip title="Due date" className={isOverdue(issue.dueDate) && !closed ? 'overdue' : ''} onClick={stop((el) => issuePickers.dueDate(issue, el))}>
            <Icon name="calendar" size={13} /><span>{dayLabel(issue.dueDate)}</span>
          </Chip>
        )}
        {project && <ProjectChip project={project} onClick={stop((el) => issuePickers.project(issue, el))} />}
      </span>
      <span className="row-assignee" title={assignee ? assignee.name : 'Unassigned'} onClick={stop((el) => issuePickers.assignee(issue, el))}>
        <Avatar user={assignee} size={18} />
      </span>
      <span className="row-date" title={`Created ${new Date(issue.createdAt).toLocaleString()}`}>{shortDate(issue.createdAt)}</span>
    </div>
  );
});
