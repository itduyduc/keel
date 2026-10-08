// Filters narrow any list by status, assignee, priority, label, project or cycle.
// Each view remembers its own in this window (localStorage), nowhere else.
import { useState } from 'react';
import { getState, useApp } from '../state';
import { openMenu, anchorOf } from './Menu';
import { StatusIcon, PriorityIcon, ProjectIcon, CycleIcon, Icon } from '../icons';
import { Avatar, LabelDot } from './bits';
import { PRIORITY_NAMES } from '../util';
import type { Issue } from '../types';

export type FilterKey = 'status' | 'assignee' | 'priority' | 'label' | 'project' | 'cycle';
export type Filters = Partial<Record<FilterKey, (number | 'none')[]>>;

const FIELDS: { key: FilterKey; label: string; icon: string }[] = [
  { key: 'status', label: 'Status', icon: 'issues' },
  { key: 'assignee', label: 'Assignee', icon: 'user' },
  { key: 'priority', label: 'Priority', icon: 'chart' },
  { key: 'label', label: 'Labels', icon: 'tag' },
  { key: 'project', label: 'Project', icon: 'projects' },
  { key: 'cycle', label: 'Cycle', icon: 'cycles' },
];

export function useFilters(viewKey: string): [Filters, (f: Filters) => void] {
  const key = `keel.filters.${viewKey}`;
  const [filters, setFilters] = useState<Filters>(() => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } });
  const save = (f: Filters) => {
    setFilters(f);
    try { localStorage.setItem(key, JSON.stringify(f)); } catch { /* not persisted; fine */ }
  };
  return [filters, save];
}

export function applyFilters(issues: Issue[], f: Filters): Issue[] {
  const has = (k: FilterKey) => (f[k]?.length ?? 0) > 0;
  const inSet = (k: FilterKey, v: number | null) => f[k]!.includes(v === null ? 'none' : v);
  return issues.filter((i) =>
    (!has('status') || inSet('status', i.statusId))
    && (!has('assignee') || inSet('assignee', i.assigneeId))
    && (!has('priority') || inSet('priority', i.priority))
    && (!has('label') || (i.labelIds.length ? i.labelIds.some((id) => f.label!.includes(id)) : f.label!.includes('none')))
    && (!has('project') || inSet('project', i.projectId))
    && (!has('cycle') || inSet('cycle', i.cycle)));
}

function valueOptions(key: FilterKey) {
  const d = getState().data!;
  switch (key) {
    case 'status': return d.statuses.map((s) => ({ v: s.id as number | 'none', label: s.name, icon: <StatusIcon status={s} statuses={d.statuses} /> }));
    case 'assignee': return [{ v: 'none' as const, label: 'No assignee', icon: <Avatar user={null} size={16} /> }, ...d.users.filter((u) => u.active).map((u) => ({ v: u.id as number | 'none', label: u.name, icon: <Avatar user={u} size={16} /> }))];
    case 'priority': return [1, 2, 3, 4, 0].map((p) => ({ v: p as number | 'none', label: PRIORITY_NAMES[p], icon: <PriorityIcon priority={p} /> }));
    case 'label': return [{ v: 'none' as const, label: 'No labels', icon: <Icon name="tag" color="#6e6e73" /> }, ...d.labels.filter((l) => !l.archived).map((l) => ({ v: l.id as number | 'none', label: l.name, icon: <LabelDot color={l.color} /> }))];
    case 'project': return [{ v: 'none' as const, label: 'No project', icon: <Icon name="projects" color="#6e6e73" /> }, ...d.projects.filter((p) => !p.archived).map((p) => ({ v: p.id as number | 'none', label: p.name, icon: <ProjectIcon icon={p.icon} color={p.color} /> }))];
    case 'cycle': return [{ v: 'none' as const, label: 'No cycle', icon: <CycleIcon /> }, ...d.cycles.cycles.map((c) => ({ v: c.number as number | 'none', label: `Cycle ${c.number}${c.isCurrent ? ' · current' : ''}`, icon: <CycleIcon /> }))];
  }
}

function pickValues(key: FilterKey, anchor: Element | null, get: () => Filters, set: (f: Filters) => void) {
  openMenu({
    anchor: anchorOf(anchor), multi: true, placeholder: `Filter by ${key}…`,
    options: () => {
      const cur = get()[key] || [];
      return valueOptions(key).map((o) => ({ key: String(o.v), label: o.label, icon: o.icon, selected: cur.includes(o.v) }));
    },
    onSelect: (o) => {
      const v: number | 'none' = o.key === 'none' ? 'none' : Number(o.key);
      const f = get();
      const cur = f[key] || [];
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      set({ ...f, [key]: next.length ? next : undefined });
    },
  });
}

export function FilterButton({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  // the menus read the latest filters through a ref-like getter, since they stay open while toggling
  let latest = filters;
  const set = (f: Filters) => { latest = f; setFilters(f); };
  return (
    <button className="btn ghost small" onClick={(e) => {
      const el = e.currentTarget;
      openMenu({
        anchor: anchorOf(el), placeholder: 'Filter…', numbered: true,
        options: () => FIELDS.map((f) => ({ key: f.key, label: f.label, icon: <Icon name={f.icon} color="#9b9b9e" /> })),
        onSelect: (o) => setTimeout(() => pickValues(o.key as FilterKey, el, () => latest, set), 0),
      });
    }}>
      <Icon name="filter" size={14} /> Filter
    </button>
  );
}

export function FilterBar({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  useApp();
  const active = FIELDS.filter((f) => filters[f.key]?.length);
  if (!active.length) return null;
  let latest = filters;
  const set = (f: Filters) => { latest = f; setFilters(f); };
  return (
    <div className="filter-bar">
      {active.map((f) => {
        const names = valueOptions(f.key).filter((o) => filters[f.key]!.includes(o.v)).map((o) => o.label);
        return (
          <span key={f.key} className="filter-chip">
            <span className="filter-field"><Icon name={f.icon} size={13} /> {f.label}</span>
            <span className="filter-op">{names.length > 1 ? 'is any of' : 'is'}</span>
            <span className="filter-values" onClick={(e) => pickValues(f.key, e.currentTarget, () => latest, set)}>
              {names.length > 2 ? `${names.length} values` : names.join(', ')}
            </span>
            <button className="filter-x" title="Remove filter" onClick={() => set({ ...filters, [f.key]: undefined })}><Icon name="x" size={12} /></button>
          </span>
        );
      })}
      <button className="btn ghost small" onClick={() => set({})}>Clear</button>
    </div>
  );
}
