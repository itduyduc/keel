// A markdown textarea that grows with its text and completes @mentions.
// ⌘Enter submits; Esc cancels. What is stored is plain markdown, the same text
// Claude reads and writes through the MCP.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { Avatar } from './bits';
import type { User } from '../types';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  minRows?: number;
}

export interface EditorHandle { focus: () => void }

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { value, onChange, onSubmit, onCancel, onBlur, placeholder, autoFocus, className = '', minRows = 1 }, ref,
) {
  const { data } = useApp();
  const ta = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }));

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus && ta.current) {
      ta.current.focus();
      ta.current.setSelectionRange(ta.current.value.length, ta.current.value.length);
    }
  }, [autoFocus]);

  const candidates: User[] = mention && data
    ? data.users.filter((u) => u.active && `${u.handle} ${u.name} ${u.email}`.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
    : [];

  function detect(v: string, caret: number) {
    const before = v.slice(0, caret);
    const m = before.match(/(^|[\s(])@([A-Za-z0-9._-]*)$/);
    if (m) { setMention({ start: caret - m[2].length - 1, query: m[2] }); setActive(0); }
    else setMention(null);
  }

  function insert(u: User) {
    if (!mention || !ta.current) return;
    const caret = ta.current.selectionStart;
    const next = `${value.slice(0, mention.start)}@${u.handle} ${value.slice(caret)}`;
    onChange(next);
    setMention(null);
    const pos = mention.start + u.handle.length + 2;
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(pos, pos); });
  }

  return (
    <div className={`editor ${className}`}>
      <textarea
        ref={ta}
        value={value}
        rows={minRows}
        placeholder={placeholder}
        spellCheck
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detect(e.currentTarget.value, e.currentTarget.selectionStart); }}
        onBlur={() => { setTimeout(() => setMention(null), 150); onBlur?.(); }}
        onKeyDown={(e) => {
          if (mention && candidates.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % candidates.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + candidates.length) % candidates.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(candidates[active]); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return; }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit?.(); return; }
          if (e.key === 'Escape' && onCancel) { e.preventDefault(); e.stopPropagation(); onCancel(); }
        }}
      />
      {mention && candidates.length > 0 && (
        <div className="mention-popup">
          {candidates.map((u, i) => (
            <div key={u.id} className={`menu-item${i === active ? ' active' : ''}`} onMouseDown={(e) => { e.preventDefault(); insert(u); }} onMouseMove={() => setActive(i)}>
              <Avatar user={u} size={16} />
              <span className="menu-label">{u.name}</span>
              <span className="menu-right muted">@{u.handle}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
