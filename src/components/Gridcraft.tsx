// GridCraft (github.com/Shweepsi/gridcraft, a fork of storytold/gridcraft) — a
// Rust/wasm spreadsheet served under /gridcraft/ by scripts/fetch-gridcraft.sh.
// Dev channel only: the tab is a `preview` one, and production builds don't
// fetch the app.
//
// One workbook per shift (date + poste, like the logbook), started from the
// shift's .xlsx template and shared cell by cell between the devices that have
// it open — see lib/sharedGrid.ts. Templates are managed outside the app,
// through the Worker's /api/grid/templates and /api/grid/doc/template: shifts
// not started yet take the newest one, shifts already filled keep theirs until
// they're moved over. The sharing status shows in the header's sync chip, and
// GridCraft draws no title bar of its own (`titlebar=0`): Working Book's header
// already says which shift is open. It follows Working Book's theme, not the
// system's.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { SYNC_ENABLED } from '../lib/api';
import { listTemplates, sharedGrid as grid, type GridTheme, type TemplateInfo } from '../lib/sharedGrid';
import type { Poste, ShiftMeta, Theme } from '../types';

interface GridcraftProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
  theme: Theme;
}

const GRID_THEME: Record<Theme, GridTheme> = { auto: 'system', light: 'light', dark: 'dark' };

// What a line operator uses: the rest of the ribbon (drawing, page layout,
// macros…) only crowds a tablet. Folded until a tab is touched.
const FRAME_SRC = '/gridcraft/?host=parent&titlebar=0&ribbon=collapsed&tabs=home,data,view';

export default function Gridcraft({ poste, shiftMeta, theme }: GridcraftProps) {
  useEffect(() => {
    grid.connect();
    return () => grid.dispose();
  }, []);
  const snap = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  // The theme the frame starts in; later changes go over postMessage, since a
  // new URL would reload it.
  const [src] = useState(() => `${FRAME_SRC}&theme=${GRID_THEME[theme]}`);
  useEffect(() => grid.setTheme(GRID_THEME[theme]), [theme]);
  // Stable, so React doesn't detach and reattach the frame on every render.
  const attachFrame = useCallback((el: HTMLIFrameElement | null) => grid.attach(el), []);

  // Only for the name of a copy saved from GridCraft: the template's name.
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const refreshTemplates = useCallback(() => {
    if (!SYNC_ENABLED) return;
    listTemplates().then(setTemplates).catch(() => {});
  }, []);
  useEffect(refreshTemplates, [refreshTemplates]);

  const current = templates.find((t) => t.id === snap.templateId) ?? null;
  const date = shiftMeta.date;
  const fileName = `${(current?.name ?? 'Suivi').replace(/\.xlsx$/i, '')} — ${date}${poste ? ` — Poste ${poste}` : ''}.xlsx`;

  useEffect(() => {
    grid.open(poste ? { date, poste } : null, fileName);
  }, [date, poste, fileName]);

  // A template added since the list was fetched: this shift may have just been
  // started on it.
  useEffect(() => {
    if (snap.templateId !== null && !templates.some((t) => t.id === snap.templateId)) refreshTemplates();
  }, [snap.templateId, templates, refreshTemplates]);

  return (
    <div className="gc">
      {!SYNC_ENABLED ? (
        <div className="gc-empty">Pas de serveur configuré : le classeur partagé a besoin du Worker.</div>
      ) : !poste ? (
        <div className="gc-empty">Choisis un shift dans l’en-tête : chaque poste a son classeur.</div>
      ) : snap.status === 'no-template' ? (
        <div className="gc-empty">Aucun modèle de classeur pour l’instant.</div>
      ) : (
        <>
          <iframe
            ref={attachFrame}
            src={src}
            title="Suivi — classeur partagé du poste"
            allow="fullscreen; clipboard-read; clipboard-write"
            allowFullScreen
          />
          {/* Over GridCraft's own grey « Loading GridCraft… » page and the
              empty workbook it shows until the shift's arrives. */}
          {snap.status === 'loading' && (
            <div className="gc-loading" role="status">
              <span className="gc-loading-glyph" aria-hidden="true">↻</span>
              Chargement du classeur…
            </div>
          )}
        </>
      )}
    </div>
  );
}
