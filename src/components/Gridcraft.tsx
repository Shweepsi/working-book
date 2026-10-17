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
// they're moved over. Preview builds also get a « Modifier le modèle » bar
// (components/TemplateEditor.tsx). The sharing status shows in the header's sync chip, and
// GridCraft draws no title bar of its own (`titlebar=0`): Working Book's header
// already says which shift is open. It follows Working Book's theme, not the
// system's. The header's Bilan button opens the shift's bilan (SuiviBilan.tsx, computed from the cells, which is
// also what printing from this tab gives).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SYNC_ENABLED } from '../lib/api';
import { CAN_EDIT_TEMPLATE, uploadTemplate } from '../lib/gridEditor';
import { BilanPrint, BilanSheet, type BilanScope } from './SuiviBilan';
import TemplateEditor from './TemplateEditor';
import { listTemplates, sharedGrid as grid, type GridTheme, type TemplateInfo } from '../lib/sharedGrid';
import type { Poste, ShiftMeta, Theme } from '../types';

interface GridcraftProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
  theme: Theme;
  /** Another tab is showing: kept mounted, off screen, polling paused. */
  hidden: boolean;
  /** Bumped by the header's Bilan button: open the sheet as soon as the shift's workbook is there. */
  openBilan?: number;
}

const GRID_THEME: Record<Theme, GridTheme> = { auto: 'system', light: 'light', dark: 'dark' };

// What a line operator uses: the rest of the ribbon (drawing, page layout,
// macros…) only crowds a tablet. Folded until a tab is touched. In French
// whatever the tablet's language, and without animations (the selection
// outline and the zoom jump instead of gliding; Affichage › Animations brings
// them back until the page reloads). No formula bar, gridlines or headings
// either: the template draws its own borders, and an operator types values,
// not formulas (Affichage brings each back, on this tablet only).
const FRAME_SRC =
  '/gridcraft/?host=parent&titlebar=0&ribbon=collapsed&tabs=home,data,view&lang=fr&animations=0&formulabar=0&gridlines=0&headings=0';

export default function Gridcraft({ poste, shiftMeta, theme, hidden, openBilan = 0 }: GridcraftProps) {
  useEffect(() => {
    grid.connect();
    return () => grid.dispose();
  }, []);
  useEffect(() => grid.setVisible(!hidden), [hidden]);
  const cls = hidden ? 'gc gc-hidden' : 'gc';
  const snap = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  // The theme the frame starts in; later changes go over postMessage, since a
  // new URL would reload it.
  const [src] = useState(() => `${FRAME_SRC}&theme=${GRID_THEME[theme]}`);
  useEffect(() => grid.setTheme(GRID_THEME[theme]), [theme]);
  // Stable, so React doesn't detach and reattach the frame on every render.
  const attachFrame = useCallback((el: HTMLIFrameElement | null) => grid.attach(el), []);

  const [editing, setEditing] = useState(false);
  // The sheet open over the workbook, if any.
  const [panel, setPanel] = useState<'bilan' | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  // The shift's bilan or its day's: what the sheet shows and what printing gives.
  const [bilanScope, setBilanScope] = useState<BilanScope>('poste');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The template's name, for copies saved from GridCraft and for the editor.
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
  // Another tab, or another shift: the sheet open was about this one.
  useEffect(() => setPanel(null), [hidden, date, poste]);
  // The shift's workbook is there: it has a bilan.
  const canBilan = SYNC_ENABLED && !!poste && snap.templateId !== null && snap.status !== 'no-template';
  // The header's Bilan button (SuiviBilan.BilanHeaderButton): the sheet opens
  // here, now or once the workbook it asked from another tab has loaded.
  const handledBilan = useRef(0);
  useEffect(() => {
    if (openBilan > handledBilan.current && !hidden && canBilan && snap.status !== 'loading') {
      handledBilan.current = openBilan;
      setPanel('bilan');
    }
  }, [openBilan, hidden, canBilan, snap.status]);

  // A template added since the list was fetched: this shift may have just been
  // started on it.
  useEffect(() => {
    if (snap.templateId !== null && !templates.some((t) => t.id === snap.templateId)) refreshTemplates();
  }, [snap.templateId, templates, refreshTemplates]);

  async function importFirst(file: File) {
    setImporting(true);
    setImportError(null);
    try {
      await uploadTemplate(file, file.name);
      refreshTemplates();
      grid.reload();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  if (editing && current) {
    return (
      <TemplateEditor
        template={current}
        date={date}
        dateLabel={shiftMeta.dateLabel}
        poste={poste}
        theme={GRID_THEME[theme]}
        hidden={hidden}
        onClose={(published) => {
          setEditing(false);
          if (published) {
            refreshTemplates();
            grid.reload();
          }
        }}
      />
    );
  }

  return (
    <div className={cls}>
      {CAN_EDIT_TEMPLATE && current && (
        <div className="gc-editor-bar no-print">
          <span className="gc-editor-title">
            Modèle <strong>{current.name}</strong>
          </span>
          <span className="gc-spacer" />
          <button type="button" className="btn ghost mini" onClick={() => setEditing(true)}>
            Modifier le modèle
          </button>
        </div>
      )}
      {panel === 'bilan' && poste && (
        <BilanSheet part={{ date, poste }} shiftLabel={shiftMeta.shift.label} scope={bilanScope} onScope={setBilanScope} onClose={closePanel} />
      )}
      {!hidden && canBilan && poste && <BilanPrint part={{ date, poste }} shiftLabel={shiftMeta.shift.label} dateLabel={shiftMeta.dateLabel} scope={bilanScope} />}
      {!SYNC_ENABLED ? (
        <div className="gc-empty">Pas de serveur configuré : le classeur partagé a besoin du Worker.</div>
      ) : !poste ? (
        <div className="gc-empty">Choisis un shift dans l’en-tête : chaque poste a son classeur.</div>
      ) : snap.status === 'no-template' ? (
        <div className="gc-empty">
          <p>Aucun modèle de classeur pour l’instant.</p>
          {CAN_EDIT_TEMPLATE && (
            <>
              <button type="button" className="btn primary" onClick={() => fileRef.current?.click()} disabled={importing}>
                Importer un modèle .xlsx
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void importFirst(f);
                }}
              />
              {importError && <p className="gc-notice">{importError}</p>}
            </>
          )}
        </div>
      ) : (
        <>
          <iframe
            className="no-print"
            ref={attachFrame}
            src={src}
            title="Suivi — classeur partagé du poste"
            allow="fullscreen; clipboard-read; clipboard-write"
            allowFullScreen
          />
          {/* Over GridCraft's own grey « Loading GridCraft… » page and the
              empty workbook it shows until the shift's arrives. */}
          {snap.status === 'loading' && (
            <div className="gc-loading no-print" role="status">
              <span className="gc-loading-glyph" aria-hidden="true">↻</span>
              Chargement du classeur…
            </div>
          )}
        </>
      )}
    </div>
  );
}
