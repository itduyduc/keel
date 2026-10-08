// The writing surface, Linear-style: click anywhere and type where you clicked,
// in the same type the issue reads in. Markdown shortcuts turn into formatting as
// you type (## heading, - list, [] task, ``` code, **bold**), @ offers teammates,
// and pasted markdown arrives formatted. What is stored is still plain markdown —
// the same text Claude reads and writes through the MCP.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useEditor, EditorContent, Extension, Editor as TiptapEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';
import Suggestion from '@tiptap/suggestion';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { getState, useApp } from '../state';
import { navigate } from '../router';
import type { User } from '../types';

// ── @mentions: a picker that inserts plain "@handle " text ─────────────────
// Plain text, not a special node, so the markdown round-trips untouched.
const Mentions = Extension.create({
  name: 'plumbMentions',
  priority: 200, // before our own keys, so Esc/Enter reach the picker first
  addProseMirrorPlugins() {
    return [
      Suggestion<User>({
        editor: this.editor,
        char: '@',
        pluginKey: new PluginKey('plumbMentionPicker'),
        items: ({ query }) => {
          const q = query.toLowerCase();
          return (getState().data?.users || [])
            .filter((u) => u.active && `${u.handle} ${u.name} ${u.email}`.toLowerCase().includes(q))
            .slice(0, 6);
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, `@${props.handle} `).run();
        },
        render: mentionPopup,
      }),
    ];
  },
});

function mentionPopup() {
  let el: HTMLDivElement | null = null;
  let items: User[] = [];
  let active = 0;
  let pick: (u: User) => void = () => {};
  const draw = () => {
    if (!el) return;
    el.innerHTML = '';
    el.style.display = items.length ? 'block' : 'none';
    items.forEach((u, i) => {
      const row = document.createElement('div');
      row.className = `menu-item${i === active ? ' active' : ''}`;
      const name = document.createElement('span');
      name.className = 'menu-label';
      name.textContent = u.name;
      const handle = document.createElement('span');
      handle.className = 'menu-right muted';
      handle.textContent = `@${u.handle}`;
      row.append(name, handle);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(u); });
      row.addEventListener('mousemove', () => { if (active !== i) { active = i; draw(); } });
      el!.appendChild(row);
    });
  };
  const place = (rect: DOMRect | null | undefined) => {
    if (!el || !rect) return;
    el.style.left = `${Math.min(rect.left, window.innerWidth - 270)}px`;
    el.style.top = `${rect.bottom + 6}px`;
  };
  return {
    onStart: (props: any) => {
      el = document.createElement('div');
      el.className = 'menu mention-popup-rich';
      document.body.appendChild(el);
      items = props.items; active = 0; pick = (u) => props.command(u);
      draw(); place(props.clientRect?.());
    },
    onUpdate: (props: any) => {
      items = props.items; active = Math.min(active, Math.max(0, items.length - 1)); pick = (u) => props.command(u);
      draw(); place(props.clientRect?.());
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (!items.length) return false;
      if (event.key === 'ArrowDown') { active = (active + 1) % items.length; draw(); return true; }
      if (event.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; draw(); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { pick(items[active]); return true; }
      if (event.key === 'Escape') { items = []; draw(); return true; }
      return false;
    },
    onExit: () => { el?.remove(); el = null; },
  };
}

// ── @handles and PIC-123 read as chips and links, without changing the text ──
function tokenDecorations(doc: PMNode) {
  const data = getState().data;
  if (!data) return DecorationSet.empty;
  const handles = new Set(data.users.map((u) => u.handle.toLowerCase()));
  const numbers = new Set(data.issues.map((i) => i.number));
  const re = new RegExp(`(^|[^A-Za-z0-9_.@])(@[A-Za-z0-9._-]+|${data.team.key}-\\d+)`, 'g');
  const decos: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'codeBlock') return false;
    if (!node.isText || !node.text || node.marks.some((m) => m.type.name === 'code')) return;
    if (parent?.type.name === 'codeBlock') return;
    for (const m of node.text.matchAll(re)) {
      const token = m[2];
      const from = pos + (m.index ?? 0) + m[1].length;
      if (token.startsWith('@')) {
        if (handles.has(token.slice(1).toLowerCase().replace(/[._-]+$/, ''))) decos.push(Decoration.inline(from, from + token.length, { class: 'mention' }));
      } else if (numbers.has(Number(token.split('-')[1]))) {
        decos.push(Decoration.inline(from, from + token.length, { class: 'issue-ref', 'data-issue': token.toUpperCase() }));
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

const Tokens = Extension.create({
  name: 'plumbTokens',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('plumbTokens'),
        state: {
          init: (_, { doc }) => tokenDecorations(doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta('plumbTokens') ? tokenDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) { return this.getState(state); },
          handleClick(_view, _pos, event) {
            const ref = (event.target as HTMLElement).closest?.('.issue-ref') as HTMLElement | null;
            if (!ref) return false;
            navigate(`/issue/${ref.dataset.issue}`);
            return true;
          },
        },
      }),
    ];
  },
});

type Callbacks = { current: { onSubmit?: () => void; onCancel?: () => void } };
function buildExtensions(placeholder: string, cbs: Callbacks) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: true, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } },
    }),
    Markdown,
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    Placeholder.configure({ placeholder }),
    Mentions,
    Tokens,
    Extension.create({
      name: 'plumbKeys',
      addKeyboardShortcuts: () => ({
        'Mod-Enter': () => { if (!cbs.current.onSubmit) return false; cbs.current.onSubmit(); return true; },
        Escape: ({ editor: e }) => {
          if (cbs.current.onCancel) { cbs.current.onCancel(); return true; }
          e.commands.blur();
          return true;
        },
      }),
    }),
  ];
}

// ── what gets saved: the serializer's output, tidied back to how people write ──
// Measured on real descriptions (2026-09-29): tables came back padded and with
// "&" as "&amp;", "~10s" came back as "\~10s", and blank lines doubled. All of it
// renders the same, but Claude reads the raw text through the MCP.
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function tidyTable(lines: string[]) {
  return lines.map((line) => {
    const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]));
    const separator = cells.every((c) => /^:?-+:?$/.test(c));
    return `| ${cells.map((c) => (separator ? c.replace(/-+/, '---') : c)).join(' | ')} |`;
  });
}
export function tidyMarkdown(md: string) {
  const out: string[] = [];
  let table: string[] = [];
  let fence = false;
  const flushTable = () => { if (table.length) { out.push(...tidyTable(table)); table = []; } };
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { flushTable(); fence = !fence; out.push(line); continue; }
    if (fence) { out.push(line); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { table.push(line); continue; }
    flushTable();
    // one lone "~" on a line is prose ("~10s"), not strikethrough; only a pair needs the escape
    out.push((line.match(/~/g) || []).length === 1 ? line.replace('\\~', '~') : line);
  }
  flushTable();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function focusEnd(editor: Editor | null) {
  if (!editor) return;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
  editor.view.focus();
}

// ── the component ────────────────────────────────────────────────────────────
const looksLikeMarkdown = (t: string) =>
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.*\|)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(t);

export interface RichEditorHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  clear: () => void;
  focus: () => void;
  isEmpty: () => boolean;
}

interface Props {
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** called after the person stops typing (debounced) and on blur — never for outside updates */
  onChange?: (markdown: string) => void;
  debounceMs?: number;
  onSubmit?: () => void; // ⌘↵
  onCancel?: () => void; // Esc
  onEmptyChange?: (empty: boolean) => void;
}

export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { value, placeholder, autoFocus, className = '', onChange, debounceMs = 700, onSubmit, onCancel, onEmptyChange }, ref,
) {
  const cbs = useRef({ onChange, onSubmit, onCancel, onEmptyChange });
  cbs.current = { onChange, onSubmit, onCancel, onEmptyChange };
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = (editor: Editor | null) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!editor || !dirty.current) return;
    dirty.current = false;
    cbs.current.onChange?.(tidyMarkdown(editor.getMarkdown()));
  };

  const editor = useEditor({
    extensions: buildExtensions(placeholder || '', cbs),
    content: value,
    contentType: 'markdown',
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'markdown rich', spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain') || '';
        const hasHtml = !!event.clipboardData?.getData('text/html');
        if (hasHtml || !text || !looksLikeMarkdown(text)) return false;
        editorRef.current?.chain().focus().insertContent(text, { contentType: 'markdown' }).run();
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      dirty.current = true;
      cbs.current.onEmptyChange?.(e.isEmpty);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(e), debounceMs);
    },
    onBlur: ({ editor: e }) => flush(e),
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // someone else changed it: take theirs, unless you are in the middle of writing
  useEffect(() => {
    if (!editor || editor.isFocused || dirty.current) return;
    if (tidyMarkdown(editor.getMarkdown()) === value.trim()) return;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [value, editor]);

  // new teammates or issues change what reads as a chip or a link
  const { data } = useApp();
  const users = data?.users || [], issues = data?.issues || [];
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr.setMeta('plumbTokens', true));
  }, [editor, users.length, issues.length]);

  // TipTap's focus('end') reports success without moving focus away from another field; the view's own focus does
  useEffect(() => { if (autoFocus) focusEnd(editor); }, [editor, autoFocus]);

  // leaving the page never drops what was typed in the last few hundred ms
  useEffect(() => () => flush(editorRef.current), []);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => (editor ? tidyMarkdown(editor.getMarkdown()) : ''),
    setMarkdown: (md) => { editor?.commands.setContent(md, { contentType: 'markdown', emitUpdate: false }); dirty.current = false; },
    clear: () => { editor?.commands.clearContent(false); dirty.current = false; cbs.current.onEmptyChange?.(true); },
    focus: () => focusEnd(editor),
    isEmpty: () => editor?.isEmpty ?? true,
  }), [editor]);

  return <EditorContent editor={editor} className={`rich-editor ${className}`} />;
});

// what the editor would save for this markdown, untouched by a person:
// plumbDebug.roundTrip(md) in the console, and the tests' way of checking fidelity
export function roundTrip(md: string) {
  const e = new TiptapEditor({ extensions: buildExtensions('', { current: {} }), content: md, contentType: 'markdown' });
  const out = tidyMarkdown(e.getMarkdown());
  e.destroy();
  return out;
}
(window as any).plumbDebug = { roundTrip };
