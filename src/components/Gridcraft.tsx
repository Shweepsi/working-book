// GridCraft (github.com/Shweepsi/gridcraft, a fork of storytold/gridcraft) — a
// Rust/wasm spreadsheet served under /gridcraft/ by scripts/fetch-gridcraft.sh.
// Dev channel only: the tab is a `preview` one, and production builds don't
// fetch the app.
//
// One workbook per shift (date + poste, like the logbook), started from the
// uploaded .xlsx template and shared cell by cell between the devices that have
// it open — see lib/sharedGrid.ts. The template is swapped by uploading a new
// one: shifts not started yet take it, shifts already filled keep theirs until
// someone moves them over.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SYNC_ENABLED } from '../lib/api';
import {
  SharedGrid,
  listTemplates,
  moveToTemplate,
  uploadTemplate,
  type GridStatus,
  type TemplateInfo,
} from '../lib/sharedGrid';
import type { Poste, ShiftMeta } from '../types';

interface GridcraftProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
}

const STATUS: Record<GridStatus, { cls: string; glyph: string; label: string }> = {
  loading: { cls: 'is-syncing', glyph: '↻', label: 'Chargement…' },
  'no-template': { cls: 'is-disabled', glyph: '○', label: 'Pas de modèle' },
  ready: { cls: 'is-idle', glyph: '●', label: 'Partagé' },
  syncing: { cls: 'is-syncing', glyph: '↻', label: 'Envoi…' },
  offline: { cls: 'is-offline', glyph: '⊘', label: 'Hors ligne' },
  error: { cls: 'is-error', glyph: '⚠', label: 'Échec' },
  disabled: { cls: 'is-disabled', glyph: '○', label: 'Local' },
};

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function Gridcraft({ poste, shiftMeta }: GridcraftProps) {
  const [grid] = useState(() => new SharedGrid());
  useEffect(() => {
    grid.connect();
    return () => grid.dispose();
  }, [grid]);
  const snap = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  // Stable, so React doesn't detach and reattach the frame on every render.
  const attachFrame = useCallback((el: HTMLIFrameElement | null) => grid.attach(el), [grid]);

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshTemplates = useCallback(() => {
    if (!SYNC_ENABLED) return;
    listTemplates().then(setTemplates).catch(() => {});
  }, []);
  useEffect(refreshTemplates, [refreshTemplates]);

  const current = templates.find((t) => t.id === snap.templateId) ?? null;
  const latest = templates[0] ?? null;
  const date = shiftMeta.date;
  const fileName = `${(current?.name ?? 'Suivi').replace(/\.xlsx$/i, '')} — ${date}${poste ? ` — Poste ${poste}` : ''}.xlsx`;

  useEffect(() => {
    grid.open(poste ? { date, poste } : null, fileName);
  }, [grid, date, poste, fileName]);

  // The template list changes when this shift was just pinned to the newest one.
  useEffect(() => {
    if (snap.templateId !== null && !templates.some((t) => t.id === snap.templateId)) refreshTemplates();
  }, [snap.templateId, templates, refreshTemplates]);

  async function onUpload(file: File) {
    const startedShift = snap.status !== 'no-template';
    if (
      startedShift &&
      !window.confirm(
        `Utiliser « ${file.name} » comme modèle ?\n\nLes postes pas encore commencés partiront de ce modèle. Ceux déjà remplis gardent le leur ; tu pourras basculer ce poste juste après.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await uploadTemplate(file);
      refreshTemplates();
      if (!startedShift) grid.reload();
      else setNotice('Nouveau modèle enregistré.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onMove() {
    if (!poste || !latest) return;
    if (
      !window.confirm(
        `Basculer le poste ${poste} du ${shiftMeta.dateLabel} sur « ${latest.name} » ?\n\nLes cellules déjà saisies sont reprises aux mêmes adresses (feuille + cellule) dans le nouveau modèle.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await moveToTemplate({ date, poste }, latest.id);
      grid.reload();
      setNotice(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const st = STATUS[snap.status];
  const statusTitle =
    snap.status === 'ready'
      ? 'Les modifications sont partagées avec les autres appareils ouverts sur ce poste'
      : snap.error ?? st.label;

  return (
    <div className="gc">
      <div className="gc-bar no-print">
        <div className="gc-template">
          <span className="gc-template-label">Modèle</span>
          {current ? (
            <span className="gc-template-name" title={`${current.name} · importé le ${fmtDay(current.created_at)}`}>
              {current.name}
            </span>
          ) : (
            <span className="muted">—</span>
          )}
          {current && latest && latest.id !== current.id && (
            <button type="button" className="btn ghost mini" onClick={onMove} disabled={busy}>
              Passer à « {latest.name} »
            </button>
          )}
          <button type="button" className="btn ghost mini" onClick={() => fileRef.current?.click()} disabled={busy || !SYNC_ENABLED}>
            Changer le modèle…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onUpload(f);
            }}
          />
        </div>
        {notice && <span className="gc-notice">{notice}</span>}
        <span className="gc-spacer" />
        {snap.status !== 'disabled' && (
          <div className={`sync-chip ${st.cls}`} role="status" aria-live="polite" title={statusTitle}>
            <span className="sync-glyph" aria-hidden="true">{st.glyph}</span>
            <span className="sync-label">{st.label}</span>
            {snap.pending > 0 && <span className="sync-count">{snap.pending}</span>}
          </div>
        )}
      </div>

      {!SYNC_ENABLED ? (
        <div className="gc-empty">Pas de serveur configuré : le classeur partagé a besoin du Worker.</div>
      ) : !poste ? (
        <div className="gc-empty">Choisis un shift dans l’en-tête : chaque poste a son classeur.</div>
      ) : snap.status === 'no-template' ? (
        <div className="gc-empty">
          <p>Aucun modèle pour l’instant.</p>
          <button type="button" className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            Importer un modèle .xlsx
          </button>
        </div>
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
