import { useEffect, useState, useSyncExternalStore } from 'react';
import { lineSync, type LineSnapshot } from '../lib/lineSync';
import { sharedGrid, type GridSnapshot } from '../lib/sharedGrid';
import { useSyncStatus, type SyncSnapshot, type SyncStatus } from '../lib/sync';

// One chip for everything that syncs, whatever tab is showing: the app's data
// (logbook, schedule, protection…), the shift's GridCraft workbook (Suivi) and
// its Loading and Unloading records, each on its own channel. It shows the
// state that most needs a look and the writes still waiting, all together;
// its title says where each one stands.

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

/** One channel: where it stands, what it still has to send. */
interface Channel {
  name: string;
  status: SyncStatus;
  pending: number;
  text: string;
}

const waiting = (n: number) => `${n} en attente`;

function dataChannel(s: SyncSnapshot): Channel {
  const text =
    s.status === 'idle'
      ? 'à jour'
      : s.status === 'syncing'
        ? `envoi en cours (${s.pending})`
        : s.status === 'queued'
          ? waiting(s.pending)
          : s.status === 'offline'
            ? `hors ligne${s.pending ? `, ${waiting(s.pending)}` : ''}`
            : `échec${s.pending ? `, ${waiting(s.pending)}` : ''}`;
  return { name: 'Saisies', status: s.status, pending: s.pending, text };
}

// The workbook only counts once a shift was opened in it on this device.
function gridChannel(g: GridSnapshot): Channel | null {
  if (g.status === 'disabled' || (g.templateId === null && !g.pending)) return null;
  const name = 'Classeur Suivi';
  switch (g.status) {
    case 'ready':
      return { name, status: 'idle', pending: 0, text: 'à jour' };
    case 'loading':
    case 'syncing':
      return { name, status: 'syncing', pending: g.pending, text: g.pending ? `envoi en cours (${g.pending})` : 'chargement' };
    case 'offline':
      return { name, status: 'offline', pending: g.pending, text: `hors ligne${g.pending ? `, ${waiting(g.pending)}` : ''}` };
    default:
      return { name, status: 'error', pending: g.pending, text: g.error ?? 'échec' };
  }
}

// The records count once a shift is followed (or writes wait from an earlier visit).
function lineChannel(l: LineSnapshot): Channel | null {
  if (l.status === 'disabled' || (!l.part && !l.pending)) return null;
  const name = 'Loading et Unloading';
  switch (l.status) {
    case 'ready':
      return { name, status: 'idle', pending: 0, text: 'à jour' };
    case 'loading':
    case 'syncing':
      return { name, status: 'syncing', pending: l.pending, text: l.pending ? `envoi en cours (${l.pending})` : 'chargement' };
    case 'offline':
      return { name, status: 'offline', pending: l.pending, text: `hors ligne${l.pending ? `, ${waiting(l.pending)}` : ''}` };
    default:
      return { name, status: 'error', pending: l.pending, text: l.error ?? 'échec' };
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

export interface SyncSummary {
  status: SyncStatus;
  pending: number;
  /** The whole in one sentence. */
  text: string;
  /** Each channel's state, a line each. */
  details: string[];
}

/** Every channel together; null when nothing syncs (no Worker). */
export function useSyncSummary(): SyncSummary | null {
  const snap = useSyncStatus();
  const gridSnap = useSyncExternalStore(sharedGrid.subscribe, sharedGrid.getSnapshot);
  const lineSnap = useSyncExternalStore(lineSync.subscribe, lineSync.getSnapshot);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (snap.status === 'disabled') return null;
  const channels = [dataChannel(snap), gridChannel(gridSnap), lineChannel(lineSnap)].filter((c): c is Channel => !!c);
  const status = channels.reduce<SyncStatus>((worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst), 'idle');
  const pending = channels.reduce((n, c) => n + c.pending, 0);
  const last = snap.lastSuccessAt ? ` · ${relTime(snap.lastSuccessAt, now)}` : '';
  const text =
    status === 'idle'
      ? `Tout est synchronisé${last}`
      : status === 'syncing'
        ? `Envoi en cours${pending ? ` (${pending})` : '…'}`
        : status === 'queued'
          ? `${pending} modification${pending > 1 ? 's' : ''} en attente`
          : status === 'offline'
            ? `Hors ligne${pending ? ` · ${waiting(pending)}` : ''} — envoi au retour du réseau`
            : `Échec de synchronisation${pending ? ` · ${waiting(pending)}` : ''}`;
  return { status, pending, text, details: channels.map((c) => `${c.name} : ${c.text}`) };
}

export default function SyncIndicator() {
  const s = useSyncSummary();
  if (!s) return null;
  const d = DESCRIPTORS[s.status];
  return (
    <div className={`sync-chip no-print ${d.cls}`} role="status" aria-live="polite" title={[s.text, ...s.details].join('\n')}>
      <span className="sync-glyph" aria-hidden="true">{d.glyph}</span>
      <span className="sync-label">{d.short}</span>
      {s.pending > 0 && <span className="sync-count mono">{s.pending}</span>}
    </div>
  );
}
