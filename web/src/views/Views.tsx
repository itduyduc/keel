// Saved views, the way Linear does them: a named filter over the team's issues,
// shared with everyone, opened from a tab. Only the six filters the list already
// has (status, assignee, priority, label, project, cycle).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, saveView, removeView } from '../state';
import { navigate } from '../router';
import { getUi, setUi, useUi } from '../ui';
import { IssueList } from '../components/IssueList';
import { FilterBar, FilterButton, applyFilters } from '../components/Filters';
import { openMenu, anchorOf, closeMenu } from '../components/Menu';
import { ProjectIcon, PROJECT_ICON_NAMES, Icon, TeamIcon } from '../icons';
import { ViewHeader, teamTabs, shownViews } from './Header';
import type { FilterSet, View } from '../types';

const COLORS = ['#9b9b9e', '#5e6ad2', '#26b5ce', '#4cb782', '#f2c94c', '#f2994a', '#fc7840', '#eb5757', '#bb87fc', '#9b7bff', '#4ea7fc', '#bec2c8'];
const same = (a: FilterSet, b: FilterSet) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
function normalize(f: FilterSet) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v && v.length).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, [...(v as (number | 'none')[])].sort((x, y) => String(x).localeCompare(String(y)))]));
}

// "+ New view" starts from whatever the list on screen is filtered by
export function newView() {
  setUi({ viewDraft: getUi().currentFilters || {} });
  navigate('/view/new');
}

// "N more" counts the views without a tab; it opens the full list
export function ViewsMenuButton({ views, active }: { views: View[]; active: string }) {
  const more = views.length - shownViews(views, active).length;
  return (
    <>
      {more > 0 && (
        <button className="tab" onClick={(e) => openViewsMenu(e.currentTarget)}>{more} more</button>
      )}
      <button className="icon-btn" title="New view" onClick={newView}>
        <Icon name="plus" size={14} />
      </button>
    </>
  );
}

function openViewsMenu(el: Element) {
  openMenu({ anchor: anchorOf(el), width: 300, align: 'right', content: () => <ViewsMenu /> });
}

function ViewsMenu() {
  const { data } = useApp();
  const views = data!.views;
  return (
    <div className="views-menu">
      <div className="views-menu-head">
        <span>{views.length} view{views.length === 1 ? '' : 's'}</span>
        <button className="btn small" onClick={() => { closeMenu(); newView(); }}><Icon name="plus" size={13} /> New view</button>
      </div>
      <div className="menu-list">
        {views.map((v) => (
          <div key={v.id} className="menu-item" onClick={() => { closeMenu(); navigate(`/view/${v.id}`); }}>
            <span className="menu-icon"><ProjectIcon icon={v.icon} color={v.color} /></span>
            <span className="menu-label">{v.name}</span>
            <button className="icon-btn" title="View options" onClick={(e) => { e.stopPropagation(); viewOptions(v, e.currentTarget); }}>
              <Icon name="more" size={14} />
            </button>
          </div>
        ))}
        {!views.length && <div className="menu-empty">No views yet</div>}
      </div>
    </div>
  );
}

function viewOptions(v: View, el: Element) {
  const at = anchorOf(el);
  setTimeout(() => openMenu({
    anchor: at, width: 200,
    options: () => [
      { key: 'edit', label: 'Edit view', icon: <Icon name="edit" color="#9b9b9e" /> },
      { key: 'delete', label: 'Delete view', icon: <Icon name="trash" color="#9b9b9e" /> },
    ],
    onSelect: (o) => {
      if (o.key === 'edit') navigate(`/view/${v.id}?edit=1`);
      if (o.key === 'delete' && confirm(`Delete the view "${v.name}" for everyone?`)) {
        removeView(v.id).then((ok) => { if (ok && location.pathname === `/view/${v.id}`) navigate('/issues'); });
      }
    },
  }), 0);
}

// ── a view's page ───────────────────────────────────────────────────────────
export function ViewPage({ id }: { id: string }) {
  const { data } = useApp();
  const ui = useUi();
  const d = data!;
  const creating = id === 'new';
  const view = creating ? null : d.views.find((v) => v.id === Number(id));
  const editing = creating || new URLSearchParams(location.search).get('edit') === '1';
  const [filters, setFilters] = useState<FilterSet>(() => (creating ? ui.viewDraft : view?.filters || {}));
  const dirty = !!view && !same(filters, view.filters);

  // another member saving this view moves it under you, unless you have unsaved changes of your own
  const lastSaved = useRef(view?.filters || {});
  useEffect(() => {
    if (!view) return;
    if (same(filters, lastSaved.current)) setFilters(view.filters);
    lastSaved.current = view.filters;
  }, [view?.updatedAt]);

  const shown = useMemo(() => applyFilters(d.issues, filters), [d.issues, filters]);
  useEffect(() => {
    setUi({ lastList: location.pathname, viewDefaults: {}, currentFilters: filters });
  }, [filters]);

  if (!creating && !view) return <div className="empty">This view was deleted.</div>;

  const tab = creating ? 'new' : `view-${view!.id}`;
  const header = (
    <ViewHeader
      icon={<TeamIcon color={d.team.color} size={16} />}
      title="Issues"
      tabs={teamTabs(d, tab)}
      extra={<ViewsMenuButton views={d.views} active={tab} />}
    />
  );

  return (
    <>
      {header}
      {editing ? (
        <ViewEditor
          initial={view ?? undefined}
          filters={filters}
          setFilters={setFilters}
          onCancel={() => (creating ? history.back() : navigate(`/view/${view!.id}`, { replace: true }))}
          onSave={async (meta) => {
            const saved = await saveView({ ...(view ? { id: view.id } : {}), ...meta, filters });
            if (saved) navigate(`/view/${saved.id}`, { replace: true });
          }}
        />
      ) : (
        <div className="view-bar">
          <span className="view-bar-name"><ProjectIcon icon={view!.icon} color={view!.color} /> {view!.name}</span>
          {view!.description && <span className="muted">{view!.description}</span>}
          <span className="view-bar-tools">
            {dirty && (
              <>
                <button className="btn ghost small" onClick={() => setFilters(view!.filters)}>Discard</button>
                <button className="btn primary small" onClick={() => saveView({ id: view!.id, filters })}>Save view</button>
              </>
            )}
            <FilterButton filters={filters} setFilters={setFilters} />
            <button className="icon-btn" title="View options" onClick={(e) => viewOptions(view!, e.currentTarget)}><Icon name="more" size={14} /></button>
          </span>
        </div>
      )}
      {!editing && <FilterBar filters={filters} setFilters={setFilters} />}
      <div className="main-scroll">
        <IssueList issues={shown} viewKey={`view-${id}`} emptyText="No issues match this view." />
      </div>
    </>
  );
}

// ── new / edit ──────────────────────────────────────────────────────────────
function ViewEditor({ initial, filters, setFilters, onCancel, onSave }: {
  initial?: View; filters: FilterSet; setFilters: (f: FilterSet) => void;
  onCancel: () => void; onSave: (meta: { name: string; description: string | null; icon: string; color: string }) => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [icon, setIcon] = useState(initial?.icon || 'layers');
  const [color, setColor] = useState(initial?.color || '#9b9b9e');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    await onSave({ name: name.trim(), description: description.trim() || null, icon, color });
    setBusy(false);
  };
  const pickLook = (el: Element) => openMenu({
    anchor: anchorOf(el), width: 232,
    content: (close) => (
      <div>
        <div className="icon-grid">
          {PROJECT_ICON_NAMES.map((ic) => (
            <button key={ic} title={ic} className={ic === icon ? 'on' : ''} onClick={() => setIcon(ic)}><ProjectIcon icon={ic} color={color} /></button>
          ))}
        </div>
        <div className="color-grid">
          {COLORS.map((c) => <button key={c} style={{ background: c }} className={c === color ? 'on' : ''} onClick={() => { setColor(c); close(); }} />)}
        </div>
      </div>
    ),
  });

  return (
    <div className="view-editor" onKeyDown={(e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    }}>
      <div className="view-editor-top">
        <button className="view-icon-btn" title="Icon and color" onClick={(e) => pickLook(e.currentTarget)}><ProjectIcon icon={icon} color={color} size={18} /></button>
        <div className="view-editor-fields">
          <input className="view-name" autoFocus placeholder="View name" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); save(); } }} />
          <input className="view-description" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="view-editor-actions">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>{initial ? 'Save view' : 'Create view'}</button>
        </div>
      </div>
      <div className="view-editor-filters">
        <FilterBar filters={filters} setFilters={setFilters} />
        <FilterButton filters={filters} setFilters={setFilters} />
        {!Object.values(filters).some((v) => v?.length) && <span className="muted small">No filters yet: the view shows every issue.</span>}
      </div>
    </div>
  );
}
