import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Density, Theme } from '../types';
import { fmtStamp } from '../lib/format';
import { applyUpdate, checkForUpdate, isUpdateWaiting, subscribeUpdateWaiting } from '../lib/pwa';
import { useToast } from '../lib/toast';

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

interface SettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  density: Density;
  onDensityChange: (density: Density) => void;
}

export default function Settings({ open, onOpenChange, theme, onThemeChange, density, onDensityChange }: SettingsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  // Mirrors the service worker's "a new version is parked and waiting" state,
  // so the button can promise an update rather than only a search for one.
  const updateWaiting = useSyncExternalStore(subscribeUpdateWaiting, isUpdateWaiting, () => false);
  const [checking, setChecking] = useState(false);

  // One button, one meaning: « mets-moi à jour ». If a version is already
  // waiting it is applied on the spot; otherwise we go look for one and apply
  // whatever we find, because someone who pressed this didn't press it to be
  // told a version exists. The only outcomes that stop here are "rien de neuf"
  // and "pas de réseau", and both say so out loud.
  const update = useCallback(async () => {
    if (updateWaiting) {
      applyUpdate();
      return;
    }
    setChecking(true);
    try {
      const result = await checkForUpdate();
      if (result === 'ready') {
        applyUpdate();
      } else if (result === 'offline') {
        toast.show({ message: 'Hors ligne — impossible de vérifier' });
      } else if (result === 'error') {
        toast.show({ message: 'Vérification impossible — réseau ?' });
      } else if (result === 'unsupported') {
        // No service worker here (navigateur sans PWA, ou onglet non sécurisé):
        // a plain reload is exactly what an update means in that case.
        window.location.reload();
      } else {
        toast.show({ message: 'Application à jour' });
      }
    } finally {
      setChecking(false);
    }
  }, [toast, updateWaiting]);

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
          <div>
            <h4>Version</h4>
            <div className="popover-version mono">
              {__APP_VERSION__} · {__APP_COMMIT__}
              <br />
              {fmtStamp(__APP_BUILT_AT__)}
            </div>
            <button
              type="button"
              className={`btn popover-action${updateWaiting ? ' accent' : ''}`}
              onClick={() => void update()}
              disabled={checking}
            >
              {checking ? 'Recherche…' : updateWaiting ? 'Mettre à jour' : 'Rechercher une mise à jour'}
            </button>
            {updateWaiting && (
              <div className="popover-help">Une nouvelle version est prête — le bouton recharge l’application.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
