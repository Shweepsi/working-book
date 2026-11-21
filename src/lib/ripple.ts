// Material ripple for the Céramique style: a circle of the control's text
// colour grows from the press point, then fades once the press ends.
//
// It is drawn in a fixed layer laid over the control and clipped to its box and
// corners, rather than inside the control: putting it inside would mean giving
// every button position: relative and overflow: hidden, which can move or clip
// the control's own absolutely placed children. The layer lives a few hundred
// milliseconds, so a scroll during that time is not worth following.

const TARGETS = [
  '.btn',
  '.tabs .tab',
  '.shift-chip',
  '.sch-rail-item',
  '.seg button',
  '.ln-seg button',
  '.hdr-item',
].join(', ');

// Past this distance the press is a drag or a scroll: the ripple lets go.
const DRAG_PX = 10;

/** Installs the ripple on the document; returns the uninstaller. */
export function installRipple(): () => void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = (e.target as Element | null)?.closest?.(TARGETS) as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const style = getComputedStyle(el);

    const layer = document.createElement('span');
    layer.className = 'm3-ripple';
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      borderRadius: style.borderRadius,
    });

    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    // Reaches the farthest corner, so the circle covers the whole control.
    const r = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y));
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      left: `${x - r}px`,
      top: `${y - r}px`,
      width: `${2 * r}px`,
      height: `${2 * r}px`,
      backgroundColor: style.color,
    });
    layer.appendChild(dot);
    document.body.appendChild(layer);

    // Fades only once both the growth has finished and the press has ended,
    // so a quick tap still shows the full ripple.
    let grown = false;
    let released = false;
    let gone = false;
    const remove = () => {
      if (gone) return;
      gone = true;
      layer.remove();
    };
    const fade = () => {
      if (!grown || !released || gone) return;
      layer.classList.add('is-out');
      window.setTimeout(remove, 300);
    };
    const release = () => {
      released = true;
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('pointermove', onMove);
      fade();
    };
    const onMove = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return;
      if (Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) > DRAG_PX) {
        grown = true;
        release();
      }
    };
    dot.addEventListener('animationend', () => { grown = true; fade(); }, { once: true });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('pointermove', onMove, { passive: true });
    // Never left behind, whatever happens to the events above.
    window.setTimeout(remove, 4000);
  };

  document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  return () => document.removeEventListener('pointerdown', onDown, { capture: true });
}
