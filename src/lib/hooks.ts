import { useEffect } from 'react';

export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export interface KeyBinding {
  // Single character key (case-insensitive). For arrows / brackets / slash use
  // 'ArrowLeft' / 'ArrowRight' / '[' / ']' / '/' as written by KeyboardEvent.key.
  key: string;
  // Modifier requirements; default is "no modifier required, no modifier blocked"
  // — if you set ctrl: true, ctrl must be held; if ctrl: false, ctrl must NOT
  // be held; if undefined, the modifier is ignored.
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  // Whether the binding fires when focus is inside an editable element. Default
  // false, since most shortcuts shouldn't hijack typing.
  whenEditing?: boolean;
  run: (e: KeyboardEvent) => void;
}

function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}

function matches(b: KeyBinding, e: KeyboardEvent): boolean {
  if (b.key.length === 1) {
    if (e.key.toLowerCase() !== b.key.toLowerCase()) return false;
  } else if (e.key !== b.key) {
    return false;
  }
  if (b.ctrl !== undefined && e.ctrlKey !== b.ctrl && e.metaKey !== b.ctrl) return false;
  if (b.shift !== undefined && e.shiftKey !== b.shift) return false;
  if (b.alt !== undefined && e.altKey !== b.alt) return false;
  return true;
}

// Window-level keybinding hook. Bindings is captured by reference per render,
// so callers can pass an inline array — only the keys/run identity matter.
export function useKeyBindings(bindings: KeyBinding[], enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const editing = isEditing(e.target);
      for (const b of bindings) {
        if (editing && !b.whenEditing) continue;
        if (!matches(b, e)) continue;
        e.preventDefault();
        b.run(e);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings, enabled]);
}
