import { useSyncExternalStore } from 'react';

// Paths are the app's addresses: /team/PIC/all, /team/PIC/cycles, /team/PIC/cycle/5,
// /issue/PIC-80, /my-issues, /projects, /project/2, /settings/teams/PIC. The server hands
// every one of them the same page. /issues, /cycles and /cycle/5 are from before there were
// teams; they come with team null and land on the first team.
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
window.addEventListener('popstate', emit);

export function navigate(path: string, { replace = false } = {}) {
  if (path === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  emit();
  document.querySelector('.main-scroll')?.scrollTo(0, 0);
}

export function useLocation() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => location.pathname + location.search,
  );
}

export type IssueTab = 'all' | 'active' | 'backlog';
export type Route =
  | { name: 'issues'; team: string | null; tab: IssueTab }
  | { name: 'issue'; ref: string }
  | { name: 'my'; tab: 'assigned' | 'created' }
  | { name: 'projects' }
  | { name: 'project'; id: number }
  | { name: 'cycles'; team: string | null }
  | { name: 'cycle'; team: string | null; number: number }
  | { name: 'settings'; section: string; sub: string | null };

const issueTab = (s: string | null | undefined): IssueTab => (s === 'active' || s === 'backlog' ? s : 'all');

export function parseRoute(path: string): Route {
  const [pathname, search] = path.split('?');
  const q = new URLSearchParams(search || '');
  const parts = pathname.split('/').filter(Boolean);
  switch (parts[0]) {
    case 'issue': return { name: 'issue', ref: decodeURIComponent(parts[1] || '') };
    case 'my-issues': return { name: 'my', tab: parts[1] === 'created' ? 'created' : 'assigned' };
    case 'projects': return { name: 'projects' };
    case 'project': return { name: 'project', id: Number(parts[1]) };
    case 'team': {
      const team = decodeURIComponent(parts[1] || '');
      if (parts[2] === 'cycles') return { name: 'cycles', team };
      if (parts[2] === 'cycle') return { name: 'cycle', team, number: Number(parts[3]) };
      return { name: 'issues', team, tab: issueTab(parts[2]) };
    }
    case 'cycles': return { name: 'cycles', team: null };
    case 'cycle': return { name: 'cycle', team: null, number: Number(parts[1]) };
    case 'settings': return { name: 'settings', section: parts[1] || 'profile', sub: parts[2] ? decodeURIComponent(parts[2]) : null };
    default: return { name: 'issues', team: null, tab: issueTab(q.get('tab') || parts[1]) };
  }
}
