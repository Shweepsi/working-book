// The header's tools in one menu, when they don't fit on the header's line
// (App measures): the sync state, the bilan, the calculators, the paper
// preview and the settings, a row each. The button carries the bilan's count
// of rows to look at, and a dot while the sync has something to say.

import { useEffect, useRef, useState } from 'react';
import type { Partition } from '../lib/sharedGrid';
import { BilanIcon, CalcIcon, MenuIcon, PrintIcon } from './icons';
import { SettingsPanel, type SettingsPanelProps } from './Settings';
import { useBilan } from './SuiviBilan';
import SyncIndicator, { useSyncSummary } from './SyncIndicator';

interface ToolsMenuProps {
  /** The sync chip also reflects the workbook (Suivi) or the records (Loading, Unloading). */
  grid: boolean;
  line: boolean;
  /** The shift's bilan, where it is offered. */
  bilan: { part: Partition | null; onOpen: () => void } | null;
  onCalc: () => void;
  printPreview: boolean;
  onPrintPreview: () => void;
  settings: Omit<SettingsPanelProps, 'onClose'>;
}

export default function ToolsMenu({ grid, line, bilan, onCalc, printPreview, onPrintPreview, settings }: ToolsMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'tools' | 'settings'>('tools');
  const wrap = useRef<HTMLDivElement>(null);
  const sync = useSyncSummary({ grid, line });
  const count = useBilan(bilan?.part ?? null)?.checks.length ?? 0;
  const close = () => {
    setOpen(false);
    setView('tools');
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    close();
    action();
  };
  const alert = sync && sync.status !== 'idle' ? sync.status : null;

  return (
    <div className="settings-wrap hdr-tools" ref={wrap}>
      <button
        type="button"
        className="btn ghost icon hdr-burger"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={count ? `Outils, ${count} ligne${count > 1 ? 's' : ''} à vérifier` : 'Outils'}
        title="Outils"
      >
        <MenuIcon />
        {count > 0 && (
          <span className="sb-count sb-badge" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
        {alert && <span className={`hdr-dot is-${alert}`} aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover hdr-menu" role="menu" aria-label="Outils">
          {view === 'tools' ? (
            <div className="hdr-list">
              <div className="hdr-menu-sync">
                <SyncIndicator grid={grid} line={line} />
                {sync && (
                  <span className="hdr-menu-sync-text">
                    {sync.title.split('\n').map((l) => (
                      <span key={l}>{l}</span>
                    ))}
                  </span>
                )}
              </div>
              {bilan && (
                <button type="button" role="menuitem" className="hdr-item" onClick={run(bilan.onOpen)}>
                  <BilanIcon />
                  <span className="hdr-item-label">Bilan du poste</span>
                  {count > 0 && <span className="sb-count">{count}</span>}
                </button>
              )}
              <button type="button" role="menuitem" className="hdr-item" onClick={run(onCalc)}>
                <CalcIcon />
                <span className="hdr-item-label">Calculs de ligne</span>
              </button>
              <button type="button" role="menuitemcheckbox" aria-checked={printPreview} className="hdr-item" onClick={run(onPrintPreview)}>
                <PrintIcon />
                <span className="hdr-item-label">{printPreview ? 'Quitter l’aperçu d’impression' : 'Aperçu d’impression'}</span>
              </button>
              <button type="button" role="menuitem" className="hdr-item" onClick={() => setView('settings')}>
                <span className="hdr-item-glyph" aria-hidden="true">
                  ⚙
                </span>
                <span className="hdr-item-label">Paramètres</span>
                <span className="hdr-item-go" aria-hidden="true">
                  ›
                </span>
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="hdr-back" onClick={() => setView('tools')}>
                ‹ Outils
              </button>
              <SettingsPanel {...settings} onClose={close} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
