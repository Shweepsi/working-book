import { flushSync } from 'react-dom';

// Runs a state update inside a View Transition, so the page cross-fades from
// the old render to the new one. Without the API, or when the device asks for
// reduced motion, the update simply runs as before.
//
// `kind` lands on <html> as data-vt for the duration, so app.css can tune a
// given transition (the schedule switch is shorter than the tab switch).
// A new transition skips the running one, whose `finished` then resolves at
// once. Clearing data-vt on that would strip the attribute from the new
// transition before it captures its snapshot, so only the latest one clears.
let latest = 0;

export function withViewTransition(update: () => void, kind?: string): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduce) {
    update();
    return;
  }
  const root = document.documentElement;
  const id = ++latest;
  if (kind) root.dataset.vt = kind;
  else delete root.dataset.vt;
  const t = doc.startViewTransition(() => flushSync(update));
  t.finished.finally(() => {
    if (id === latest) delete root.dataset.vt;
  });
}
