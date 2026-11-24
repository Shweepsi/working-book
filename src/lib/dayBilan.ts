// The day's bilan, 06:00 to 06:00: the Matin, Après-midi and Nuit shifts of
// one date (the night belongs to the day it starts), from what each one's
// Suivi workbook holds (lib/suiviCells.ts, lib/lineBilan.ts). The shift on
// screen counts as its workbook stands; the others are read from the Worker
// (lib/shiftCells.ts), and read again when they're older than STALE_MS or on
// demand.

import { useEffect, useSyncExternalStore } from 'react';
import { EMPTY_LINE, hasRecords, type LineData } from './line';
import { computeLineBilan } from './lineBilan';
import type { Partition } from './sharedGrid';
import { pullShift, readsVersion, shiftCellsNow, shiftReadStatus, subscribeReads } from './shiftCells';
import { POSTES, shiftFor } from './shiftCalendar';
import { cellsToLine } from './suiviCells';
import { mergeBilans, type SuiviBilan } from './suiviBilan';
import { sharedGrid as grid } from './sharedGrid';
import type { Poste, ShiftKey } from '../types';

const STALE_MS = 30_000;
const DAY: ShiftKey[] = ['M', 'A', 'N'];

export interface DayShift {
  key: ShiftKey;
  /** « Matin », « Après-Midi », « Nuit ». */
  label: string;
  hours: string;
  poste: Poste;
  /** Null while it can't be read. */
  bilan: SuiviBilan | null;
  /** Something was typed for it. */
  started: boolean;
}

export interface DayBilan {
  date: string;
  /** The other shifts: being read, read, or not readable. */
  status: 'loading' | 'ready' | 'error';
  error?: string;
  shifts: DayShift[];
  /** The shifts that have one, together. */
  bilan: SuiviBilan;
}

/** Who works the Matin, the Après-midi and the Nuit of `date`, in that order. */
export function dayShifts(date: string): { key: ShiftKey; label: string; hours: string; poste: Poste }[] {
  return DAY.flatMap((key) => {
    const poste = POSTES.find((p) => shiftFor(p, date).key === key);
    if (!poste) return [];
    const t = shiftFor(poste, date);
    return [{ key, label: t.label, hours: t.hours, poste }];
  });
}

/** Reads the day's shifts again. */
export async function refreshDay(date: string): Promise<void> {
  await Promise.all(dayShifts(date).map((s) => pullShift({ date, poste: s.poste })));
}

let cache: { key: string; value: DayBilan } | null = null;

/** The day of `date`, with `live` (the shift followed here) as it stands; null when not `enabled`. */
export function useDayBilan(date: string, live: Partition | null, enabled: boolean): DayBilan | null {
  const reads = useSyncExternalStore(subscribeReads, readsVersion);
  // The workbook on screen: its cells change under it, the reads above don't say so.
  const grids = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    for (const s of dayShifts(date)) {
      const p = { date, poste: s.poste };
      if (Date.now() - shiftReadStatus(p).at > STALE_MS) void pullShift(p);
    }
  }, [enabled, date]);
  if (!enabled) return null;
  const key = `${date}|${live?.poste ?? ''}|${reads}|${grids.rev}|${grids.status}`;
  if (cache?.key === key) return cache.value;
  let unread = false;
  let failed = false;
  const shifts: DayShift[] = dayShifts(date).map((s) => {
    const read = shiftReadStatus({ date, poste: s.poste });
    const cells = shiftCellsNow({ date, poste: s.poste });
    // No cells once read: the shift was never opened in Suivi, nothing is typed.
    const data: LineData | null = cells ? cellsToLine(cells) : read.status === 'ready' ? EMPTY_LINE : null;
    if (!data) {
      unread = true;
      failed ||= read.status === 'error';
    }
    return { ...s, bilan: data ? computeLineBilan(data) : null, started: !!data && hasRecords(data) };
  });
  const value: DayBilan = {
    date,
    status: failed ? 'error' : unread ? 'loading' : 'ready',
    error: failed ? (navigator.onLine ? 'lecture impossible' : 'pas de réseau') : undefined,
    shifts,
    bilan: mergeBilans(shifts.flatMap((s) => (s.bilan ? [s.bilan] : []))),
  };
  cache = { key, value };
  return value;
}
