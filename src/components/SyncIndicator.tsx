import { useEffect, useState } from 'react';
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

export default function SyncIndicator() {
  const snap = useSyncStatus();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (snap.status === 'disabled') return null;

  const d = DESCRIPTORS[snap.status];
  const lastTs = snap.status === 'error' ? snap.lastErrorAt : snap.lastSuccessAt;
  const lastLabel = lastTs ? relTime(lastTs, now) : null;

  let title: string;
  if (snap.status === 'idle') title = lastLabel ? `Synchronisé · ${lastLabel}` : 'Synchronisé';
  else if (snap.status === 'syncing') title = `Envoi en cours… (${snap.pending})`;
  else if (snap.status === 'queued') title = `${snap.pending} mutation${snap.pending > 1 ? 's' : ''} en attente`;
  else if (snap.status === 'offline') title = 'Hors ligne — les modifications seront envoyées au retour de la connexion';
  else title = `Échec de synchronisation${lastLabel ? ` · ${lastLabel}` : ''} (${snap.pending} en attente)`;

  return (
    <div
      className={`sync-chip no-print ${d.cls}`}
      role="status"
      aria-live="polite"
      title={title}
    >
      <span className="sync-glyph" aria-hidden="true">{d.glyph}</span>
      <span className="sync-label">{d.short}</span>
      {snap.pending > 0 && <span className="sync-count mono">{snap.pending}</span>}
    </div>
  );
}
