// A shift's Suivi cells wherever the app is: live from the Suivi tab's workbook
// when it shows that shift (sharedGrid.cells), read from the Worker otherwise —
// so the Loading and Unloading tabs and the bilan, which are computed from
// them (lib/suiviCells.ts), work from any page.
//
// A read asks for what came after the last `seq` it saw, like the workbook's
// own sync, and uses `peek`, which doesn't start a shift nobody opened yet:
//   - every 2 s while a tab shows the shift (it must follow what the other
//     tablets type in Suivi);
//   - every 30 s when only the header's bilan button looks;
//   - on demand for the day's other shifts (lib/dayBilan.ts).

import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE } from './api';
import { sharedGrid as grid, type Partition } from './sharedGrid';

const POLL_MS = 2_000;
const POLL_PASSIVE_MS = 30_000;

type ReadStatus = 'loading' | 'ready' | 'error';

interface Store {
  /** By "Sheet!A1"; null while nobody opened the shift. A cell emptied is kept (as null): it is not the template's. */
  cells: Map<string, unknown> | null;
  seq: number;
  /** Last read (ms), and whether one is under way. */
  at: number;
  busy: boolean;
  status: ReadStatus;
  /** Bumped by every read. */
  version: number;
}

const stores = new Map<string, Store>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
/** For `useSyncExternalStore`: changes whenever any shift was read again. */
export const subscribeReads = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const readsVersion = () => version;

const keyOf = (p: Partition) => `${p.date}.${p.poste}`;
const storeOf = (p: Partition): Store => {
  let s = stores.get(keyOf(p));
  if (!s) {
    s = { cells: null, seq: 0, at: 0, busy: false, status: 'loading', version: 0 };
    stores.set(keyOf(p), s);
  }
  return s;
};

interface Page {
  template_id: number | null;
  seq: number;
  changes: { sheet: string; cell: string; c: unknown }[];
  more?: boolean;
}

/** Reads what `p` got since the last read. */
export async function pullShift(p: Partition): Promise<void> {
  const s = storeOf(p);
  if (s.busy) return;
  s.busy = true;
  try {
    for (;;) {
      const r = await fetch(`${API_BASE}/api/grid/doc?date=${p.date}&poste=${p.poste}&since=${s.seq}&peek=1`);
      if (!r.ok) throw new Error(`le serveur a répondu ${r.status}`);
      const page = (await r.json()) as Page;
      if (page.template_id === null) break;
      const cells = s.cells ?? (s.cells = new Map());
      for (const ch of page.changes) cells.set(`${ch.sheet}!${ch.cell}`, ch.c);
      s.seq = page.seq;
      if (!page.more) break;
    }
    s.status = 'ready';
  } catch {
    // Offline or refused: what was read stays on screen.
    s.status = 'error';
  }
  s.busy = false;
  s.at = Date.now();
  s.version++;
  emit();
}

/** A shift's cells as they stand here: the workbook on screen's, or the last read; null when unknown or never opened. */
export function shiftCellsNow(p: Partition): ReadonlyMap<string, unknown> | null {
  return liveCells(p) ?? stores.get(keyOf(p))?.cells ?? null;
}

/** Where a shift's last read stands (the Worker's copy, not the workbook on screen). */
export function shiftReadStatus(p: Partition): { status: ReadStatus; at: number } {
  const s = stores.get(keyOf(p));
  return { status: s?.status ?? 'loading', at: s?.at ?? 0 };
}

/** The workbook on screen's cells for `p`, once it has them all (not while it replays them). */
function liveCells(p: Partition): ReadonlyMap<string, unknown> | null {
  const status = grid.getSnapshot().status;
  if (status === 'loading' || status === 'no-template') return null;
  return grid.cells(p);
}

export interface ShiftCells {
  /** By "Sheet!A1"; null before anything is known, or for a shift nobody opened. */
  cells: ReadonlyMap<string, unknown> | null;
  /** Live from the workbook on screen, or as last read from the Worker. */
  live: boolean;
  /** The Worker's copy: being read, read, or not readable (offline). */
  status: ReadStatus;
  /** Changes whenever `cells` may have changed. */
  rev: string;
}

/**
 * `part`'s cells, live when the Suivi tab shows it, read from the Worker
 * otherwise: every 2 s when `active` (a tab shows them), every 30 s if not.
 */
export function useShiftCells(part: Partition | null, active = false): ShiftCells | null {
  const snap = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  useSyncExternalStore(subscribeReads, readsVersion);
  const live = part ? liveCells(part) : null;
  const date = part?.date;
  const poste = part?.poste;
  useEffect(() => {
    if (!date || !poste || live) return;
    const p = { date, poste };
    const every = active ? POLL_MS : POLL_PASSIVE_MS;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      const s = stores.get(keyOf(p));
      if (!s || Date.now() - s.at >= every - 100) void pullShift(p);
    };
    tick();
    const t = setInterval(tick, active ? 1_000 : 5_000);
    return () => clearInterval(t);
  }, [date, poste, !!live, active]);
  if (!part) return null;
  if (live) return { cells: live, live: true, status: 'ready', rev: `live|${snap.rev}|${snap.status}` };
  const s = stores.get(keyOf(part));
  return { cells: s?.cells ?? null, live: false, status: s?.status ?? 'loading', rev: `read|${s?.version ?? 0}` };
}
