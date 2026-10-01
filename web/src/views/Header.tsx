import type { ReactNode } from 'react';
import { navigate } from '../router';
import { ProjectIcon } from '../icons';
import type { Bootstrap, View } from '../types';

export interface Tab { key: string; label: string; href: string; active: boolean; icon?: ReactNode }

export function ViewHeader({ title, icon, tabs, right, extra }: {
  title: ReactNode; icon?: ReactNode; tabs?: Tab[]; right?: ReactNode; extra?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="crumbs">
        {icon}
        <span className="view-title">{title}</span>
        {tabs && (
          <div className="tabs">
            {tabs.map((t) => (
              <button key={t.key} className={`tab${t.active ? ' active' : ''}`} onClick={() => navigate(t.href)}>
                {t.icon}{t.label}
              </button>
            ))}
            {extra}
          </div>
        )}
      </div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

// view tabs shown before the rest fold into "N more"
const INLINE_VIEWS = 4;

// saved views that get a tab: the first few, plus the open one wherever it sits
export function shownViews(views: View[], active: string): View[] {
  const shown = views.slice(0, INLINE_VIEWS);
  const open = views.find((v) => `view-${v.id}` === active);
  if (open && !shown.includes(open)) shown.push(open);
  return shown;
}

// the team's tabs: the three built-in lists, then saved views
export function teamTabs(d: Bootstrap, active: string): Tab[] {
  const shown = shownViews(d.views, active);
  return [
    { key: 'all', label: 'All issues', href: '/issues', active: active === 'all' },
    { key: 'active', label: 'Active', href: '/issues?tab=active', active: active === 'active' },
    { key: 'backlog', label: 'Backlog', href: '/issues?tab=backlog', active: active === 'backlog' },
    ...shown.map((v) => ({
      key: `view-${v.id}`, label: v.name, href: `/view/${v.id}`, active: active === `view-${v.id}`,
      icon: <ProjectIcon icon={v.icon} color={v.color} size={14} />,
    })),
  ];
}
