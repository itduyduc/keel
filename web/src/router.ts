import { useSyncExternalStore } from 'react';

// Paths are the app's addresses: /issues, /issue/PIC-80, /my-issues, /projects, /project/2,
// /cycles, /cycle/5, /settings. The server hands every one of them the same page.
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

export type Route =
  | { name: 'issues'; tab: 'all' | 'active' | 'backlog' }
  | { name: 'issue'; ref: string }
  | { name: 'my'; tab: 'assigned' | 'created' }
  | { name: 'projects' }
  | { name: 'project'; id: number }
  | { name: 'cycles' }
  | { name: 'cycle'; number: number }
  | { name: 'settings'; section: string };

export function parseRoute(path: string): Route {
  const [pathname, search] = path.split('?');
  const q = new URLSearchParams(search || '');
  const parts = pathname.split('/').filter(Boolean);
  switch (parts[0]) {
    case 'issue': return { name: 'issue', ref: decodeURIComponent(parts[1] || '') };
    case 'my-issues': return { name: 'my', tab: parts[1] === 'created' ? 'created' : 'assigned' };
    case 'projects': return { name: 'projects' };
    case 'project': return { name: 'project', id: Number(parts[1]) };
    case 'cycles': return { name: 'cycles' };
    case 'cycle': return { name: 'cycle', number: Number(parts[1]) };
    case 'settings': return { name: 'settings', section: parts[1] || 'profile' };
    default: {
      const tab = q.get('tab') || parts[1];
      return { name: 'issues', tab: tab === 'active' || tab === 'backlog' ? tab : 'all' };
    }
  }
}
