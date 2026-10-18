// The day's bilan, 06:00 to 06:00: the Matin, Après-midi and Nuit shifts of
// one date (the night belongs to the day it starts), from what the Loading and
// Unloading tabs hold for each (lib/lineBilan.ts). The shift followed on this
// device counts as it stands; the other two are read from the Worker, and read
// again when they're older than STALE_MS or on demand.

import { useEffect, useSyncExternalStore } from 'react';
import type { LineData } from './line';
import { computeLineBilan } from './lineBilan';
import { lineSync, readLine } from './lineSync';
import type { Partition } from './sharedGrid';
import { POSTES, shiftFor } from './shiftCalendar';
import { mergeBilans, type SuiviBilan } from './suiviBilan';
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

// The other shifts, as last read.
interface Read {
  date: string;
  at: number;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  data: Map<Poste, LineData>;
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

/** Reads the day's shifts again. */
export async function refreshDay(date: string): Promise<void> {
  const mine = ++token;
  read = { date, at: Date.now(), status: 'loading', data: read?.date === date ? read.data : new Map() };
  emit();
  try {
    const shifts = dayShifts(date);
    const all = await Promise.all(shifts.map((s) => readLine(date, s.poste)));
    if (mine !== token) return;
    read = { date, at: Date.now(), status: 'ready', data: new Map(shifts.map((s, i) => [s.poste, all[i]])) };
  } catch (e) {
    if (mine !== token) return;
    read = { ...(read as Read), status: 'error', error: navigator.onLine ? String(e instanceof Error ? e.message : e) : 'pas de réseau' };
  }
  emit();
}

const hasRecords = (d: LineData) => d.colours.length + d.loading.length + d.unloading.length + d.scraps.length > 0;

let cache: { key: string; value: DayBilan } | null = null;

/** The day of `date`, with `live` (the shift followed here) as it stands; null when not `enabled`. */
export function useDayBilan(date: string, live: Partition | null, enabled: boolean): DayBilan | null {
  const v = useSyncExternalStore(subscribe, () => version);
  const snap = useSyncExternalStore(lineSync.subscribe, lineSync.getSnapshot);
  useEffect(() => {
    if (enabled && (!read || read.date !== date || (read.status !== 'loading' && Date.now() - read.at > STALE_MS))) void refreshDay(date);
  }, [enabled, date]);
  if (!enabled) return null;
  const key = `${date}|${live?.poste ?? ''}|${v}|${snap.part}|${snap.rev}|${snap.loaded}`;
  if (cache?.key === key) return cache.value;
  const r = read?.date === date ? read : null;
  const shifts: DayShift[] = dayShifts(date).map((s) => {
    const liveData = live && live.date === date && live.poste === s.poste ? lineSync.data(live) : null;
    const data = liveData ?? r?.data.get(s.poste) ?? null;
    return { ...s, bilan: data ? computeLineBilan(data) : null, started: !!data && hasRecords(data) };
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
