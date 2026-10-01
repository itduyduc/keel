import { useEffect, useMemo } from 'react';
import { useApp, saveProject } from '../state';
import { navigate } from '../router';
import { openCreate, setUi } from '../ui';
import { IssueList } from '../components/IssueList';
import { FilterBar, FilterButton, applyFilters, useFilters } from '../components/Filters';
import { TeamIcon, CycleIcon, ProjectIcon, Icon } from '../icons';
import { cycleProgress } from '../pickers';
import { cycleSpan, isClosed } from '../util';
import { openMenu, anchorOf } from '../components/Menu';
import type { Issue, IssuePatch } from '../types';
import { ViewHeader, teamTabs } from './Header';
import { ViewsMenuButton } from './Views';

function FilteredList({ viewKey, issues, createDefaults, emptyText, header }: {
  viewKey: string; issues: Issue[]; createDefaults?: IssuePatch; emptyText?: string;
  header: (filterButton: React.ReactNode) => React.ReactNode;
}) {
  const [filters, setFilters] = useFilters(viewKey);
  const shown = useMemo(() => applyFilters(issues, filters), [issues, filters]);
  useEffect(() => {
    setUi({ viewDefaults: createDefaults || {}, lastList: location.pathname + location.search });
    return () => setUi({ viewDefaults: {} });
  }, [viewKey]);
  useEffect(() => { setUi({ currentFilters: filters }); }, [filters]);
  return (
    <>
      {header(
        <>
          <FilterButton filters={filters} setFilters={setFilters} />
          <button className="btn ghost small" title="New issue (C)" onClick={() => openCreate(createDefaults)}><Icon name="plus" size={14} /> New issue</button>
        </>,
      )}
      <FilterBar filters={filters} setFilters={setFilters} />
      <div className="main-scroll">
        <IssueList issues={shown} viewKey={viewKey} createDefaults={createDefaults} emptyText={emptyText} />
      </div>
    </>
  );
}

export function TeamIssues({ tab }: { tab: 'all' | 'active' | 'backlog' }) {
  const { data } = useApp();
  const d = data!;
  const issues = useMemo(() => {
    const type = (i: Issue) => d.statuses.find((s) => s.id === i.statusId)?.type;
    if (tab === 'active') return d.issues.filter((i) => type(i) === 'started' || type(i) === 'unstarted');
    if (tab === 'backlog') return d.issues.filter((i) => type(i) === 'backlog');
    return d.issues;
  }, [d.issues, d.statuses, tab]);
  return (
    <FilteredList
      key={tab}
      viewKey={`issues-${tab}`}
      issues={issues}
      emptyText={tab === 'backlog' ? 'The backlog is empty.' : 'No issues yet. Press C to create one.'}
      header={(right) => (
        <ViewHeader
          icon={<TeamIcon color={d.team.color} size={16} />}
          title="Issues"
          tabs={teamTabs(d, tab)}
          extra={<ViewsMenuButton views={d.views} active={tab} />}
          right={right}
        />
      )}
    />
  );
}

export function MyIssues({ tab }: { tab: 'assigned' | 'created' }) {
  const { data } = useApp();
  const d = data!;
  const issues = useMemo(() => d.issues.filter((i) => (tab === 'assigned' ? i.assigneeId === d.me.id : i.creatorId === d.me.id)), [d.issues, d.me.id, tab]);
  return (
    <FilteredList
      key={tab}
      viewKey={`my-${tab}`}
      issues={issues}
      createDefaults={tab === 'assigned' ? { assigneeId: d.me.id } : {}}
      emptyText={tab === 'assigned' ? 'Nothing is assigned to you.' : "You haven't created any issues yet."}
      header={(right) => (
        <ViewHeader
          icon={<Icon name="user" size={16} color="#9b9b9e" />}
          title="My issues"
          tabs={[
            { key: 'assigned', label: 'Assigned', href: '/my-issues', active: tab === 'assigned' },
            { key: 'created', label: 'Created', href: '/my-issues/created', active: tab === 'created' },
          ]}
          right={right}
        />
      )}
    />
  );
}

function progressOf(issues: Issue[], statuses: { id: number; type: string }[]) {
  const done = issues.filter((i) => isClosed(statuses.find((s) => s.id === i.statusId) as any)).length;
  return { done, total: issues.length, pct: issues.length ? Math.round((done / issues.length) * 100) : 0 };
}

export function ProjectsView() {
  const { data } = useApp();
  const d = data!;
  const projects = d.projects.filter((p) => !p.archived);
  return (
    <>
      <ViewHeader icon={<Icon name="projects" size={16} color="#9b9b9e" />} title="Projects" right={
        <button className="btn ghost small" onClick={(e) => newProject(e.currentTarget)}><Icon name="plus" size={14} /> New project</button>
      } />
      <div className="main-scroll">
        <div className="table-list">
          <div className="table-head"><span>Name</span><span>Issues</span><span>Progress</span></div>
          {projects.map((p) => {
            const list = d.issues.filter((i) => i.projectId === p.id);
            const pr = progressOf(list, d.statuses);
            return (
              <div key={p.id} className="table-row" onClick={() => navigate(`/project/${p.id}`)}>
                <span className="table-name"><ProjectIcon icon={p.icon} color={p.color} /> {p.name}</span>
                <span className="muted">{pr.total}</span>
                <span className="progress"><span className="progress-bar"><span style={{ width: `${pr.pct}%`, background: p.color }} /></span><span className="muted">{pr.pct}%</span></span>
              </div>
            );
          })}
          {!projects.length && <div className="empty">No projects yet.</div>}
        </div>
      </div>
    </>
  );
}

function newProject(el: Element) {
  openMenu({
    anchor: anchorOf(el), width: 280, align: 'right',
    content: (close) => (
      <form className="menu-form" onSubmit={async (e) => {
        e.preventDefault();
        const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value.trim();
        if (!name) return;
        const p = await saveProject({ name });
        close();
        if (p) navigate(`/project/${p.id}`);
      }}>
        <input name="name" placeholder="Project name" autoFocus />
        <button type="submit" className="btn primary small">Create</button>
      </form>
    ),
  });
}

export function ProjectView({ id }: { id: number }) {
  const { data } = useApp();
  const d = data!;
  const project = d.projects.find((p) => p.id === id);
  const issues = useMemo(() => d.issues.filter((i) => i.projectId === id), [d.issues, id]);
  if (!project) return <div className="empty">No such project.</div>;
  const pr = progressOf(issues, d.statuses);
  return (
    <FilteredList
      viewKey={`project-${id}`}
      issues={issues}
      createDefaults={{ projectId: id }}
      emptyText="No issues in this project yet."
      header={(right) => (
        <ViewHeader
          icon={<ProjectIcon icon={project.icon} color={project.color} />}
          title={<><span className="crumb" onClick={() => navigate('/projects')}>Projects</span><Icon name="chevronRight" size={12} className="crumb-sep" />{project.name}<span className="muted small header-stat">{pr.done}/{pr.total} done</span></>}
          right={right}
        />
      )}
    />
  );
}

export function CyclesView() {
  const { data } = useApp();
  const d = data!;
  const cycles = [...d.cycles.cycles].sort((a, b) => b.number - a.number);
  return (
    <>
      <ViewHeader icon={<Icon name="cycles" size={16} color="#9b9b9e" />} title="Cycles" />
      <div className="main-scroll">
        <div className="table-list">
          <div className="table-head"><span>Cycle</span><span>Issues</span><span>Progress</span></div>
          {cycles.map((c) => {
            const list = d.issues.filter((i) => i.cycle === c.number);
            const pr = progressOf(list, d.statuses);
            const points = list.reduce((n, i) => n + (i.estimate || 0), 0);
            return (
              <div key={c.number} className={`table-row${c.isCurrent ? ' current' : ''}`} onClick={() => navigate(`/cycle/${c.number}`)}>
                <span className="table-name">
                  <CycleIcon progress={c.isCurrent ? cycleProgress(c.startsAt, c.endsAt) : c.isPast ? 1 : 0} />
                  Cycle {c.number}
                  {c.isCurrent && <span className="pill">Current</span>}
                  <span className="muted small">{cycleSpan(c.startDate, c.endDate)}</span>
                </span>
                <span className="muted">{pr.total}{points ? ` · ${points} pts` : ''}</span>
                <span className="progress"><span className="progress-bar"><span style={{ width: `${pr.pct}%` }} /></span><span className="muted">{pr.pct}%</span></span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function CycleView({ number }: { number: number }) {
  const { data } = useApp();
  const d = data!;
  const cycle = d.cycles.cycles.find((c) => c.number === number);
  const issues = useMemo(() => d.issues.filter((i) => i.cycle === number), [d.issues, number]);
  const pr = progressOf(issues, d.statuses);
  return (
    <FilteredList
      viewKey={`cycle-${number}`}
      issues={issues}
      createDefaults={{ cycle: number }}
      emptyText="Nothing in this cycle yet."
      header={(right) => (
        <ViewHeader
          icon={<CycleIcon progress={cycle?.isCurrent ? cycleProgress(cycle.startsAt, cycle.endsAt) : cycle?.isPast ? 1 : 0} />}
          title={<><span className="crumb" onClick={() => navigate('/cycles')}>Cycles</span><Icon name="chevronRight" size={12} className="crumb-sep" />Cycle {number}
            {cycle && <span className="muted small header-stat">{cycleSpan(cycle.startDate, cycle.endDate)} · {pr.done}/{pr.total} done</span>}</>}
          right={right}
        />
      )}
    />
  );
}
