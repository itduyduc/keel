// One popover for every picker: type to filter, arrows to move, Enter to pick,
// 1–9 to pick by position, Esc to close. Opened imperatively (openMenu) so a
// keyboard shortcut can open the same picker a click does.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../state';
import { Icon } from '../icons';

export interface MenuOption {
  key: string;
  label: string;
  icon?: ReactNode;
  right?: ReactNode;
  selected?: boolean;
  keywords?: string;
  section?: string;
}

export interface MenuConfig {
  anchor: RectLike;
  placeholder?: string;
  options?: () => MenuOption[];
  onSelect?: (o: MenuOption) => void;
  multi?: boolean;
  numbered?: boolean;
  width?: number;
  content?: (close: () => void) => ReactNode; // custom body instead of a list
  align?: 'left' | 'right';
}

let current: MenuConfig | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function openMenu(cfg: MenuConfig) { current = cfg; seq++; emit(); }
export function closeMenu() { if (current) { current = null; emit(); } }
export const menuOpen = () => current !== null;
const useCurrent = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);

export type RectLike = { left: number; top: number; bottom: number; right: number; width: number; height: number };
export function anchorOf(el: Element | RectLike | null | undefined): RectLike {
  if (el && 'getBoundingClientRect' in el) return el.getBoundingClientRect();
  if (el) return el as RectLike;
  const w = window.innerWidth, h = window.innerHeight;
  return { left: w / 2 - 120, right: w / 2 + 120, top: h / 3, bottom: h / 3, width: 240, height: 0 };
}

export function MenuHost() {
  const cfg = useCurrent();
  if (!cfg) return null;
  return createPortal(<Menu key={seq} cfg={cfg} />, document.body);
}

function Menu({ cfg }: { cfg: MenuConfig }) {
  useApp(); // options read live state (a label toggled while the menu is open shows its tick)
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const all = cfg.options ? cfg.options() : [];
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((o) => `${o.label} ${o.keywords || ''}`.toLowerCase().includes(q));
  }, [all, query]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = cfg.anchor;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = cfg.align === 'right' ? r.right - w : r.left;
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    setPos({ left, top });
  }, [cfg, options.length]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) closeMenu(); };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); };
  }, []);

  const pick = (o: MenuOption | undefined) => {
    if (!o) return;
    cfg.onSelect?.(o);
    if (!cfg.multi) closeMenu();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); return; }
    if (e.key === 'Enter') { e.preventDefault(); pick(options[active]); return; }
    if (cfg.numbered && !query && /^[1-9]$/.test(e.key)) { e.preventDefault(); pick(options[Number(e.key) - 1]); }
  };

  useEffect(() => {
    box.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let lastSection: string | undefined;
  return (
    <div ref={box} className="menu" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: cfg.width ?? 240 }} onKeyDown={onKey}>
      {cfg.content ? cfg.content(closeMenu) : (
        <>
          <div className="menu-search">
            <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={cfg.placeholder || 'Search…'} spellCheck={false} />
          </div>
          <div className="menu-list">
            {options.length === 0 && <div className="menu-empty">No results</div>}
            {options.map((o, i) => {
              const header = o.section && o.section !== lastSection ? o.section : null;
              lastSection = o.section;
              return (
                <div key={o.key}>
                  {header && <div className="menu-section">{header}</div>}
                  <div
                    data-idx={i}
                    className={`menu-item${i === active ? ' active' : ''}`}
                    onMouseMove={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                  >
                    {cfg.multi && <span className={`menu-check${o.selected ? ' on' : ''}`}>{o.selected && <Icon name="check" size={12} />}</span>}
                    {o.icon && <span className="menu-icon">{o.icon}</span>}
                    <span className="menu-label">{o.label}</span>
                    {o.right && <span className="menu-right">{o.right}</span>}
                    {!cfg.multi && o.selected && <Icon name="check" size={14} className="menu-selected" />}
                    {cfg.numbered && !query && i < 9 && <span className="menu-num">{i + 1}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
