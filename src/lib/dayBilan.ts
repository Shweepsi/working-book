// The day's bilan, 06:00 to 06:00: the Matin, Après-midi and Nuit shifts of
// one date (the night belongs to the day it starts), each a workbook of its
// own. The shift on screen counts as it stands (its cells live); the other two
// are read from the Worker with `peek`, which doesn't start a shift nobody
// opened yet, and read again when they're older than STALE_MS or on demand.

import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE } from './api';
import { sharedGrid as grid, type Partition } from './sharedGrid';
import { POSTES, shiftFor } from './shiftCalendar';
import { computeBilan, mergeBilans, type SuiviBilan } from './suiviBilan';
import type { Poste, ShiftKey } from '../types';

const STALE_MS = 30_000;
const DAY: ShiftKey[] = ['M', 'A', 'N'];

export interface DayShift {
  key: ShiftKey;
  /** « Matin », « Après-Midi », « Nuit ». */
  label: string;
  hours: string;
  poste: Poste;
  /** Null while it can't be read, or before anyone opened it. */
  bilan: SuiviBilan | null;
  /** Someone opened its workbook. */
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

// The other shifts' cells, as last read.
interface Read {
  date: string;
  at: number;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  /** By poste; null for a shift nobody opened. */
  cells: Map<Poste, ReadonlyMap<string, unknown> | null>;
}
let read: Read | null = null;
let version = 0;
let token = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

async function readShift(date: string, poste: Poste): Promise<ReadonlyMap<string, unknown> | null> {
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

/** Reads the day's shifts again. */
export async function refreshDay(date: string): Promise<void> {
  const mine = ++token;
  read = { date, at: Date.now(), status: 'loading', cells: read?.date === date ? read.cells : new Map() };
  emit();
  try {
    const shifts = dayShifts(date);
    const all = await Promise.all(shifts.map((s) => readShift(date, s.poste)));
    if (mine !== token) return;
    read = { date, at: Date.now(), status: 'ready', cells: new Map(shifts.map((s, i) => [s.poste, all[i]])) };
  } catch (e) {
    if (mine !== token) return;
    read = { ...(read as Read), status: 'error', error: navigator.onLine ? String(e instanceof Error ? e.message : e) : 'pas de réseau' };
  }
  emit();
}

let cache: { key: string; value: DayBilan } | null = null;

/** The day of `date`, with `live` (the shift on screen) as it stands; null when not `enabled`. */
export function useDayBilan(date: string, live: Partition | null, enabled: boolean): DayBilan | null {
  const v = useSyncExternalStore(subscribe, () => version);
  const snap = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  useEffect(() => {
    if (enabled && (!read || read.date !== date || (read.status !== 'loading' && Date.now() - read.at > STALE_MS))) void refreshDay(date);
  }, [enabled, date]);
  if (!enabled) return null;
  const key = `${date}|${live?.poste ?? ''}|${v}|${snap.rev}|${snap.status}`;
  if (cache?.key === key) return cache.value;
  const r = read?.date === date ? read : null;
  const shifts: DayShift[] = dayShifts(date).map((s) => {
    const liveCells = live && live.date === date && live.poste === s.poste ? grid.cells(live) : null;
    const cells = liveCells ?? r?.cells.get(s.poste) ?? null;
    return { ...s, bilan: cells ? computeBilan(cells) : null, started: !!liveCells || !!r?.cells.get(s.poste) };
  });
  const value: DayBilan = {
    date,
    status: r?.status ?? 'loading',
    error: r?.error,
    shifts,
    bilan: mergeBilans(shifts.flatMap((s) => (s.bilan ? [s.bilan] : []))),
  };
  cache = { key, value };
  return value;
}
