// A shift's Loading and Unloading records, as the Suivi workbook says them
// right now (lib/suiviCells.ts): computed again whenever its cells change, once
// for every component that asks.

import { EMPTY_LINE, hasRecords, type LineData } from './line';
import type { Partition } from './sharedGrid';
import { useShiftCells } from './shiftCells';
import { cellsToLine } from './suiviCells';

export interface ShiftLine {
  /** Null while the shift's cells are being read for the first time (or can't be). */
  data: LineData | null;
  /** The Worker's copy, when the workbook isn't on screen: being read, read, or not readable. */
  status: 'loading' | 'ready' | 'error';
  /** Something is typed in the shift's Suivi. */
  started: boolean;
  /** The workbook on screen is the source. */
  live: boolean;
}

const NONE: ShiftLine = { data: null, status: 'loading', started: false, live: false };

const cache = new Map<string, { rev: string; line: ShiftLine }>();

/** The records of `part`, followed (every 2 s while `active`, as when a tab shows them). */
export function useShiftLine(part: Partition | null, active = false): ShiftLine {
  const src = useShiftCells(part, active);
  if (!part || !src) return NONE;
  const key = `${part.date}.${part.poste}`;
  const rev = `${src.rev}|${src.status}|${src.cells ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit?.rev === rev) return hit.line;
  // No cells: still being read (nothing to show yet), or a shift nobody opened in Suivi (empty).
  const data = src.cells ? cellsToLine(src.cells) : src.status === 'ready' ? EMPTY_LINE : null;
  const line: ShiftLine = { data, status: src.status, started: !!data && hasRecords(data), live: src.live };
  cache.set(key, { rev, line });
  return line;
}
