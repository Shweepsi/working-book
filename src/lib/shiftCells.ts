// A shift's cells wherever the app is: live from the Suivi tab's workbook when
// it shows that shift (sharedGrid.cells), read from the Worker otherwise — so
// its bilan opens over any page. A read uses `peek`, which doesn't start a
// shift nobody opened yet, and is read again after STALE_MS while someone
// still looks at it.

import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE } from './api';
import { sharedGrid as grid, type Partition } from './sharedGrid';

export const STALE_MS = 30_000;

/** The cells stored for a shift, by "Sheet!A1"; null when nobody opened it yet. */
export async function readShift(date: string, poste: string): Promise<ReadonlyMap<string, unknown> | null> {
  const cells = new Map<string, unknown>();
  let since = 0;
  for (;;) {
    const r = await fetch(`${API_BASE}/api/grid/doc?date=${date}&poste=${poste}&since=${since}&peek=1`);
    if (!r.ok) throw new Error(`le serveur a répondu ${r.status}`);
    const page = (await r.json()) as { template_id: number | null; seq: number; changes: { sheet: string; cell: string; c: unknown }[]; more?: boolean };
    if (page.template_id === null) return null;
    for (const ch of page.changes) cells.set(`${ch.sheet}!${ch.cell}`, ch.c);
    since = page.seq;
    if (!page.more) return cells;
  }
}

interface Read {
  at: number;
  status: 'loading' | 'ready' | 'error';
  cells: ReadonlyMap<string, unknown> | null;
}
const reads = new Map<string, Read>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const keyOf = (p: Partition) => `${p.date}|${p.poste}`;

async function refresh(p: Partition): Promise<void> {
  const key = keyOf(p);
  const before = reads.get(key);
  if (before?.status === 'loading') return;
  reads.set(key, { at: Date.now(), status: 'loading', cells: before?.cells ?? null });
  emit();
  try {
    reads.set(key, { at: Date.now(), status: 'ready', cells: await readShift(p.date, p.poste) });
  } catch {
    reads.set(key, { at: Date.now(), status: 'error', cells: before?.cells ?? null });
  }
  emit();
}

export interface ShiftCells {
  /** By "Sheet!A1"; null before anything is known, or for a shift nobody opened. */
  cells: ReadonlyMap<string, unknown> | null;
  /** Live from the workbook on screen, or as last read. */
  live: boolean;
  /** The Worker's copy: being read, read, or not readable (offline). */
  status: 'loading' | 'ready' | 'error';
  /** Bumped whenever `cells` may have changed. */
  rev: string;
}

/** `part`'s cells, live when the Suivi tab shows it; read (and kept fresh) from the Worker otherwise. */
export function useShiftCells(part: Partition | null): ShiftCells | null {
  const snap = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  const v = useSyncExternalStore(subscribe, () => version);
  const live = part ? grid.cells(part) : null;
  const date = part?.date;
  const poste = part?.poste;
  useEffect(() => {
    if (!date || !poste || live) return;
    const p = { date, poste };
    const tick = () => {
      const r = reads.get(keyOf(p));
      if (document.visibilityState !== 'hidden' && (!r || Date.now() - r.at > STALE_MS)) void refresh(p);
    };
    tick();
    const t = setInterval(tick, 5_000);
    return () => clearInterval(t);
  }, [date, poste, !!live]);
  if (!part) return null;
  if (live) return { cells: live, live: true, status: 'ready', rev: `live|${snap.rev}|${snap.status}` };
  const r = reads.get(keyOf(part));
  return { cells: r?.cells ?? null, live: false, status: r?.status ?? 'loading', rev: `read|${v}` };
}
