import { useEffect, useState, useSyncExternalStore } from 'react';
import { lineSync, type LineSnapshot } from '../lib/lineSync';
import { sharedGrid, type GridSnapshot } from '../lib/sharedGrid';
import { useSyncStatus, type SyncStatus } from '../lib/sync';

interface Descriptor {
  cls: string;
  glyph: string;
  short: string;
}

const DESCRIPTORS: Record<SyncStatus, Descriptor> = {
  idle:     { cls: 'is-idle',    glyph: '●', short: 'Sync.' },
  syncing:  { cls: 'is-syncing', glyph: '↻', short: 'Sync…' },
  queued:   { cls: 'is-queued',  glyph: '↑', short: 'En file' },
  offline:  { cls: 'is-offline', glyph: '⊘', short: 'Hors ligne' },
  error:    { cls: 'is-error',   glyph: '⚠', short: 'Échec' },
  disabled: { cls: 'is-disabled', glyph: '○', short: 'Local' },
};

// Worst first: the chip shows the state that most needs a look.
const RANK: Record<SyncStatus, number> = { error: 4, offline: 3, queued: 2, syncing: 1, idle: 0, disabled: -1 };

// The shift's GridCraft workbook syncs on its own channel (lib/sharedGrid.ts),
// cell by cell, apart from the queue the other tabs go through.
function gridState(g: GridSnapshot): { status: SyncStatus; title: string } | null {
  switch (g.status) {
    case 'ready':
      return { status: 'idle', title: 'partagé avec les autres appareils ouverts sur ce poste' };
    case 'loading':
      return { status: 'syncing', title: 'chargement…' };
    case 'syncing':
      return { status: 'syncing', title: `envoi en cours… (${g.pending})` };
    case 'offline':
      return { status: 'offline', title: 'hors ligne — les cellules seront envoyées au retour de la connexion' };
    case 'error':
      return { status: 'error', title: g.error ?? 'échec' };
    default:
      return null;
  }
}

function lineState(l: LineSnapshot): { status: SyncStatus; title: string } | null {
  switch (l.status) {
    case 'ready':
      return { status: 'idle', title: 'partagé avec les autres appareils ouverts sur ce poste' };
    case 'loading':
      return { status: 'syncing', title: 'chargement…' };
    case 'syncing':
      return { status: 'syncing', title: `envoi en cours… (${l.pending})` };
    case 'offline':
      return { status: 'offline', title: 'hors ligne — les saisies seront envoyées au retour de la connexion' };
    case 'error':
      return { status: 'error', title: l.error ?? 'échec' };
    default:
      return null;
  }
}

function relTime(ts: number, now: number): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 5) return 'à l’instant';
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

interface SyncIndicatorProps {
  /** Also reflect the shift's shared GridCraft workbook (on its tab). */
  grid?: boolean;
  /** Also reflect the shift's Loading and Unloading records (on their tabs). */
  line?: boolean;
}

export default function SyncIndicator({ grid = false, line = false }: SyncIndicatorProps) {
  const snap = useSyncStatus();
  const gridSnap = useSyncExternalStore(sharedGrid.subscribe, sharedGrid.getSnapshot);
  const lineSnap = useSyncExternalStore(lineSync.subscribe, lineSync.getSnapshot);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (snap.status === 'disabled') return null;

  const g = grid ? gridState(gridSnap) : line ? lineState(lineSnap) : null;
  const status = g && RANK[g.status] > RANK[snap.status] ? g.status : snap.status;
  const pending = snap.pending + (g ? (grid ? gridSnap.pending : lineSnap.pending) : 0);
  const d = DESCRIPTORS[status];
  const lastTs = snap.status === 'error' ? snap.lastErrorAt : snap.lastSuccessAt;
  const lastLabel = lastTs ? relTime(lastTs, now) : null;

  let title: string;
  if (snap.status === 'idle') title = lastLabel ? `Synchronisé · ${lastLabel}` : 'Synchronisé';
  else if (snap.status === 'syncing') title = `Envoi en cours… (${snap.pending})`;
  else if (snap.status === 'queued') title = `${snap.pending} mutation${snap.pending > 1 ? 's' : ''} en attente`;
  else if (snap.status === 'offline') title = 'Hors ligne — les modifications seront envoyées au retour de la connexion';
  else title = `Échec de synchronisation${lastLabel ? ` · ${lastLabel}` : ''} (${snap.pending} en attente)`;
  if (g) title = `Saisies : ${title}\n${grid ? 'Classeur du poste' : 'Loading et Unloading'} : ${g.title}`;

  return (
    <div
      className={`sync-chip no-print ${d.cls}`}
      role="status"
      aria-live="polite"
      title={title}
    >
      <span className="sync-glyph" aria-hidden="true">{d.glyph}</span>
      <span className="sync-label">{d.short}</span>
      {pending > 0 && <span className="sync-count mono">{pending}</span>}
    </div>
  );
}
