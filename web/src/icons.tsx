// Hand-drawn to match Linear's icon language: 16px boxes, 1.5px strokes,
// status and priority glyphs drawn the way Linear draws them.
import type { CSSProperties, ReactNode } from 'react';
import type { PullRequest, Status } from './types';

type P = { size?: number; color?: string; style?: CSSProperties; className?: string };

function Svg({ size = 16, children, style, className, viewBox = '0 0 16 16' }: P & { children: ReactNode; viewBox?: string }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" style={{ flexShrink: 0, ...style }} className={className} aria-hidden>
      {children}
    </svg>
  );
}

// ── status ─────────────────────────────────────────────────────────────────
// started states fill up as they get further along: 1st ½, 2nd ¾
export function StatusIcon({ status, statuses, size = 14 }: { status: Status | undefined; statuses?: Status[]; size?: number }) {
  if (!status) return <Svg size={size} viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" stroke="#6e6e73" strokeWidth="1.5" /></Svg>;
  const c = status.color;
  if (status.type === 'backlog') {
    return <Svg size={size} viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" stroke={c} strokeWidth="1.5" strokeDasharray="1.4 1.74" strokeDashoffset="0.65" /></Svg>;
  }
  if (status.type === 'unstarted') {
    return <Svg size={size} viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" stroke={c} strokeWidth="1.5" /></Svg>;
  }
  if (status.type === 'started') {
    const started = (statuses || []).filter((s) => s.type === 'started').sort((a, b) => a.position - b.position);
    const idx = Math.max(0, started.findIndex((s) => s.id === status.id));
    const f = Math.min(0.875, 0.5 + 0.25 * idx);
    const circ = 2 * Math.PI * 2;
    return (
      <Svg size={size} viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="6" stroke={c} strokeWidth="1.5" />
        <circle cx="7" cy="7" r="2" stroke={c} strokeWidth="4" strokeDasharray={`${circ * f} ${circ}`} transform="rotate(-90 7 7)" />
      </Svg>
    );
  }
  if (status.type === 'completed') {
    return (
      <Svg size={size} viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="7" fill={c} />
        <path d="M4.2 7.2l1.9 1.9 3.8-3.9" stroke="#131313" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }
  return (
    <Svg size={size} viewBox="0 0 14 14">
      <circle cx="7" cy="7" r="7" fill={c} />
      <path d="M4.9 4.9l4.2 4.2M9.1 4.9l-4.2 4.2" stroke="#131313" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

// ── priority ───────────────────────────────────────────────────────────────
export function PriorityIcon({ priority, size = 16 }: { priority: number; size?: number }) {
  if (priority === 0) {
    return (
      <Svg size={size}>
        {[1.5, 6.5, 11.5].map((x) => <rect key={x} x={x} y="7.25" width="3" height="1.5" rx="0.5" fill="#86868b" />)}
      </Svg>
    );
  }
  if (priority === 1) {
    return (
      <Svg size={size}>
        <rect x="1" y="1" width="14" height="14" rx="3" fill="#fc7840" />
        <rect x="7.1" y="3.6" width="1.8" height="5.6" rx="0.9" fill="#fff" />
        <circle cx="8" cy="11.5" r="1" fill="#fff" />
      </Svg>
    );
  }
  const lit = { 2: 3, 3: 2, 4: 1 }[priority] ?? 0;
  const bars = [[1.5, 8, 6], [6.5, 5, 9], [11.5, 2, 12]];
  return (
    <Svg size={size}>
      {bars.map(([x, y, h], i) => <rect key={x} x={x} y={y} width="3" height={h} rx="1" fill={i < lit ? '#9b9b9e' : '#48484b'} />)}
    </Svg>
  );
}

// ── cycle: a ring filling clockwise as the week goes by ──────────────────────
export function CycleIcon({ progress = 0, size = 16 }: { progress?: number; size?: number }) {
  const r = 6.25, circ = 2 * Math.PI * r;
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r={r} stroke="#6e6e73" strokeWidth="1.4" />
      {progress > 0 && <circle cx="8" cy="8" r={r} stroke="#7b83e6" strokeWidth="1.4" strokeDasharray={`${circ * Math.min(1, progress)} ${circ}`} transform="rotate(-90 8 8)" strokeLinecap="round" />}
      <path d="M6.7 5.6v4.8L10.4 8z" fill="#9b9b9e" />
    </Svg>
  );
}

// ── pull requests ──────────────────────────────────────────────────────────
export function prColor(pr: PullRequest) {
  if (pr.state === 'merged') return '#a371f7';
  if (pr.state === 'closed') return '#eb5757';
  if (pr.draft) return '#86868b';
  return '#7b83e6';
}
export function PrIcon({ pr, size = 16, color }: { pr?: PullRequest; size?: number; color?: string }) {
  const c = color || (pr ? prColor(pr) : '#7b83e6');
  if (pr?.state === 'merged') {
    return (
      <Svg size={size}>
        <circle cx="4.5" cy="3.5" r="1.6" stroke={c} strokeWidth="1.5" />
        <circle cx="4.5" cy="12.5" r="1.6" stroke={c} strokeWidth="1.5" />
        <circle cx="11.5" cy="8.5" r="1.6" stroke={c} strokeWidth="1.5" />
        <path d="M4.5 5.1v5.8M4.5 5.2c0 2.2 1.6 3.3 5.4 3.3" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg size={size}>
      <circle cx="4.5" cy="3.5" r="1.6" stroke={c} strokeWidth="1.5" />
      <circle cx="4.5" cy="12.5" r="1.6" stroke={c} strokeWidth="1.5" />
      <circle cx="11.5" cy="12.5" r="1.6" stroke={c} strokeWidth="1.5" />
      <path d="M4.5 5.1v5.8" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      {pr?.state === 'closed'
        ? <path d="M9.8 3l3.4 3.4M13.2 3L9.8 6.4" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        : <path d="M11.5 10.9V6.2c0-1.2-.9-2.1-2.1-2.1H7.2m1.6-1.6L7.2 4.1l1.6 1.6" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
    </Svg>
  );
}

// ── projects ───────────────────────────────────────────────────────────────
const PROJECT_PATHS: Record<string, ReactNode> = {
  cube: <><path d="M8 1.8l5.5 3.1v6.2L8 14.2l-5.5-3.1V4.9z" /><path d="M2.6 5L8 8.1 13.4 5M8 8.1v6" /></>,
  heart: <path d="M8 13.6S2 10.1 2 5.9A3.1 3.1 0 0 1 8 4.6a3.1 3.1 0 0 1 6 1.3c0 4.2-6 7.7-6 7.7z" fill="currentColor" />,
  rocket: <><path d="M9.8 2.3c2-.6 3.3-.5 3.9-.2.3.6.4 1.9-.2 3.9-.8 2.4-3.5 5-5.3 6.1L5.9 9.8C7 8 9.6 3.1 9.8 2.3z" /><path d="M5.9 9.8L3.4 9.2l1.8-2.6 2.2-.2M8.2 12.1l.6 2.5 2.6-1.8.2-2.2M4.7 11.3c-1 .2-1.9 1-2.2 2.2 1.2-.3 2-1.2 2.2-2.2z" /></>,
  star: <path d="M8 1.9l1.8 3.8 4.1.5-3 2.8.8 4.1L8 11.1 4.3 13.1l.8-4.1-3-2.8 4.1-.5z" />,
  flag: <><path d="M3.5 14.5V2" /><path d="M3.5 2.5h8.8l-1.8 3.2 1.8 3.2H3.5" /></>,
  bolt: <path d="M9.2 1.8L3.6 9h4l-1 5.2L12.4 7h-4z" />,
  bug: <><rect x="4.5" y="4.5" width="7" height="9" rx="3.5" /><path d="M8 7v6.5M4.5 8.5H2M14 8.5h-2.5M5 5.5L3 3.8M11 5.5l2-1.7M4.8 11.5l-2.1 1.3M11.2 11.5l2.1 1.3M6 4.6c0-1.1.9-2 2-2s2 .9 2 2" /></>,
  book: <><path d="M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z" /><path d="M3 11.5a2 2 0 0 1 2-2h7.5" /></>,
  briefcase: <><rect x="2" y="5" width="12" height="8.5" rx="1.5" /><path d="M5.5 5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V5M2 8.5h12" /></>,
  chart: <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />,
  code: <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />,
  compass: <><circle cx="8" cy="8" r="6" /><path d="M10.4 5.6L9 9 5.6 10.4 7 7z" /></>,
  globe: <><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14c-1.8-1.7-2.6-3.7-2.6-6S6.2 3.7 8 2z" /></>,
  leaf: <><path d="M13.5 2.5C6 2.5 2.5 5.5 2.5 10c0 1.6.8 3 .8 3s1.4.8 3 .8c4.5 0 7.2-3.5 7.2-11.3z" /><path d="M3.3 13C6 10 8.5 8 11 6.5" /></>,
  lightbulb: <><path d="M6 11.5c0-1.3-2.5-2.7-2.5-5.2a4.5 4.5 0 0 1 9 0c0 2.5-2.5 3.9-2.5 5.2z" /><path d="M6.2 13.8h3.6" /></>,
  target: <><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="3.2" /><circle cx="8" cy="8" r=".6" fill="currentColor" /></>,
  users: <><circle cx="6" cy="5.5" r="2.5" /><path d="M1.8 13.5c0-2.3 1.9-4 4.2-4s4.2 1.7 4.2 4M10.5 3.2a2.5 2.5 0 0 1 0 4.8M12.2 9.8c1.2.6 2 1.9 2 3.7" /></>,
  shop: <><path d="M2.5 6.5V13.5h11V6.5" /><path d="M1.8 6.2L3.2 2.5h9.6l1.4 3.7c0 1-.9 1.8-2 1.8s-2-.8-2-1.8c0 1-.9 1.8-2 1.8s-2-.8-2-1.8c0 1-.9 1.8-2 1.8s-2.4-.8-2.4-1.8z" /><path d="M6.5 13.5v-3h3v3" /></>,
  mountain: <path d="M1.5 13.5l4.8-8 2.7 4.4 1.6-2.4 3.9 6z" />,
  layers: <><path d="M8 2.2l6 3.2-6 3.2-6-3.2z" /><path d="M2 8.4l6 3.2 6-3.2" /><path d="M2 11.2l6 3.2 6-3.2" /></>,
  sparkles: <path d="M6 2.5l1.1 3.4 3.4 1.1-3.4 1.1L6 11.5 4.9 8.1 1.5 7l3.4-1.1zM12 9.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z" />,
};
export function ProjectIcon({ icon, color = '#9b9b9e', size = 16 }: { icon: string; color?: string; size?: number }) {
  return (
    <Svg size={size} style={{ color }}>
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{PROJECT_PATHS[icon] || PROJECT_PATHS.cube}</g>
    </Svg>
  );
}
export const PROJECT_ICON_NAMES = Object.keys(PROJECT_PATHS);

// the team's mark: Linear draws it as the colored glyph itself, no tile behind it
export function TeamIcon({ color = '#4ea7fc', size = 18 }: { color?: string; size?: number }) {
  return (
    <Svg size={size}>
      <path d="M2.2 2.6A1.4 1.4 0 0 1 3.5 1.6h9a1.4 1.4 0 0 1 1.3 1L15 6.2c.2 1.3-.8 2.4-2.1 2.4-.9 0-1.7-.5-2-1.3-.4.8-1.2 1.3-2.1 1.3h-1.6c-.9 0-1.7-.5-2.1-1.3-.3.8-1.1 1.3-2 1.3C1.8 8.6.8 7.5 1 6.2z" fill={color} />
      <path d="M2.4 9.6c.2 0 .4.1.6.1 1 0 1.8-.3 2.4-.9.6.6 1.4.9 2.3.9h.6c.9 0 1.7-.3 2.3-.9.6.6 1.4.9 2.4.9.2 0 .4 0 .6-.1v3.9c0 .8-.6 1.4-1.4 1.4H10v-3.1a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v3.1H3.8c-.8 0-1.4-.6-1.4-1.4z" fill={color} />
    </Svg>
  );
}

// ── UI glyphs ──────────────────────────────────────────────────────────────
const UI: Record<string, ReactNode> = {
  search: <><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  compose: <><path d="M12.8 2.6a1.4 1.4 0 0 1 2 2L9 10.4l-2.6.6.6-2.6z" /><path d="M13.5 9v3.5a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 12.5V4a1.5 1.5 0 0 1 1.5-1.5H7" /></>,
  chevronDown: <path d="M4.5 6.5L8 10l3.5-3.5" />,
  chevronRight: <path d="M6.5 4.5L10 8l-3.5 3.5" />,
  chevronLeft: <path d="M9.5 4.5L6 8l3.5 3.5" />,
  arrowUp: <path d="M8 13V3M4 7l4-4 4 4" />,
  arrowDown: <path d="M8 3v10M4 9l4 4 4-4" />,
  link: <><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9" /><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9" /></>,
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></>,
  branch: <><circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="5" r="1.6" /><path d="M4.5 5.1v5.8M11.5 6.6c0 2.6-2.4 3.3-7 4.1" /></>,
  filter: <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />,
  settings: <><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></>,
  inbox: <><path d="M2 9.5l1.6-5.4A1.5 1.5 0 0 1 5 3h6a1.5 1.5 0 0 1 1.4 1.1L14 9.5v3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5z" /><path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" /></>,
  user: <><circle cx="8" cy="5.5" r="2.8" /><path d="M2.8 14c.4-2.8 2.6-4.3 5.2-4.3s4.8 1.5 5.2 4.3" /></>,
  issues: <><rect x="2.5" y="2.5" width="8.5" height="8.5" rx="2" /><path d="M5 13.5h6.5a2 2 0 0 0 2-2V5" /></>,
  cycles: <><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M12.2 1.8v2.6H9.6" /></>,
  projects: PROJECT_PATHS.cube,
  tag: <><path d="M2.5 3.8v3.5c0 .4.2.8.4 1l5.4 5.4a1.2 1.2 0 0 0 1.7 0l3.3-3.3a1.2 1.2 0 0 0 0-1.7L7.9 3.3a1.4 1.4 0 0 0-1-.4H3.4a.9.9 0 0 0-.9.9z" /><circle cx="5.5" cy="5.9" r=".8" fill="currentColor" /></>,
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.8" /><path d="M2.5 6.8h11M5.5 2v2.8M10.5 2v2.8" /></>,
  estimate: <><path d="M8 2.2l5.8 10.3H2.2z" /><path d="M8 6.8v2.4" /></>,
  check: <path d="M3.5 8.4l2.9 2.9 6.1-6.3" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  more: <><circle cx="3.5" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="12.5" cy="8" r=".9" fill="currentColor" /></>,
  star: <path d="M8 1.9l1.8 3.8 4.1.5-3 2.8.8 4.1L8 11.1 4.3 13.1l.8-4.1-3-2.8 4.1-.5z" />,
  trash: <><path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.6 8.6A1.5 1.5 0 0 0 6.1 14.5h3.8a1.5 1.5 0 0 0 1.5-1.4L12 4.5" /></>,
  edit: <path d="M11.8 2.4a1.4 1.4 0 0 1 2 2L5.5 12.7l-3 .8.8-3z" />,
  send: <path d="M8 13V3.5M3.8 7.6L8 3.4l4.2 4.2" />,
  smile: <><circle cx="8" cy="8" r="6" /><path d="M5.6 9.6c.6.8 1.4 1.2 2.4 1.2s1.8-.4 2.4-1.2" /><circle cx="6" cy="6.6" r=".7" fill="currentColor" /><circle cx="10" cy="6.6" r=".7" fill="currentColor" /></>,
  subissue: <><path d="M4 2.5v6.5a2 2 0 0 0 2 2h4" /><circle cx="11.8" cy="11" r="1.8" /><circle cx="4" cy="2.5" r=".1" /></>,
  logout: <><path d="M6.5 13.5H3.8a1.3 1.3 0 0 1-1.3-1.3V3.8a1.3 1.3 0 0 1 1.3-1.3h2.7" /><path d="M10.5 11l3-3-3-3M13.5 8H6" /></>,
  refresh: <><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M12.2 1.8v2.6H9.6" /></>,
  github: <path d="M8 1.5a6.5 6.5 0 0 0-2.06 12.67c.33.06.44-.14.44-.31v-1.1c-1.8.39-2.18-.87-2.18-.87-.3-.75-.72-.95-.72-.95-.59-.4.04-.39.04-.39.65.04 1 .67 1 .67.58 1 1.52.71 1.89.54.06-.42.23-.71.41-.87-1.44-.16-2.95-.72-2.95-3.2 0-.71.25-1.29.67-1.74-.07-.16-.29-.82.06-1.71 0 0 .55-.18 1.79.66a6.2 6.2 0 0 1 3.26 0c1.24-.84 1.79-.66 1.79-.66.35.89.13 1.55.06 1.71.42.45.67 1.03.67 1.74 0 2.49-1.51 3.04-2.96 3.2.23.2.44.6.44 1.2v1.78c0 .17.11.38.45.31A6.5 6.5 0 0 0 8 1.5z" fill="currentColor" stroke="none" />,
  key: <><circle cx="5.5" cy="10.5" r="3" /><path d="M7.6 8.4L13.5 2.5M11.5 4.5l1.6 1.6M10 6l1.2 1.2" /></>,
  members: PROJECT_PATHS.users,
  command: <path d="M5.5 5.5h5v5h-5zM5.5 5.5V4a1.5 1.5 0 1 0-1.5 1.5zM10.5 5.5H12A1.5 1.5 0 1 0 10.5 4zM10.5 10.5V12a1.5 1.5 0 1 0 1.5-1.5zM5.5 10.5H4A1.5 1.5 0 1 0 5.5 12z" />,
};
export type IconName = keyof typeof UI;
export function Icon({ name, size = 16, color, style, className }: P & { name: IconName | string }) {
  return (
    <Svg size={size} style={{ color: color || 'currentColor', ...style }} className={className}>
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{UI[name] ?? UI.more}</g>
    </Svg>
  );
}
