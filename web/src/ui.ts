// Window-level UI state that isn't workspace data: which issue the keyboard is on,
// and which of the overlays (create, ⌘K, shortcuts) is open.
import { useSyncExternalStore } from 'react';
import type { FilterSet, IssuePatch } from './types';

export interface UiState {
  focusedIssueId: number | null; // list row under the keyboard
  pageIssueId: number | null; // the issue page being viewed
  create: (IssuePatch & { title?: string }) | null;
  palette: boolean;
  shortcuts: boolean;
  listOrder: number[]; // ids in on-screen order, for j/k and the page's "3 / 12"
  viewDefaults: IssuePatch; // what C fills in from the current view (its project, cycle, …)
  lastList: string; // where Esc on an issue page goes back to
  currentFilters: FilterSet; // what the list on screen is filtered by; New view starts from it
  viewDraft: FilterSet; // the filters a new view opens with
}

let ui: UiState = { focusedIssueId: null, pageIssueId: null, create: null, palette: false, shortcuts: false, listOrder: [], viewDefaults: {}, lastList: '/issues', currentFilters: {}, viewDraft: {} };
const listeners = new Set<() => void>();
export const getUi = () => ui;
export function setUi(p: Partial<UiState>) {
  const next = { ...ui, ...p };
  if (Object.keys(p).every((k) => (ui as any)[k] === (next as any)[k])) return;
  ui = next;
  listeners.forEach((l) => l());
}
export const useUi = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => ui);

export const openCreate = (defaults: IssuePatch = {}) => setUi({ create: defaults });
export const contextIssueId = () => ui.pageIssueId ?? ui.focusedIssueId;
