// The whole workspace lives in the window, the way Linear does it: one fetch at
// start, then every change anyone makes arrives over the event stream. Views filter
// and sort locally, so switching views and searching never wait on the network.
import { useSyncExternalStore } from 'react';
import { get, post, patch as patchReq, del, setSignedOutHandler, ApiError } from './api';
import type { Activity, Bootstrap, Comment, FilterSet, Issue, IssuePatch, Label, Project, Team, User, View } from './types';
import { toast } from './toast';

export interface Detail { comments: Comment[]; activity: Activity[]; loaded: boolean }

export interface State {
  phase: 'loading' | 'ready' | 'signed-out' | 'error';
  error: string | null;
  data: Bootstrap | null;
  detail: Record<number, Detail>; // by issue id
  newVersion: string | null;
  connected: boolean;
}

let state: State = { phase: 'loading', error: null, data: null, detail: {}, newVersion: null, connected: false };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((l) => l()); };
const setData = (fn: (d: Bootstrap) => Bootstrap) => { if (state.data) set({ data: fn(state.data) }); };

export const getState = () => state;
export function useApp(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

setSignedOutHandler(() => set({ phase: 'signed-out' }));

// ── loading and live updates ────────────────────────────────────────────────
export async function load() {
  try {
    const data = await get<Bootstrap>('/api/bootstrap');
    set({ data, phase: 'ready', error: null });
    connect();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return set({ phase: 'signed-out' });
    set({ phase: state.data ? state.phase : 'error', error: (e as Error).message });
  }
}

let source: EventSource | null = null;
let dropped = false;
function connect() {
  if (source) return;
  source = new EventSource('/api/events');
  source.onopen = () => {
    set({ connected: true });
    // anything that happened while the stream was down is fetched fresh
    if (dropped) { dropped = false; resync(); }
  };
  source.onerror = () => {
    dropped = true;
    set({ connected: false });
    // EventSource retries on its own; find out whether we were signed out meanwhile
    get('/api/me').catch(() => {});
  };
  source.onmessage = (m) => {
    try { apply(JSON.parse(m.data)); } catch (e) { console.error(e); }
  };
}

async function resync() {
  try {
    const data = await get<Bootstrap>('/api/bootstrap');
    set({ data, detail: {} });
  } catch { /* the next reconnect tries again */ }
}

function upsertIssue(issue: Issue) {
  setData((d) => {
    const i = d.issues.findIndex((x) => x.id === issue.id);
    const issues = i < 0 ? [...d.issues, issue] : d.issues.map((x) => (x.id === issue.id ? issue : x));
    return { ...d, issues };
  });
}

function updateDetail(issueId: number, fn: (d: Detail) => Detail) {
  const cur = state.detail[issueId];
  if (!cur) return;
  set({ detail: { ...state.detail, [issueId]: fn(cur) } });
}

function apply(e: any) {
  switch (e.type) {
    case 'hello':
      if (state.data && e.version !== state.data.version) set({ newVersion: e.version });
      break;
    case 'issue': upsertIssue(e.issue); break;
    case 'issue_deleted': setData((d) => ({ ...d, issues: d.issues.filter((x) => x.id !== e.id) })); break;
    case 'comment':
      updateDetail(e.issueId, (d) => {
        const has = d.comments.some((c) => c.id === e.comment.id);
        return { ...d, comments: has ? d.comments.map((c) => (c.id === e.comment.id ? { ...e.comment, reactions: e.comment.reactions?.length ? e.comment.reactions : c.reactions } : c)) : [...d.comments, e.comment] };
      });
      break;
    case 'comment_deleted': updateDetail(e.issueId, (d) => ({ ...d, comments: d.comments.filter((c) => c.id !== e.commentId) })); break;
    case 'reactions': updateDetail(e.issueId, (d) => ({ ...d, comments: d.comments.map((c) => (c.id === e.commentId ? { ...c, reactions: e.reactions } : c)) })); break;
    case 'activity': updateDetail(e.issueId, (d) => (d.activity.some((a) => a.id === e.activity.id) ? d : { ...d, activity: [...d.activity, e.activity] })); break;
    case 'labels': setData((d) => ({ ...d, labels: e.labels as Label[] })); break;
    case 'projects': setData((d) => ({ ...d, projects: e.projects as Project[] })); break;
    case 'views': setData((d) => ({ ...d, views: e.views as View[] })); break;
    case 'users': setData((d) => ({ ...d, users: e.users as User[], me: (e.users as User[]).find((u) => u.id === d.me.id) || d.me })); break;
    case 'team': setData((d) => ({ ...d, team: e.team as Team })); break;
  }
}

// ── issue detail ───────────────────────────────────────────────────────────
export async function loadDetail(issueNumber: number) {
  const r = await get<{ issue: Issue; comments: Comment[]; activity: Activity[] }>(`/api/issues/${issueNumber}`);
  upsertIssue(r.issue);
  set({ detail: { ...state.detail, [r.issue.id]: { comments: r.comments, activity: r.activity, loaded: true } } });
}

// ── writes (optimistic; the server's echo is the truth) ─────────────────────
function fail(e: unknown) {
  toast((e as Error).message || 'Something went wrong', 'error');
}

export async function updateIssue(issue: Issue, change: IssuePatch) {
  const before = state.data?.issues.find((x) => x.id === issue.id);
  upsertIssue({ ...issue, ...change, updatedAt: new Date().toISOString() });
  try {
    upsertIssue(await patchReq<Issue>(`/api/issues/${issue.number}`, change));
  } catch (e) {
    if (before) upsertIssue(before);
    fail(e);
  }
}

// by id: a debounced save must not optimistically replay an older copy of the issue
export function patchIssue(id: number, change: IssuePatch) {
  const current = state.data?.issues.find((x) => x.id === id);
  if (current) return updateIssue(current, change);
}

export async function createIssue(input: IssuePatch & { title: string }) {
  try {
    const issue = await post<Issue>('/api/issues', input);
    upsertIssue(issue);
    return issue;
  } catch (e) { fail(e); return null; }
}

export async function deleteIssue(issue: Issue) {
  const before = state.data?.issues;
  setData((d) => ({ ...d, issues: d.issues.filter((x) => x.id !== issue.id) }));
  try { await del(`/api/issues/${issue.number}`); toast(`Deleted ${issue.identifier}`); }
  catch (e) { if (before) setData((d) => ({ ...d, issues: before })); fail(e); }
}

export async function addComment(issue: Issue, body: string) {
  try {
    const c = await post<Comment>(`/api/issues/${issue.number}/comments`, { body });
    updateDetail(issue.id, (d) => (d.comments.some((x) => x.id === c.id) ? d : { ...d, comments: [...d.comments, c] }));
    return true;
  } catch (e) { fail(e); return false; }
}

export async function editComment(comment: Comment, body: string) {
  try { await patchReq(`/api/comments/${comment.id}`, { body }); return true; } catch (e) { fail(e); return false; }
}

export async function deleteComment(comment: Comment) {
  try { await del(`/api/comments/${comment.id}`); } catch (e) { fail(e); }
}

export async function toggleReaction(comment: Comment, emoji: string) {
  const me = state.data!.me.id;
  const reactions = comment.reactions.map((r) => ({ ...r, userIds: [...r.userIds] }));
  const r = reactions.find((x) => x.emoji === emoji);
  if (r && r.userIds.includes(me)) r.userIds = r.userIds.filter((u) => u !== me);
  else if (r) r.userIds.push(me);
  else reactions.push({ emoji, userIds: [me] });
  updateDetail(comment.issueId, (d) => ({ ...d, comments: d.comments.map((c) => (c.id === comment.id ? { ...c, reactions: reactions.filter((x) => x.userIds.length) } : c)) }));
  try { await post(`/api/comments/${comment.id}/reactions`, { emoji }); } catch (e) { fail(e); }
}

export async function saveLabel(input: { id?: number; name?: string; color?: string; description?: string | null; archived?: boolean }) {
  try {
    if (input.id) return await patchReq<Label>(`/api/labels/${input.id}`, input);
    return await post<Label>('/api/labels', input);
  } catch (e) { fail(e); return null; }
}

export async function saveProject(input: { id?: number; name?: string; icon?: string; color?: string; description?: string | null; archived?: boolean }) {
  try {
    if (input.id) return await patchReq<Project>(`/api/projects/${input.id}`, input);
    return await post<Project>('/api/projects', input);
  } catch (e) { fail(e); return null; }
}

export async function saveView(input: { id?: number; name?: string; description?: string | null; icon?: string; color?: string; filters?: FilterSet }) {
  try {
    const v = input.id ? await patchReq<View>(`/api/views/${input.id}`, input) : await post<View>('/api/views', input);
    // in place before the live update lands, so a new view opens without a blank moment
    setData((d) => ({ ...d, views: d.views.some((x) => x.id === v.id) ? d.views.map((x) => (x.id === v.id ? v : x)) : [...d.views, v] }));
    return v;
  } catch (e) { fail(e); return null; }
}

export async function removeView(id: number) {
  try {
    await del(`/api/views/${id}`);
    setData((d) => ({ ...d, views: d.views.filter((x) => x.id !== id) }));
    return true;
  } catch (e) { fail(e); return false; }
}

export async function signOut() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'x-requested-with': 'plumb' } });
  source?.close();
  source = null;
  set({ phase: 'signed-out', data: null, detail: {} });
}
