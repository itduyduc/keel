import { useSyncExternalStore } from 'react';

export interface Toast { id: number; text: string; kind: 'info' | 'error' }
let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: next++, text, kind };
  toasts = [...toasts, t].slice(-4);
  emit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); emit(); }, kind === 'error' ? 6000 : 2600);
}

export const useToasts = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => toasts);
