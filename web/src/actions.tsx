// What you can do to an issue, shared by the keyboard, the right-click menu and ⌘K.
import { deleteIssue, getState, updateIssue } from './state';
import { issuePickers } from './pickers';
import { openMenu, type MenuOption } from './components/Menu';
import { branchName, copy, issueUrl } from './util';
import { navigate } from './router';
import { openCreate } from './ui';
import { Icon } from './icons';
import type { Issue } from './types';

export const copyId = (i: Issue) => copy(i.identifier, i.identifier);
export const copyLink = (i: Issue) => copy(issueUrl(i), `link to ${i.identifier}`);
export const copyBranch = (i: Issue) => copy(branchName(i, getState().data!.me), 'git branch name');
export const assignToMe = (i: Issue) => updateIssue(i, { assigneeId: i.assigneeId === getState().data!.me.id ? null : getState().data!.me.id });

export function confirmDelete(i: Issue) {
  if (window.confirm(`Delete ${i.identifier} "${i.title}"?`)) {
    deleteIssue(i);
    if (location.pathname.startsWith('/issue/')) navigate('/issues');
  }
}

export function contextMenu(i: Issue, e: { clientX: number; clientY: number }) {
  const at = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 };
  const row = (key: string, label: string, icon: string, run: () => void, right?: string): MenuOption & { run: () => void } =>
    ({ key, label, icon: <Icon name={icon} color="#9b9b9e" />, right: right ? <span className="muted">{right}</span> : undefined, run });
  const items = [
    row('status', 'Status', 'issues', () => issuePickers.status(i, at), 'S'),
    row('priority', 'Priority', 'chart', () => issuePickers.priority(i, at), 'P'),
    row('assignee', 'Assignee', 'user', () => issuePickers.assignee(i, at), 'A'),
    row('labels', 'Labels', 'tag', () => issuePickers.labels(i, at), 'L'),
    row('project', 'Project', 'projects', () => issuePickers.project(i, at), '⇧P'),
    row('cycle', 'Cycle', 'cycles', () => issuePickers.cycle(i, at), '⇧C'),
    row('estimate', 'Estimate', 'estimate', () => issuePickers.estimate(i, at), '⇧E'),
    row('due', 'Due date', 'calendar', () => issuePickers.dueDate(i, at), '⇧D'),
    row('parent', 'Set parent…', 'subissue', () => issuePickers.parent(i, at)),
    row('sub', 'Add sub-issue', 'plus', () => openCreate({ parentId: i.id, projectId: i.projectId, cycle: i.cycle })),
    row('copy-id', 'Copy ID', 'copy', () => copyId(i), '⌘.'),
    row('copy-link', 'Copy link', 'link', () => copyLink(i), '⌘⇧,'),
    row('copy-branch', 'Copy git branch name', 'branch', () => copyBranch(i), '⌘⇧.'),
    row('delete', 'Delete', 'trash', () => confirmDelete(i), '⌘⌫'),
  ];
  openMenu({
    anchor: at, width: 250, placeholder: `${i.identifier} — type a command…`,
    options: () => items,
    onSelect: (o) => {
      const item = items.find((x) => x.key === o.key);
      // the next picker opens once this menu has closed
      setTimeout(() => item?.run(), 0);
    },
  });
}
