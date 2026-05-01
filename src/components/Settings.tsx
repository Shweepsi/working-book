import { useEffect, useRef } from 'react';
import type { Density, Theme } from '../types.ts';

const THEMES: Array<{ key: Theme; label: string; glyph: string }> = [
  { key: 'auto', label: 'Auto', glyph: '◐' },
  { key: 'light', label: 'Light', glyph: '☀' },
  { key: 'dark', label: 'Dark', glyph: '☾' },
];

const DENSITIES: Array<{ key: Density; label: string; help: string }> = [
  { key: 'compact', label: 'Compact', help: 'Tight rows, small text — fits more on screen.' },
  { key: 'normal', label: 'Normal', help: 'Friendly spacing, larger touch targets. Recommended.' },
  { key: 'advanced', label: 'Advanced', help: 'Adds the type chip, notes count, and hover row actions.' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  density: Density;
  onDensityChange: (density: Density) => void;
}

export default function Settings({
  open,
  onOpenChange,
  theme,
  onThemeChange,
  density,
  onDensityChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onOpenChange(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const densityHelp = DENSITIES.find((d) => d.key === density)?.help;

  return (
    <div className="settings-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn gear"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
      >
        ⚙
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Settings">
          <div>
            <h4>Theme</h4>
            <div className="seg" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={theme === t.key ? 'active' : ''}
                  onClick={() => onThemeChange(t.key)}
                  aria-pressed={theme === t.key}
                >
                  <span className="glyph" aria-hidden="true">{t.glyph}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4>Density</h4>
            <div className="seg" role="group" aria-label="Density">
              {DENSITIES.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={density === d.key ? 'active' : ''}
                  onClick={() => onDensityChange(d.key)}
                  aria-pressed={density === d.key}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {densityHelp && <div className="popover-help" style={{ marginTop: 6 }}>{densityHelp}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
