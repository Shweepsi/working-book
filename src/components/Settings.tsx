import { useEffect, useRef, useState } from 'react';
import { SYNC_ENABLED } from '../lib/api';
import { getSyncMode, setSyncMode, type SyncMode } from '../lib/sync';
import type { Density, Theme } from '../types';

const THEMES = [
  { key: 'auto', label: 'Auto', glyph: '◐' },
  { key: 'light', label: 'Clair', glyph: '☀' },
  { key: 'dark', label: 'Sombre', glyph: '☾' },
] as const satisfies readonly { key: Theme; label: string; glyph: string }[];

const DENSITIES = [
  { key: 'compact', label: 'Compact', help: 'Lignes serrées, petit texte — tient plus à l’écran.' },
  { key: 'normal', label: 'Normal', help: 'Espacement convivial, cibles tactiles plus grandes. Recommandé.' },
  { key: 'advanced', label: 'Avancé', help: 'Lignes plus spacieuses avec la puce de type et les actions au survol.' },
] as const satisfies readonly { key: Density; label: string; help: string }[];

const SYNC_MODES = [
  { key: 'auto',  label: 'Sync',  glyph: '↻', help: 'Les modifications sont envoyées au serveur dès que possible.' },
  { key: 'local', label: 'Local', glyph: '○', help: 'Les modifications restent sur cet appareil. La politique MTO/MTS reste synchronisée.' },
] as const satisfies readonly { key: SyncMode; label: string; glyph: string; help: string }[];

interface SettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  density: Density;
  onDensityChange: (density: Density) => void;
  printPreview: boolean;
  onPrintPreviewChange: (v: boolean) => void;
}

export default function Settings({ open, onOpenChange, theme, onThemeChange, density, onDensityChange, printPreview, onPrintPreviewChange }: SettingsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [syncMode, setSyncModeState] = useState<SyncMode>(() => getSyncMode());

  function changeSyncMode(next: SyncMode) {
    setSyncMode(next);
    setSyncModeState(next);
  }

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
  const syncHelp = SYNC_MODES.find((s) => s.key === syncMode)?.help;

  return (
    <div className="settings-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn gear"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-label="Paramètres"
        title="Paramètres"
      >
        ⚙
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Paramètres">
          <div>
            <h4>Thème</h4>
            <div className="seg" role="group" aria-label="Thème">
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
            <h4>Densité</h4>
            <div className="seg" role="group" aria-label="Densité">
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
            {densityHelp && <div className="popover-help">{densityHelp}</div>}
          </div>
          {SYNC_ENABLED && (
            <div>
              <h4>Synchronisation</h4>
              <div className="seg" role="group" aria-label="Mode de synchronisation">
                {SYNC_MODES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={syncMode === s.key ? 'active' : ''}
                    onClick={() => changeSyncMode(s.key)}
                    aria-pressed={syncMode === s.key}
                  >
                    <span className="glyph" aria-hidden="true">{s.glyph}</span>
                    {s.label}
                  </button>
                ))}
              </div>
              {syncHelp && <div className="popover-help">{syncHelp}</div>}
            </div>
          )}
          <div>
            <h4>Impression</h4>
            <button
              type="button"
              className={`btn ${printPreview ? 'primary' : ''} popover-action`}
              onClick={() => {
                onPrintPreviewChange(!printPreview);
                onOpenChange(false);
              }}
            >
              {printPreview ? '✓ Aperçu activé' : 'Aperçu d’impression'}
            </button>
            <div className="popover-help">
              Affiche la mise en page papier à l’écran sans déclencher la boîte d’impression.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
