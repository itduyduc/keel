import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Bootstrap, Issue, Status, User } from './types';
import { toast } from './toast';

export const PRIORITY_NAMES = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
// urgent first, "no priority" last, the order Linear sorts by
export const PRIORITY_ORDER = [1, 2, 3, 4, 0];
export const priorityRank = (p: number) => PRIORITY_ORDER.indexOf(p);

const TYPE_RANK: Record<string, number> = { started: 0, unstarted: 1, backlog: 2, completed: 3, canceled: 4 };
// the list's group order: furthest-along work on top (In Review above In Progress)
export function groupOrder(statuses: Status[]) {
  return [...statuses].sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || b.position - a.position);
}

export function sortIssues(list: Issue[]) {
  return [...list].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (b.createdAt > a.createdAt ? 1 : -1));
}

export const isClosed = (s: Status | undefined) => !!s && (s.type === 'completed' || s.type === 'canceled');

// ── dates ─────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso: string) {
  const d = new Date(iso);
  const s = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? s : `${s}, ${d.getFullYear()}`;
}
// "2026-10-09" (an all-day date, no zone) → "Oct 9"
export function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const s = `${MONTHS[m - 1]} ${d}`;
  return y === new Date().getFullYear() ? s : `${s}, ${y}`;
}
export const todayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isOverdue = (date: string | null) => !!date && date < todayString();

export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) { const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`; }
  return shortDate(iso);
}
export const fullTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function cycleSpan(startDate: string, endDate: string) {
  // endDate is exclusive; show the last day
  const last = new Date(Date.parse(endDate + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  return `${dayLabel(startDate)} – ${dayLabel(last)}`;
}

// ── names ─────────────────────────────────────────────────────────────────
export function slugify(s: string, max = 60) {
  const slug = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  return (cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : cut).replace(/-+$/, '');
}
export const branchName = (issue: Issue, me: User) => `${me.gitHandle}/${issue.identifier.toLowerCase()}-${slugify(issue.title)}`;
export const issueUrl = (issue: Issue) => `${location.origin}/issue/${issue.identifier}`;

export function estimateLabel(data: Bootstrap, value: number | null) {
  if (value === null || value === undefined) return null;
  const scale = data.team.estimateScales[data.team.estimateScale];
  if (scale?.names) {
    const i = scale.values.indexOf(value);
    if (i >= 0) return scale.names[i];
  }
  return String(value);
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] || '')).toUpperCase();
}
const AVATAR_COLORS = ['#d0a031', '#5e6ad2', '#26b5ce', '#4cb782', '#f2994a', '#eb5757', '#bb87fc', '#4ea7fc'];
export function avatarColor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ── clipboard: the Mac shell's pasteboard first, then the browser's ──────────
export async function copy(text: string, what?: string) {
  const native = (window as any).webkit?.messageHandlers?.plumb;
  try {
    if (native) native.postMessage({ action: 'copy', text });
    else await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(what ? `Copied ${what}` : 'Copied');
}

// ── markdown ──────────────────────────────────────────────────────────────
marked.setOptions({ gfm: true, breaks: false });

// Markdown → safe HTML, then @handles and issue ids become chips and links.
// Done on the DOM rather than in the markdown grammar so code blocks stay untouched.
export function renderMarkdown(src: string, data: Bootstrap): string {
  const html = DOMPurify.sanitize(marked.parse(src || '', { async: false }) as string, { ADD_ATTR: ['target'] });
  const root = document.createElement('div');
  root.innerHTML = html;
  const handles = new Map(data.users.map((u) => [u.handle.toLowerCase(), u]));
  const numbers = new Set(data.issues.map((i) => i.number));
  const key = data.team.key;
  const re = new RegExp(`(^|[^A-Za-z0-9_.@])(@[A-Za-z0-9._-]+|${key}-\\d+)`, 'g');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = (n as Text).parentElement;
    if (parent && !parent.closest('code, pre, a')) texts.push(n as Text);
  }
  for (const t of texts) {
    const s = t.data;
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of s.matchAll(re)) {
      const start = (m.index ?? 0) + m[1].length;
      const token = m[2];
      let el: HTMLElement | null = null;
      if (token.startsWith('@')) {
        const u = handles.get(token.slice(1).toLowerCase().replace(/[._-]+$/, ''));
        if (u) { el = document.createElement('span'); el.className = 'mention'; el.textContent = `@${u.name}`; el.title = u.email; }
      } else {
        const n = Number(token.split('-')[1]);
        if (numbers.has(n)) { el = document.createElement('a'); el.className = 'issue-ref'; el.setAttribute('href', `/issue/${key}-${n}`); el.textContent = `${key}-${n}`; }
      }
      if (!el) continue;
      frag.append(s.slice(last, start), el);
      last = start + token.length;
    }
    if (last === 0) continue;
    frag.append(s.slice(last));
    t.replaceWith(frag);
  }
  for (const a of root.querySelectorAll('a[href]')) {
    if (!a.classList.contains('issue-ref')) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
  }
  return root.innerHTML;
}

export function modKey(e: KeyboardEvent | React.KeyboardEvent) {
  return e.metaKey || e.ctrlKey;
}

export const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};
