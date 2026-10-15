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
// they're moved over. The sharing status shows in the header's sync chip.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { SYNC_ENABLED } from '../lib/api';
import { listTemplates, sharedGrid as grid, type TemplateInfo } from '../lib/sharedGrid';
import type { Poste, ShiftMeta } from '../types';

interface GridcraftProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
}

export default function Gridcraft({ poste, shiftMeta }: GridcraftProps) {
  useEffect(() => {
    grid.connect();
    return () => grid.dispose();
  }, []);
  const snap = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  // Stable, so React doesn't detach and reattach the frame on every render.
  const attachFrame = useCallback((el: HTMLIFrameElement | null) => grid.attach(el), []);

  // Only for the file name GridCraft shows: the template's name.
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
        <iframe
          ref={attachFrame}
          src="/gridcraft/?host=parent"
          title="GridCraft — classeur partagé du poste"
          allow="fullscreen; clipboard-read; clipboard-write"
          allowFullScreen
        />
      )}
    </div>
  );
}
