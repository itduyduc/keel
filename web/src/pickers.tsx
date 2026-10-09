// Property pickers. Each takes the current value and what to do with a new one,
// so the same picker edits a saved issue or a draft in the create dialog.
import { getState, updateIssue } from './state';
import { openMenu, anchorOf, type MenuOption, type RectLike } from './components/Menu';
import { StatusIcon, PriorityIcon, CycleIcon, ProjectIcon, TeamIcon, Icon } from './icons';
import { Avatar, LabelDot } from './components/bits';
import { PRIORITY_NAMES, PRIORITY_ORDER, cycleSpan, dayLabel, estimateLabel, teamOf, todayString } from './util';
import { toast } from './toast';
import type { Issue, IssuePatch, Team } from './types';

type Anchor = Element | RectLike | null | undefined;
const data = () => getState().data!;

export function pickTeam(value: number, anchor: Anchor, onChange: (id: number) => void) {
  openMenu({
    anchor: anchorOf(anchor), placeholder: 'Team…', numbered: true,
    options: () => data().teams.map((t) => ({ key: String(t.id), label: t.name, keywords: t.key, icon: <TeamIcon color={t.color} size={14} />, right: <span className="muted">{t.key}</span>, selected: t.id === value })),
    onSelect: (o) => onChange(Number(o.key)),
  });
}

export function pickStatus(value: number, anchor: Anchor, onChange: (id: number) => void) {
  openMenu({
    anchor: anchorOf(anchor), placeholder: 'Change status…', numbered: true,
    options: () => data().statuses.map((s) => ({ key: String(s.id), label: s.name, icon: <StatusIcon status={s} statuses={data().statuses} />, selected: s.id === value })),
    onSelect: (o) => onChange(Number(o.key)),
  });
}

export function pickPriority(value: number, anchor: Anchor, onChange: (p: number) => void) {
  openMenu({
    anchor: anchorOf(anchor), placeholder: 'Set priority…', numbered: true,
    options: () => [0, ...PRIORITY_ORDER.slice(0, 4)].map((p) => ({ key: String(p), label: PRIORITY_NAMES[p], icon: <PriorityIcon priority={p} />, selected: p === value })),
    onSelect: (o) => onChange(Number(o.key)),
  });
}

// a private team's issues go only to its members
export function pickAssignee(value: number | null, anchor: Anchor, onChange: (id: number | null) => void, team?: Team) {
  openMenu({
    anchor: anchorOf(anchor), placeholder: 'Assign to…', numbered: true,
    options: () => {
      const me = data().me;
      const users = data().users.filter((u) => u.active && (!team?.private || team.memberIds.includes(u.id))).sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name)));
      return [
        { key: 'none', label: 'No assignee', icon: <Avatar user={null} size={16} />, selected: value === null },
        ...users.map((u) => ({ key: String(u.id), label: u.id === me.id ? `${u.name} (you)` : u.name, keywords: `${u.email} ${u.handle}`, icon: <Avatar user={u} size={16} />, selected: u.id === value })),
      ];
    },
    onSelect: (o) => onChange(o.key === 'none' ? null : Number(o.key)),
  });
}

export function pickLabels(value: () => number[], anchor: Anchor, onChange: (ids: number[]) => void) {
  openMenu({
    anchor: anchorOf(anchor), placeholder: 'Change labels…', multi: true,
    options: () => {
      const cur = value();
      return data().labels.filter((l) => !l.archived || cur.includes(l.id)).map((l) => ({ key: String(l.id), label: l.name, icon: <LabelDot color={l.color} />, selected: cur.includes(l.id) }));
    },
    onSelect: (o) => {
      const id = Number(o.key);
      const cur = value();
      onChange(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    },
  });
}

export function pickProject(value: number | null, anchor: Anchor, onChange: (id: number | null) => void) {
  openMenu({
    anchor: anchorOf(anchor), placeholder: 'Add to project…', numbered: true,
    options: () => [
      { key: 'none', label: 'No project', icon: <Icon name="projects" color="#6e6e73" />, selected: value === null },
      ...data().projects.filter((p) => !p.archived).map((p) => ({ key: String(p.id), label: p.name, icon: <ProjectIcon icon={p.icon} color={p.color} />, selected: p.id === value })),
    ],
    onSelect: (o) => onChange(o.key === 'none' ? null : Number(o.key)),
  });
}

export function pickCycle(value: number | null, anchor: Anchor, onChange: (n: number | null) => void) {
  openMenu({
    anchor: anchorOf(anchor), placeholder: 'Move to cycle…', numbered: true, width: 280,
    options: () => {
      const { cycles } = data().cycles;
      const shown = cycles.filter((c) => !c.isPast || c.number === value);
      return [
        { key: 'none', label: 'No cycle', icon: <CycleIcon />, selected: value === null },
        ...shown.map((c) => ({
          key: String(c.number),
          label: `Cycle ${c.number}${c.isCurrent ? ' · current' : c.number === data().cycles.current + 1 ? ' · next' : ''}`,
          right: <span className="muted">{cycleSpan(c.startDate, c.endDate)}</span>,
          icon: <CycleIcon progress={c.isCurrent ? cycleProgress(c.startsAt, c.endsAt) : 0} />,
          selected: c.number === value,
        })),
      ];
    },
    onSelect: (o) => onChange(o.key === 'none' ? null : Number(o.key)),
  });
}

export function cycleProgress(startsAt: string, endsAt: string) {
  const s = Date.parse(startsAt), e = Date.parse(endsAt);
  return Math.max(0, Math.min(1, (Date.now() - s) / (e - s)));
}

export function pickEstimate(value: number | null, anchor: Anchor, onChange: (n: number | null) => void) {
  openMenu({
    anchor: anchorOf(anchor), placeholder: 'Set estimate…', numbered: true,
    options: () => {
      const d = data();
      const scale = d.workspace.estimateScales[d.workspace.estimateScale];
      return [
        { key: 'none', label: 'No estimate', icon: <Icon name="estimate" color="#6e6e73" />, selected: value === null },
        ...scale.values.map((v) => ({ key: String(v), label: scale.names ? estimateLabel(d, v)! : `${v} point${v === 1 ? '' : 's'}`, icon: <Icon name="estimate" color="#9b9b9e" />, selected: v === value })),
      ];
    },
    onSelect: (o) => onChange(o.key === 'none' ? null : Number(o.key)),
  });
}

const addDays = (date: string, n: number) => {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function pickDueDate(value: string | null, anchor: Anchor, onChange: (d: string | null) => void) {
  const rect = anchorOf(anchor);
  const today = todayString();
  const dow = new Date().getDay(); // 0 = Sunday
  const endOfWeek = addDays(today, (5 - dow + 7) % 7); // this Friday
  const nextWeek = addDays(today, ((1 - dow + 7) % 7) || 7); // next Monday
  const quick: MenuOption[] = [
    { key: today, label: 'Today', right: <span className="muted">{dayLabel(today)}</span> },
    { key: addDays(today, 1), label: 'Tomorrow', right: <span className="muted">{dayLabel(addDays(today, 1))}</span> },
    { key: endOfWeek, label: 'End of this week', right: <span className="muted">{dayLabel(endOfWeek)}</span> },
    { key: nextWeek, label: 'Next week', right: <span className="muted">{dayLabel(nextWeek)}</span> },
    { key: addDays(today, 14), label: 'In two weeks', right: <span className="muted">{dayLabel(addDays(today, 14))}</span> },
    { key: 'custom', label: 'Custom date…', icon: <Icon name="calendar" color="#9b9b9e" /> },
    ...(value ? [{ key: 'none', label: 'Remove due date', icon: <Icon name="x" color="#9b9b9e" /> }] : []),
  ];
  openMenu({
    anchor: rect, placeholder: 'Set due date…', width: 260,
    options: () => quick.map((q) => ({ ...q, icon: q.icon || <Icon name="calendar" color="#9b9b9e" />, selected: q.key === value })),
    onSelect: (o) => {
      if (o.key === 'none') return onChange(null);
      if (o.key !== 'custom') return onChange(o.key);
      setTimeout(() => openMenu({
        anchor: rect, width: 240,
        content: (close) => (
          <form className="menu-form" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('d') as HTMLInputElement).value; if (v) onChange(v); close(); }}>
            <input name="d" type="date" defaultValue={value || today} autoFocus />
            <button type="submit" className="btn primary small">Set</button>
          </form>
        ),
      }), 0);
    },
  });
}

export function pickParent(issue: Issue | null, value: number | null, anchor: Anchor, onChange: (id: number | null) => void) {
  openMenu({
    anchor: anchorOf(anchor), placeholder: 'Set parent issue…', width: 360,
    options: () => {
      const d = data();
      const blocked = new Set<number>();
      if (issue) {
        // an issue can't sit under itself or under one of its own descendants
        const kids = (id: number) => d.issues.filter((x) => x.parentId === id).forEach((x) => { blocked.add(x.id); kids(x.id); });
        blocked.add(issue.id);
        kids(issue.id);
      }
      return [
        ...(value ? [{ key: 'none', label: 'Remove parent', icon: <Icon name="x" color="#9b9b9e" /> }] : []),
        ...d.issues.filter((x) => !blocked.has(x.id)).sort((a, b) => b.number - a.number).map((x) => ({
          key: String(x.id), label: x.title, keywords: x.identifier, selected: x.id === value,
          icon: <span className="menu-id">{x.identifier}</span>,
        })),
      ];
    },
    onSelect: (o) => onChange(o.key === 'none' ? null : Number(o.key)),
  });
}

// the same pickers, wired straight to a saved issue
export const issuePickers = {
  status: (i: Issue, a: Anchor) => pickStatus(i.statusId, a, (v) => updateIssue(i, { statusId: v })),
  priority: (i: Issue, a: Anchor) => pickPriority(i.priority, a, (v) => updateIssue(i, { priority: v })),
  assignee: (i: Issue, a: Anchor) => pickAssignee(i.assigneeId, a, (v) => updateIssue(i, { assigneeId: v }), teamOf(data(), i.teamId)),
  labels: (i: Issue, a: Anchor) => pickLabels(() => currentIssue(i).labelIds, a, (v) => updateIssue(currentIssue(i), { labelIds: v })),
  project: (i: Issue, a: Anchor) => pickProject(i.projectId, a, (v) => updateIssue(i, { projectId: v })),
  cycle: (i: Issue, a: Anchor) => {
    const t = teamOf(data(), i.teamId);
    if (!t.cyclesEnabled) return toast(`${t.name} doesn't run cycles`);
    pickCycle(i.cycle, a, (v) => updateIssue(i, { cycle: v }));
  },
  estimate: (i: Issue, a: Anchor) => pickEstimate(i.estimate, a, (v) => updateIssue(i, { estimate: v })),
  dueDate: (i: Issue, a: Anchor) => pickDueDate(i.dueDate, a, (v) => updateIssue(i, { dueDate: v })),
  parent: (i: Issue, a: Anchor) => pickParent(i, i.parentId, a, (v) => updateIssue(i, { parentId: v } as IssuePatch)),
};
const currentIssue = (i: Issue) => getState().data?.issues.find((x) => x.id === i.id) || i;
